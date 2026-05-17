import type { FoundryAgent } from '@extension/storage';
import { buildFoundryResponsesEndpoint } from '@extension/storage/lib/settings/foundryAgents';
import { Actors } from '@extension/storage/lib/chat/types';
import type { ChatMessage } from '@extension/storage/lib/chat/types';

export type FoundryResponseInput =
  | string
  | Array<{
      type: 'message';
      role: 'user' | 'assistant';
      content: string;
    }>;

function parseSseDataBlock(block: string): string {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return dataLines.join('\n');
}

function extractTextDeltaFromSseEvent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';

  if (type === 'response.output_text.delta' && typeof record.delta === 'string') {
    return record.delta;
  }

  if (type === 'response.completed' || type === 'response.done') {
    return null;
  }

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text;
  }

  return null;
}

function extractTextFromJsonResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text;
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return '';
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.type === 'message' && Array.isArray(itemRecord.content)) {
      for (const block of itemRecord.content) {
        if (!block || typeof block !== 'object') {
          continue;
        }
        const blockRecord = block as Record<string, unknown>;
        if (blockRecord.type === 'output_text' && typeof blockRecord.text === 'string') {
          parts.push(blockRecord.text);
        }
      }
    }
  }
  return parts.join('');
}

export function buildFoundryResponseInput(params: {
  messages: ChatMessage[];
  userQuery: string;
  pageContent?: string;
  includePageContent: boolean;
}): FoundryResponseInput {
  const { messages, userQuery, pageContent, includePageContent } = params;
  const items: Array<{ type: 'message'; role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.actor === Actors.USER && msg.content?.trim()) {
      items.push({ type: 'message', role: 'user', content: msg.content.trim() });
    } else if (msg.actor === Actors.SYSTEM && msg.content?.trim() && !msg.toolEvent) {
      items.push({ type: 'message', role: 'assistant', content: msg.content.trim() });
    }
  }

  const trimmedQuery = userQuery.trim();
  const last = items[items.length - 1];
  const isDuplicateLast =
    last?.role === 'user' &&
    (last.content === trimmedQuery || last.content.includes(trimmedQuery) || trimmedQuery.includes(last.content));

  if (trimmedQuery && !isDuplicateLast) {
    let content = trimmedQuery;
    if (includePageContent && pageContent?.trim()) {
      content = `${trimmedQuery}\n\n---\nCurrent page content:\n${pageContent.trim()}`;
    }
    items.push({ type: 'message', role: 'user', content });
  }

  if (items.length === 0) {
    return trimmedQuery || 'Hello';
  }
  if (items.length === 1) {
    return items[0]!.content;
  }
  return items;
}

export async function streamFoundryAgentResponse(params: {
  agent: FoundryAgent;
  input: FoundryResponseInput;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<void> {
  const { agent, input, signal, onDelta } = params;
  const endpoint = buildFoundryResponsesEndpoint(agent);
  if (!agent.apiKey.trim()) {
    throw new Error('Azure Foundry agent API key is not configured.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'api-key': agent.apiKey.trim(),
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input,
      stream: true,
      store: false,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `Foundry agent request failed (${response.status}): ${errorBody.slice(0, 500) || response.statusText}`,
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const json = (await response.json().catch(() => null)) as unknown;
    const text = extractTextFromJsonResponse(json);
    if (text) {
      onDelta(text);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = parseSseDataBlock(block);
      if (data && data !== '[DONE]') {
        try {
          const payload = JSON.parse(data) as unknown;
          const delta = extractTextDeltaFromSseEvent(payload);
          if (delta) {
            onDelta(delta);
          }
        } catch {
          // ignore malformed SSE JSON frames
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
