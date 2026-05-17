import type { FoundryAgent } from '@extension/storage';

const FOUNDRY_MEMORY_API_VERSION = 'v1';
const FOUNDRY_MEMORY_FEATURE = 'MemoryStores=V1Preview';
const UPDATE_POLL_INTERVAL_MS = 1500;
const UPDATE_POLL_MAX_ATTEMPTS = 60;

export interface FoundryMemoryItem {
  memoryId: string;
  kind: string;
  content: string;
  scope: string;
  updatedAt?: number;
}

export interface FoundryMemoryStoreSummary {
  name: string;
  id?: string;
  description?: string;
  chatModel?: string;
  embeddingModel?: string;
}

function memoryHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'api-key': apiKey.trim(),
    'Foundry-Features': FOUNDRY_MEMORY_FEATURE,
  };
}

function buildMemoryUrl(projectEndpoint: string, path: string): string {
  const base = projectEndpoint.trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const separator = suffix.includes('?') ? '&' : '?';
  return `${base}${suffix}${separator}api-version=${FOUNDRY_MEMORY_API_VERSION}`;
}

async function readFoundryError(response: Response): Promise<string> {
  const errorBody = await response.text().catch(() => '');
  return errorBody.slice(0, 500) || response.statusText;
}

/** Parse nested Foundry memory update failure (often model deployment auth). */
export function formatMemoryOperationError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'Memory update failed.';
  }
  const record = payload as Record<string, unknown>;
  const error = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : record;

  const parts: string[] = [];
  if (typeof error.message === 'string' && error.message.trim()) {
    parts.push(error.message.trim());
  }

  const details =
    error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : error.additionalInfo && typeof error.additionalInfo === 'object'
        ? (error.additionalInfo as Record<string, unknown>)
        : null;

  if (details) {
    if (typeof details.deployment === 'string' && details.deployment.trim()) {
      parts.push(`Deployment: ${details.deployment.trim()}`);
    }
    if (typeof details.description === 'string' && details.description.trim()) {
      parts.push(details.description.trim());
    }
    if (typeof details.type === 'string' && details.type.trim()) {
      parts.push(`(${details.type})`);
    }
  }

  if (parts.length === 0) {
    return 'Memory update failed.';
  }

  parts.push(
    'Memory add/edit runs on the memory store’s chat and embedding deployments (not your agent model). In Azure Foundry, open the memory store and ensure those deployments exist and accept this API key.',
  );
  return parts.join(' ');
}

export function parseMemoryStoreRecord(row: unknown): FoundryMemoryStoreSummary | null {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const record = row as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) {
    return null;
  }

  let chatModel: string | undefined;
  let embeddingModel: string | undefined;
  const definition = record.definition;
  if (definition && typeof definition === 'object') {
    const def = definition as Record<string, unknown>;
    if (typeof def.chat_model === 'string') {
      chatModel = def.chat_model.trim() || undefined;
    }
    if (typeof def.embedding_model === 'string') {
      embeddingModel = def.embedding_model.trim() || undefined;
    }
  }

  return {
    name,
    id: typeof record.id === 'string' ? record.id : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    chatModel,
    embeddingModel,
  };
}

function parseMemoryItem(raw: unknown): FoundryMemoryItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const item =
    record.memory_item && typeof record.memory_item === 'object'
      ? (record.memory_item as Record<string, unknown>)
      : record;
  const memoryId = typeof item.memory_id === 'string' ? item.memory_id.trim() : '';
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  if (!memoryId || !content) {
    return null;
  }
  return {
    memoryId,
    kind: typeof item.kind === 'string' ? item.kind : 'unknown',
    content,
    scope: typeof item.scope === 'string' ? item.scope : '',
    updatedAt: typeof item.updated_at === 'number' ? item.updated_at : undefined,
  };
}

/** REST + SDK-compatible user message for update_memories. */
export function buildUserMessageItem(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  return {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: trimmed }],
  };
}

function assertAgentMemoryConfig(agent: FoundryAgent, memoryStoreName: string, scope: string): void {
  if (!agent.projectEndpoint.trim() || !agent.apiKey.trim()) {
    throw new Error('Configure project endpoint and API key before using memory APIs.');
  }
  if (!memoryStoreName.trim()) {
    throw new Error('Memory store name is required.');
  }
  if (!scope.trim()) {
    throw new Error('Memory scope is required.');
  }
}

async function pollMemoryUpdate(
  agent: FoundryAgent,
  memoryStoreName: string,
  updateId: string,
  signal?: AbortSignal,
): Promise<FoundryMemoryItem[]> {
  const url = buildMemoryUrl(
    agent.projectEndpoint,
    `/memory_stores/${encodeURIComponent(memoryStoreName)}/updates/${encodeURIComponent(updateId)}`,
  );

  for (let attempt = 0; attempt < UPDATE_POLL_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      throw new Error('Memory update was cancelled.');
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: memoryHeaders(agent.apiKey),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Memory update status failed (${response.status}): ${await readFoundryError(response)}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const status = typeof json.status === 'string' ? json.status : '';

    if (status === 'failed') {
      throw new Error(formatMemoryOperationError(json));
    }

    if (status === 'completed') {
      const result = json.result as Record<string, unknown> | undefined;
      const operations = Array.isArray(result?.memory_operations) ? result.memory_operations : [];
      return operations.map(op => parseMemoryItem(op)).filter((item): item is FoundryMemoryItem => item !== null);
    }

    if (status === 'superseded') {
      throw new Error('Memory update was superseded by a newer request. Try again.');
    }

    await new Promise(resolve => setTimeout(resolve, UPDATE_POLL_INTERVAL_MS));
  }

  throw new Error('Memory update timed out. Check the memory store in Azure Foundry.');
}

