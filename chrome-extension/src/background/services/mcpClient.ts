import type { McpServerConfig } from '@extension/storage';

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_TOOL_RESULT_CHARS = 12000;
const MCP_SESSION_HEADER = 'Mcp-Session-Id';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallToolResult {
  content: string;
  rawResult: unknown;
  truncated: boolean;
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractA2AArtifactText(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.artifacts)) {
    return [];
  }

  const blocks: string[] = [];
  for (const artifact of record.artifacts) {
    if (!artifact || typeof artifact !== 'object') {
      continue;
    }
    const artifactRecord = artifact as Record<string, unknown>;
    if (!Array.isArray(artifactRecord.parts)) {
      continue;
    }
    const combined = artifactRecord.parts
      .map(part => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        const partRecord = part as Record<string, unknown>;
        return typeof partRecord.text === 'string' ? partRecord.text : '';
      })
      .join('');

    if (combined.trim()) {
      blocks.push(combined);
    }
  }
  return blocks;
}

function extractTextCandidates(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = tryParseJson(trimmed);
      if (parsed != null) {
        const a2a = extractA2AArtifactText(parsed);
        if (a2a.length > 0) {
          return a2a;
        }
        const nested = extractTextCandidates(parsed);
        if (nested.length > 0) {
          return nested;
        }
      }
    }
    return trimmed ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => extractTextCandidates(item));
  }

  if (typeof value !== 'object') {
    return [String(value)];
  }

  const record = value as Record<string, unknown>;

  const a2aHere = extractA2AArtifactText(record);
  if (a2aHere.length > 0) {
    return a2aHere;
  }
  const a2aInResult = extractA2AArtifactText(record.result);
  if (a2aInResult.length > 0) {
    return a2aInResult;
  }

  const out: string[] = [];

  if (typeof record.text === 'string') {
    out.push(...extractTextCandidates(record.text));
  }
  if (Array.isArray(record.parts)) {
    out.push(...extractTextCandidates(record.parts));
  }
  if (Array.isArray(record.content)) {
    out.push(...extractTextCandidates(record.content));
  }
  if (Array.isArray(record.artifacts)) {
    out.push(...extractTextCandidates(record.artifacts));
  }
  if (record.result != null) {
    out.push(...extractTextCandidates(record.result));
  }
  if (record.output != null) {
    out.push(...extractTextCandidates(record.output));
  }
  if (record.data != null) {
    out.push(...extractTextCandidates(record.data));
  }

  return out;
}

function normalizeMcpResultContent(value: unknown): string {
  const extracted = extractTextCandidates(value).filter(chunk => chunk.trim().length > 0);

  if (extracted.length === 0) {
    return stringifySafe(value);
  }

  const deduped: string[] = [];
  for (const chunk of extracted) {
    if (deduped[deduped.length - 1] !== chunk) {
      deduped.push(chunk);
    }
  }

  return deduped.join('\n\n');
}

