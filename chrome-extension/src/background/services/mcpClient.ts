import type { McpServerConfig } from '@extension/storage';

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_TOOL_RESULT_CHARS = 12000;

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

async function postJsonRpc(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown> | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const requestId = `${method}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params,
  };
  const endpoint = resolvePostEndpoint(server);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(server),
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`MCP request failed (${response.status}) ${response.statusText}`);
  }
  const body = (await response.json()) as JsonRpcResponse;
  if (body.error) {
    throw new Error(body.error.message || `MCP method "${method}" failed`);
  }
  return body.result;
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

function toDiscoveredTools(result: unknown): McpDiscoveredTool[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const maybeTools = (result as { tools?: unknown[] }).tools;
  const tools: unknown[] = Array.isArray(maybeTools) ? maybeTools : [];
  return tools
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

export async function discoverMcpTools(
  server: McpServerConfig,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<McpDiscoveredTool[]> {
  const signal = withTimeout(options?.signal, options?.timeoutMs);
  await postJsonRpc(
    server,
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nanobrowser', version: '0.1.0' },
    },
    signal,
  );
  const result = await postJsonRpc(server, 'tools/list', {}, signal);
  return toDiscoveredTools(result);
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
  await postJsonRpc(
    server,
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nanobrowser', version: '0.1.0' },
    },
    signal,
  );
  const result = await postJsonRpc(
    server,
    'tools/call',
    {
      name: params.toolName,
      arguments: params.argumentsInput,
    },
    signal,
  );
  const serialized = stringifySafe(result);
  const truncatedResult = truncate(serialized, MAX_TOOL_RESULT_CHARS);
  return {
    content: truncatedResult.text,
    rawResult: result,
    truncated: truncatedResult.truncated,
  };
}
