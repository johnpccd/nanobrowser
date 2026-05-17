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

function buildUserMessageItem(text: string): Record<string, unknown> {
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
      const error = json.error as Record<string, unknown> | undefined;
      const message = typeof error?.message === 'string' ? error.message : 'Memory update failed.';
      throw new Error(message);
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
    if (!row || typeof row !== 'object') {
      continue;
    }
    const record = row as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) {
      continue;
    }
    stores.push({
      name,
      id: typeof record.id === 'string' ? record.id : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
    });
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