function stringifySafe(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, maxChars)}\n\n[truncated]`, truncated: true };
}

function buildHeaders(server: McpServerConfig): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json, text/event-stream');
  if (server.authType === 'bearer' && server.authToken.trim()) {
    headers.set('Authorization', `Bearer ${server.authToken.trim()}`);
  }
  return headers;
}

/** GET /sse — no JSON body; some servers reject Content-Type on GET. */
function buildSseGetHeaders(server: McpServerConfig): Headers {
  const headers = new Headers();
  headers.set('Accept', 'text/event-stream');
  if (server.authType === 'bearer' && server.authToken.trim()) {
    headers.set('Authorization', `Bearer ${server.authToken.trim()}`);
  }
  return headers;
}

/** Streamable HTTP: single MCP URL for POST (and optional SSE on same URL). */
function resolveStreamablePostEndpoint(server: McpServerConfig): string {
  return server.endpoint;
}

function resolveSseMessagePostUrl(pathOrUrl: string, sseUrl: string): string {
  let d = pathOrUrl.trim();
  if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) {
    d = d.slice(1, -1);
  }
  try {
    return new URL(d, sseUrl).href;
  } catch {
    throw new Error(`Invalid MCP message POST URL: ${pathOrUrl}`);
  }
}

function parseSseFrame(block: string): { event: string | null; data: string } {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return { event, data: dataLines.join('\n') };
}

type PendingEntry = {
  resolve: (r: JsonRpcResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * MCP 2024-11 "HTTP with SSE": GET the SSE URL, read `endpoint` event for JSON-RPC POST URL,
 * then POST requests; responses often arrive as `message` events on the same GET stream.
 */
class LegacyHttpSseSession {
  private postUrl: string | null = null;
  private fallbackPostUrl: string | null = null;
  private readonly pending = new Map<string, PendingEntry>();
  private buffer = '';
  private readonly decoder = new TextDecoder();
  private pumpEnded = false;

  private constructor(
    private readonly server: McpServerConfig,
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly abortController: AbortController,
  ) {
    void this.pump();
  }

  static async connect(server: McpServerConfig, parentSignal: AbortSignal): Promise<LegacyHttpSseSession> {
    if (server.transport !== 'sse') {
      throw new Error('LegacyHttpSseSession requires transport sse');
    }
    const ac = new AbortController();
    const onAbort = () => ac.abort(parentSignal.reason);
    parentSignal.addEventListener('abort', onAbort, { once: true });

    const res = await fetch(server.endpoint, {
      method: 'GET',
      headers: buildSseGetHeaders(server),
      signal: ac.signal,
    });

    if (!res.ok) {
      throw new Error(
        `MCP SSE GET failed (${res.status}) ${res.statusText}. Put the SSE URL here (GET only), e.g. http://127.0.0.1:8010/sse — do not use the POST URL as the main field.`,
      );
    }
    const body = res.body;
    if (!body) {
      throw new Error('MCP SSE: response had no body');
    }

    const session = new LegacyHttpSseSession(server, body.getReader(), ac);

    if (server.sseMessageEndpoint?.trim()) {
      session.fallbackPostUrl = resolveSseMessagePostUrl(server.sseMessageEndpoint.trim(), server.endpoint);
    }

    await session.waitForPostUrl(parentSignal);
    parentSignal.removeEventListener('abort', onAbort);
    return session;
  }

  private async waitForPostUrl(parentSignal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        clearInterval(iv);
        if (this.postUrl) {
          resolve();
          return;
        }
        if (this.fallbackPostUrl) {
          this.postUrl = this.fallbackPostUrl;
          resolve();
          return;
        }
        reject(
          new Error(
            'MCP SSE: timed out waiting for endpoint event. Set "Message POST URL" to your server JSON-RPC URL (often http://127.0.0.1:PORT/messages).',
          ),
        );
      }, 15_000);
      const iv = setInterval(() => {
        if (this.postUrl) {
          clearTimeout(deadline);
          clearInterval(iv);
          resolve();
          return;
        }
        if (this.pumpEnded) {
          clearTimeout(deadline);
          clearInterval(iv);
          reject(new Error('MCP SSE stream ended before an endpoint event was received.'));
        }
        if (parentSignal.aborted) {
          clearTimeout(deadline);
          clearInterval(iv);
          reject(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('Aborted'));
        }
      }, 15);
    });
  }

  private async pump(): Promise<void> {
    try {
      while (true) {
        const { done, value } = await this.reader.read();
        if (done) {
          break;
        }
        this.buffer += this.decoder.decode(value, { stream: true });
        this.drainBuffer();
      }
    } catch {
      // connection closed
    } finally {
      this.pumpEnded = true;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('MCP SSE connection closed'));
      }
      this.pending.clear();
    }
  }

  private drainBuffer(): void {
    while (true) {
      const sep = this.buffer.search(/\r\n\r\n|\n\n/);
      if (sep === -1) {
        return;
      }
      const block = this.buffer.slice(0, sep);
      const m = this.buffer.slice(sep).match(/^\r\n\r\n|\n\n/);
      const skip = m ? m[0].length : 2;
      this.buffer = this.buffer.slice(sep + skip);

      const { event, data } = parseSseFrame(block);
      if (event === 'endpoint' && data.trim()) {
        try {
          // Prefer server-advertised runtime endpoint (often includes session_id)
          // over a manually configured fallback message endpoint.
          this.postUrl = resolveSseMessagePostUrl(data, this.server.endpoint);
        } catch {
          // ignore bad endpoint payload
        }
        continue;
      }
      if (!data.trim()) {
        continue;
      }
      if (event === 'message' || event === null || event === '') {
        this.tryDispatchJsonRpcData(data);
      } else if (event !== 'endpoint') {
        this.tryDispatchJsonRpcData(data);
      }
    }
  }

  private tryDispatchJsonRpcData(data: string): void {
    try {
      const msg = JSON.parse(data.trim()) as unknown;
      this.dispatchIncomingJsonRpc(msg);
    } catch {
      // non-json heartbeat, etc.
    }
  }

  private dispatchIncomingJsonRpc(msg: unknown): void {
    const list = Array.isArray(msg) ? msg : [msg];
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const r = item as Record<string, unknown>;
      if (r.jsonrpc !== '2.0' || r.id == null) {
        continue;
      }
      if (!('result' in r) && !('error' in r)) {
        continue;
      }
      const id = String(r.id);
      const entry = this.pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve(r as unknown as JsonRpcResponse);
      }
    }
  }

  async jsonRpcRequest(
    method: string,
    params: Record<string, unknown> | undefined,
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<{ result: unknown; sessionId: string | undefined }> {
    if (!this.postUrl) {
      throw new Error('MCP SSE: post URL not ready');
    }
    const requestId = `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    };

    const replyPromise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error('MCP SSE: timed out waiting for JSON-RPC response on the event stream'));
        }
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
    });

    const headers = buildHeaders(this.server);
    if (sessionId) {
      headers.set(MCP_SESSION_HEADER, sessionId);
    }

    const response = await fetch(this.postUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    const nextSession = readSessionFromResponse(response, sessionId);
    const text = await response.text();

    if (!response.ok) {
      const entry = this.pending.get(requestId);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(requestId);
      }
      throw new Error(
        `MCP request failed (${response.status}) ${response.statusText}${text ? `: ${text.slice(0, 280)}` : ''}`,
      );
    }

    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const reply = findJsonRpcResponseForId(arr, requestId);
        if (reply) {
          const entry = this.pending.get(requestId);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(requestId);
          }
          if (reply.error) {
            throw new Error(reply.error.message || `MCP method "${method}" failed`);
          }
          return { result: reply.result, sessionId: nextSession };
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          // wait for SSE
        } else {
          throw e;
        }
      }
    }

    const reply = await replyPromise;
    if (reply.error) {
      throw new Error(reply.error.message || `MCP method "${method}" failed`);
    }
    return { result: reply.result, sessionId: nextSession };
  }

  async sendNotification(method: string, sessionId: string | undefined, signal: AbortSignal): Promise<void> {
    if (!this.postUrl) {
      throw new Error('MCP SSE: post URL not ready');
    }
    const headers = buildHeaders(this.server);
    if (sessionId) {
      headers.set(MCP_SESSION_HEADER, sessionId);
    }
    const res = await fetch(this.postUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method }),
      signal,
    });
    if (res.status === 202 || res.ok) {
      return;
    }
    const t = await res.text().catch(() => '');
    throw new Error(`MCP notification failed (${res.status}): ${t.slice(0, 200)}`);
  }

  close(): void {
    this.abortController.abort();
  }
}

/** Parse SSE `data:` payloads as JSON values (MCP may stream JSON-RPC over SSE). */
function parseSseDataJsonObjects(sseBody: string): unknown[] {
  const out: unknown[] = [];
  const dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) {
      return;
    }
    const raw = dataLines.join('\n').trim();
    dataLines.length = 0;
    if (!raw) {
      return;
    }
    try {
      out.push(JSON.parse(raw));
    } catch {
      // ignore non-JSON segments
    }
  };

  for (const line of sseBody.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    } else if (line === '') {
      flush();
    }
  }
  flush();
  return out;
}

function flattenJsonRpcCandidates(messages: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (Array.isArray(m)) {
      out.push(...flattenJsonRpcCandidates(m));
    } else {
      out.push(m);
    }
  }
  return out;
}

function findJsonRpcResponseForId(messages: unknown[], requestId: string): JsonRpcResponse | null {
  const flat = flattenJsonRpcCandidates(messages);
  for (const item of flat) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const msg = item as Record<string, unknown>;
    if (msg.jsonrpc !== '2.0' || !('id' in msg)) {
      continue;
    }
    if (String(msg.id) !== String(requestId)) {
      continue;
    }
    if (!('result' in msg) && !('error' in msg)) {
      continue;
    }
    return msg as unknown as JsonRpcResponse;
  }
  return null;
}

function readSessionFromResponse(response: Response, previous: string | undefined): string | undefined {
  const headerVal = response.headers.get(MCP_SESSION_HEADER)?.trim();
  if (headerVal) {
    return headerVal;
  }
  return previous;
}

async function sendInitializedNotification(
  server: McpServerConfig,
  signal: AbortSignal,
  sessionId: string | undefined,
): Promise<void> {
  const headers = buildHeaders(server);
  if (sessionId) {
    headers.set(MCP_SESSION_HEADER, sessionId);
  }
  const response = await fetch(resolveStreamablePostEndpoint(server), {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    signal,
  });
  if (response.status === 202) {
    return;
  }
  if (response.ok) {
    return;
  }
  throw new Error(`MCP notifications/initialized failed (${response.status}) ${response.statusText}`);
}

async function postJsonRpcRequest(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown> | undefined,
  signal: AbortSignal,
  sessionId: string | undefined,
): Promise<{ result: unknown; sessionId: string | undefined }> {
  if (server.transport === 'sse') {
    throw new Error('Internal: use LegacyHttpSseSession for transport sse');
  }
  const requestId = `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params,
  };
  const endpoint = resolveStreamablePostEndpoint(server);
  const headers = buildHeaders(server);
  if (sessionId) {
    headers.set(MCP_SESSION_HEADER, sessionId);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  let nextSession = readSessionFromResponse(response, sessionId);

  if (response.status === 202) {
    return { result: undefined, sessionId: nextSession };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `MCP request failed (${response.status}) ${response.statusText}${errText ? `: ${errText.slice(0, 280)}` : ''}`,
    );
  }

  const contentType = response.headers.get('content-type') || '';

  const parseSseJsonRpcResult = (raw: string): unknown => {
    const messages = parseSseDataJsonObjects(raw);
    const reply = findJsonRpcResponseForId(messages, requestId);
    if (!reply) {
      throw new Error(
        'MCP server returned an SSE stream but no JSON-RPC response matching this request. Is the endpoint correct?',
      );
    }
    if (reply.error) {
      throw new Error(reply.error.message || `MCP method "${method}" failed`);
    }
    return reply.result;
  };

  const text = await response.text();

  if (contentType.includes('text/event-stream')) {
    const result = parseSseJsonRpcResult(text);
    return { result, sessionId: nextSession };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
  } catch {
    const result = parseSseJsonRpcResult(text);
    return { result, sessionId: nextSession };
  }

  const asArray = Array.isArray(parsed) ? parsed : [parsed];
  const reply = findJsonRpcResponseForId(asArray, requestId);
  if (!reply) {
    throw new Error('MCP server returned JSON without a matching JSON-RPC response id');
  }
  if (reply.error) {
    throw new Error(reply.error.message || `MCP method "${method}" failed`);
  }
  return { result: reply.result, sessionId: nextSession };
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs = DEFAULT_TIMEOUT_MS): AbortSignal {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error('MCP request timed out')), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => timeoutController.abort(signal.reason), { once: true });
  }
  timeoutController.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  return timeoutController.signal;
}

