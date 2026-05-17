import type { FoundryAgent } from '@extension/storage';
import {
  buildFoundryProjectOpenAiUrl,
  buildFoundryResponsesRequestUrl,
  resolveFoundryAgentReference,
} from '@extension/storage/lib/settings/foundryAgents';
import { foundryConversationStore } from '@extension/storage/lib/settings/foundryConversations';

function foundryHeaders(apiKey: string, accept = 'application/json'): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: accept,
    'api-key': apiKey.trim(),
  };
}

async function readFoundryError(response: Response): Promise<string> {
  const errorBody = await response.text().catch(() => '');
  return errorBody.slice(0, 500) || response.statusText;
}

function parseSseDataBlock(block: string): string {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return dataLines.join('\n');
}

function isFoundryStreamTerminalEvent(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const type =
    typeof (payload as Record<string, unknown>).type === 'string' ? (payload as Record<string, unknown>).type : '';
  return (
    type === 'response.completed' ||
    type === 'response.failed' ||
    type === 'response.cancelled' ||
    type === 'response.incomplete'
  );
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

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text;
  }

  return null;
}

/** Returns true when the SSE block signals end-of-stream (Foundry may keep the HTTP connection open). */
function processFoundrySseBlock(block: string, onDelta: (text: string) => void): boolean {
  const data = parseSseDataBlock(block);
  if (!data) {
    return false;
  }
  if (data === '[DONE]') {
    return true;
  }

  try {
    const payload = JSON.parse(data) as unknown;
    if (isFoundryStreamTerminalEvent(payload)) {
      return true;
    }
    const delta = extractTextDeltaFromSseEvent(payload);
    if (delta) {
      onDelta(delta);
    }
  } catch {
    // ignore malformed SSE JSON frames
  }
  return false;
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

/** User text for the current QA turn (conversation API tracks prior turns). */
export function buildFoundryTurnInput(params: {
  userQuery: string;
  pageContent?: string;
  includePageContent: boolean;
}): string {
  const trimmedQuery = params.userQuery.trim();
  if (!trimmedQuery) {
    return 'Hello';
  }
  if (params.includePageContent && params.pageContent?.trim()) {
    return `${trimmedQuery}\n\n---\nCurrent page content:\n${params.pageContent.trim()}`;
  }
  return trimmedQuery;
}

export async function createFoundryConversation(agent: FoundryAgent, signal: AbortSignal): Promise<string> {
  const url = buildFoundryProjectOpenAiUrl(agent.projectEndpoint, '/openai/v1/conversations');
  const response = await fetch(url, {
    method: 'POST',
    headers: foundryHeaders(agent.apiKey),
    body: JSON.stringify({}),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Foundry conversation create failed (${response.status}): ${await readFoundryError(response)}`);
  }

  const json = (await response.json()) as { id?: string };
  if (!json.id?.trim()) {
    throw new Error('Foundry conversation create returned no conversation id.');
  }
  return json.id.trim();
}

export async function getOrCreateFoundryConversation(
  agent: FoundryAgent,
  sessionId: string,
  signal: AbortSignal,
): Promise<string> {
  const existing = await foundryConversationStore.getConversationId(sessionId);
  if (existing) {
    return existing;
  }
  const conversationId = await createFoundryConversation(agent, signal);
  await foundryConversationStore.setConversationId(sessionId, conversationId);
  return conversationId;
}

export async function streamFoundryAgentResponse(params: {
  agent: FoundryAgent;
  sessionId: string;
  input: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<void> {
  const { agent, sessionId, input, signal, onDelta } = params;
  if (!agent.apiKey.trim()) {
    throw new Error('Azure Foundry agent API key is not configured.');
  }

  const conversationId = await getOrCreateFoundryConversation(agent, sessionId, signal);
  const agentRef = resolveFoundryAgentReference(agent);
  const url = buildFoundryResponsesRequestUrl(agent);

  const body: Record<string, unknown> = {
    agent_reference: {
      name: agentRef.name,
      type: 'agent_reference',
      ...(agentRef.version ? { version: agentRef.version } : {}),
    },
    conversation: conversationId,
    input,
    stream: true,
    store: false,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: foundryHeaders(agent.apiKey, 'text/event-stream'),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Foundry agent request failed (${response.status}): ${await readFoundryError(response)}`);
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
  let streamFinished = false;

  try {
    while (!streamFinished) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (processFoundrySseBlock(block, onDelta)) {
          streamFinished = true;
          break;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }

    if (!streamFinished && buffer.trim()) {
      streamFinished = processFoundrySseBlock(buffer, onDelta);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