export async function getFoundryMemoryStore(
  agent: FoundryAgent,
  memoryStoreName: string,
  signal?: AbortSignal,
): Promise<FoundryMemoryStoreSummary> {
  if (!agent.projectEndpoint.trim() || !agent.apiKey.trim()) {
    throw new Error('Configure project endpoint and API key before loading memory stores.');
  }
  const name = memoryStoreName.trim();
  if (!name) {
    throw new Error('Memory store name is required.');
  }

  const url = buildMemoryUrl(agent.projectEndpoint, `/memory_stores/${encodeURIComponent(name)}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: memoryHeaders(agent.apiKey),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Get memory store failed (${response.status}): ${await readFoundryError(response)}`);
  }

  const json = (await response.json()) as unknown;
  const parsed = parseMemoryStoreRecord(json);
  if (!parsed) {
    throw new Error('Memory store response was invalid.');
  }
  return parsed;
}

export async function listFoundryMemoryStores(
  agent: FoundryAgent,
  signal?: AbortSignal,
): Promise<FoundryMemoryStoreSummary[]> {
  if (!agent.projectEndpoint.trim() || !agent.apiKey.trim()) {
    throw new Error('Configure project endpoint and API key before listing memory stores.');
  }

  const url = buildMemoryUrl(agent.projectEndpoint, '/memory_stores');
  const response = await fetch(url, {
    method: 'GET',
    headers: memoryHeaders(agent.apiKey),
    signal,
  });

  if (!response.ok) {
    throw new Error(`List memory stores failed (${response.status}): ${await readFoundryError(response)}`);
  }

  const json = (await response.json()) as { data?: unknown[] };
  const rows = Array.isArray(json.data) ? json.data : [];
  const stores: FoundryMemoryStoreSummary[] = [];
  for (const row of rows) {
    const parsed = parseMemoryStoreRecord(row);
    if (parsed) {
      stores.push(parsed);
    }
  }
  return stores;
}

export async function searchFoundryMemories(params: {
  agent: FoundryAgent;
  memoryStoreName: string;
  scope: string;
  query?: string;
  maxMemories?: number;
  signal?: AbortSignal;
}): Promise<FoundryMemoryItem[]> {
  const { agent, memoryStoreName, scope, query, maxMemories = 50, signal } = params;
  assertAgentMemoryConfig(agent, memoryStoreName, scope);

  const body: Record<string, unknown> = {
    scope: scope.trim(),
    options: { max_memories: maxMemories },
  };
  const trimmedQuery = query?.trim();
  if (trimmedQuery) {
    body.items = [buildUserMessageItem(trimmedQuery)];
  }

  const url = buildMemoryUrl(
    agent.projectEndpoint,
    `/memory_stores/${encodeURIComponent(memoryStoreName.trim())}:search_memories`,
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: memoryHeaders(agent.apiKey),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Search memories failed (${response.status}): ${await readFoundryError(response)}`);
  }

  const json = (await response.json()) as { memories?: unknown[] };
  const memories = Array.isArray(json.memories) ? json.memories : [];
  const parsed = memories.map(item => parseMemoryItem(item)).filter((item): item is FoundryMemoryItem => item !== null);

  const byId = new Map<string, FoundryMemoryItem>();
  for (const item of parsed) {
    byId.set(item.memoryId, item);
  }
  return Array.from(byId.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function updateFoundryMemoriesFromText(params: {
  agent: FoundryAgent;
  memoryStoreName: string;
  scope: string;
  content: string;
  signal?: AbortSignal;
}): Promise<FoundryMemoryItem[]> {
  const { agent, memoryStoreName, scope, content, signal } = params;
  assertAgentMemoryConfig(agent, memoryStoreName, scope);
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Memory content is required.');
  }

  const url = buildMemoryUrl(
    agent.projectEndpoint,
    `/memory_stores/${encodeURIComponent(memoryStoreName.trim())}:update_memories`,
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: memoryHeaders(agent.apiKey),
    body: JSON.stringify({
      scope: scope.trim(),
      items: [buildUserMessageItem(trimmed)],
      update_delay: 0,
    }),
    signal,
  });

  if (!response.ok && response.status !== 202) {
    throw new Error(`Update memories failed (${response.status}): ${await readFoundryError(response)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const updateId = typeof json.update_id === 'string' ? json.update_id.trim() : '';
  if (!updateId) {
    throw new Error('Memory update returned no update id.');
  }

  const status = typeof json.status === 'string' ? json.status : '';
  if (status === 'failed') {
    throw new Error(formatMemoryOperationError(json));
  }
  if (status === 'completed') {
    const result = json.result as Record<string, unknown> | undefined;
    const operations = Array.isArray(result?.memory_operations) ? result.memory_operations : [];
    return operations.map(op => parseMemoryItem(op)).filter((item): item is FoundryMemoryItem => item !== null);
  }

  return pollMemoryUpdate(agent, memoryStoreName.trim(), updateId, signal);
}

export async function deleteFoundryMemoryScope(params: {
  agent: FoundryAgent;
  memoryStoreName: string;
  scope: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { agent, memoryStoreName, scope, signal } = params;
  assertAgentMemoryConfig(agent, memoryStoreName, scope);

  const url = buildMemoryUrl(
    agent.projectEndpoint,
    `/memory_stores/${encodeURIComponent(memoryStoreName.trim())}:delete_scope`,
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: memoryHeaders(agent.apiKey),
    body: JSON.stringify({ scope: scope.trim() }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Delete memory scope failed (${response.status}): ${await readFoundryError(response)}`);
  }
}