function normalizeToolRecords(raw: unknown[]): McpDiscoveredTool[] {
  return raw
    .filter((tool: unknown) => Boolean(tool && typeof tool === 'object'))
    .map((tool: unknown) => {
      const toolRecord = tool as Record<string, unknown>;
      return {
        name: String(toolRecord.name || ''),
        description: typeof toolRecord.description === 'string' ? toolRecord.description : undefined,
        inputSchema: toolRecord.inputSchema,
      };
    })
    .filter((tool: McpDiscoveredTool) => Boolean(tool.name));
}

function toDiscoveredTools(result: unknown): McpDiscoveredTool[] {
  if (result == null) {
    return [];
  }
  if (Array.isArray(result)) {
    return normalizeToolRecords(result);
  }
  if (typeof result === 'object') {
    const o = result as Record<string, unknown>;
    if (Array.isArray(o.tools)) {
      return normalizeToolRecords(o.tools);
    }
  }
  return [];
}

export async function discoverMcpTools(
  server: McpServerConfig,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<McpDiscoveredTool[]> {
  const signal = withTimeout(options?.signal, options?.timeoutMs);

  if (server.transport === 'sse') {
    const legacy = await LegacyHttpSseSession.connect(server, signal);
    try {
      let sessionId: string | undefined;
      const init = await legacy.jsonRpcRequest(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'nanobrowser', version: '0.1.0' },
        },
        undefined,
        signal,
      );
      sessionId = init.sessionId;
      await legacy.sendNotification('notifications/initialized', sessionId, signal);
      const listed = await legacy.jsonRpcRequest('tools/list', {}, sessionId, signal);
      return toDiscoveredTools(listed.result);
    } finally {
      legacy.close();
    }
  }

  let sessionId: string | undefined;

  const init = await postJsonRpcRequest(
    server,
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nanobrowser', version: '0.1.0' },
    },
    signal,
    undefined,
  );
  sessionId = init.sessionId;

  await sendInitializedNotification(server, signal, sessionId);

  const listed = await postJsonRpcRequest(server, 'tools/list', {}, signal, sessionId);
  sessionId = listed.sessionId ?? sessionId;

  return toDiscoveredTools(listed.result);
}

