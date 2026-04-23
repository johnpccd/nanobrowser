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

function resolvePostEndpoint(server: McpServerConfig): string {
  if (server.transport === 'streamable_http') {
    return server.endpoint;
  }
  if (server.sseMessageEndpoint?.trim()) {
    return server.sseMessageEndpoint.trim();
  }
  return `${server.endpoint.replace(/\/+$/, '')}/messages`;
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
    return msg as JsonRpcResponse;
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
  const response = await fetch(resolvePostEndpoint(server), {
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
  const requestId = `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params,
  };
  const endpoint = resolvePostEndpoint(server);
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

  const result = called.result;
  const serialized = stringifySafe(result);
  const truncatedResult = truncate(serialized, MAX_TOOL_RESULT_CHARS);
  return {
    content: truncatedResult.text,
    rawResult: result,
    truncated: truncatedResult.truncated,
  };
}