export async function executeMcpTool(
  server: McpServerConfig,
  params: {
    toolName: string;
    argumentsInput: Record<string, unknown>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<McpCallToolResult> {
  const signal = withTimeout(params.signal, params.timeoutMs);
  let sessionId: string | undefined;
  let result: unknown;

  if (server.transport === 'sse') {
    const legacy = await LegacyHttpSseSession.connect(server, signal);
    try {
      const init = await legacy.jsonRpcRequest(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'nanobrowser', version: '0.1.0' },
        },
        undefined,
        signal,
      );
      sessionId = init.sessionId;
      await legacy.sendNotification('notifications/initialized', sessionId, signal);
      const called = await legacy.jsonRpcRequest(
        'tools/call',
        {
          name: params.toolName,
          arguments: params.argumentsInput,
        },
        sessionId,
        signal,
      );
      result = called.result;
    } finally {
      legacy.close();
    }
  } else {
    const init = await postJsonRpcRequest(
      server,
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'nanobrowser', version: '0.1.0' },
      },
      signal,
      undefined,
    );
    sessionId = init.sessionId;

    await sendInitializedNotification(server, signal, sessionId);

    const called = await postJsonRpcRequest(
      server,
      'tools/call',
      {
        name: params.toolName,
        arguments: params.argumentsInput,
      },
      signal,
      sessionId,
    );
    result = called.result;
  }

  const serialized = normalizeMcpResultContent(result);
  const truncatedResult = truncate(serialized, MAX_TOOL_RESULT_CHARS);
  return {
    content: truncatedResult.text,
    rawResult: result,
    truncated: truncatedResult.truncated,
  };
}
