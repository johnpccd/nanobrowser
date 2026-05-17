/**
 * Live verification of Foundry Memory Store REST API (same paths/headers as foundryMemoryClient.ts).
 * Usage:
 *   FOUNDRY_PROJECT_ENDPOINT=... FOUNDRY_API_KEY=... node scripts/verify-foundry-memory.mjs [storeName] [scope]
 */
const API_VERSION = 'v1';
const FEATURE = 'MemoryStores=V1Preview';
const SCOPE = process.argv[3]?.trim() || '55555555555';

const endpoint = (process.env.FOUNDRY_PROJECT_ENDPOINT || '').replace(/\/+$/, '');
const apiKey = (process.env.FOUNDRY_API_KEY || '').trim();
const storeNameArg = process.argv[2]?.trim();

if (!endpoint || !apiKey) {
  console.error('Set FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_API_KEY');
  process.exit(1);
}

function url(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${endpoint}${path.startsWith('/') ? path : `/${path}`}${sep}api-version=${API_VERSION}`;
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'api-key': apiKey,
    'Foundry-Features': FEATURE,
  };
}

async function request(method, path, body) {
  const res = await fetch(url(path), {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: res.status, ok: res.ok, json };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function pollUpdate(storeName, updateId) {
  for (let i = 0; i < 40; i++) {
    const r = await request(
      'GET',
      `/memory_stores/${encodeURIComponent(storeName)}/updates/${encodeURIComponent(updateId)}`,
    );
    const status = r.json?.status;
    console.log(`  poll ${i + 1}: HTTP ${r.status} status=${status}`);
    if (status === 'completed') {
      console.log('  result ops:', r.json?.result?.memory_operations?.length ?? 0);
      return r;
    }
    if (status === 'failed') {
      console.log('  FAILED:', JSON.stringify(r.json?.error ?? r.json, null, 2));
      console.log(
        '\n  Likely fix: enable system-assigned managed identity on the Foundry project and assign',
      );
      console.log(
        '  Foundry User (Azure AI User) on the parent AI Services resource — memory runtime uses',
      );
      console.log(
        '  the project identity to call chat/embedding deployments, not your API key.',
      );
      console.log(
        '  https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/memory-usage#authorization-and-permissions',
      );
      return r;
    }
    await sleep(2000);
  }
  console.log('  poll timeout');
  return null;
}

async function main() {
  console.log('=== 1. LIST memory stores ===');
  const list = await request('GET', '/memory_stores');
  console.log('HTTP', list.status, list.ok ? 'OK' : 'FAIL');
  const stores = Array.isArray(list.json?.data) ? list.json.data : [];
  console.log('count:', stores.length);
  for (const s of stores) {
    const def = s.definition || {};
    console.log(`  - ${s.name}: chat_model=${def.chat_model} embedding_model=${def.embedding_model}`);
  }

  const storeName = storeNameArg || stores[0]?.name;
  if (!storeName) {
    console.error('No memory store found; pass store name as argv[2]');
    process.exit(1);
  }
  console.log('\nUsing store:', storeName, 'scope:', SCOPE);

  console.log('\n=== 2. GET memory store ===');
  const get = await request('GET', `/memory_stores/${encodeURIComponent(storeName)}`);
  console.log('HTTP', get.status);
  if (get.json?.definition) {
    console.log('definition:', JSON.stringify(get.json.definition, null, 2));
  }

  console.log('\n=== 3. SEARCH memories (static, no items) ===');
  const search = await request('POST', `/memory_stores/${encodeURIComponent(storeName)}:search_memories`, {
    scope: SCOPE,
    options: { max_memories: 10 },
  });
  console.log('HTTP', search.status);
  console.log('memories:', search.json?.memories?.length ?? 0);
  if (search.json?.memories?.length) {
    for (const m of search.json.memories.slice(0, 3)) {
      const item = m.memory_item || m;
      console.log(`  - [${item.kind}] ${String(item.content).slice(0, 80)}...`);
    }
  }

  console.log('\n=== 4. UPDATE memories (add test line) ===');
  const update = await request('POST', `/memory_stores/${encodeURIComponent(storeName)}:update_memories`, {
    scope: SCOPE,
    items: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Nanobrowser API verification: prefers concise answers.' }],
      },
    ],
    update_delay: 0,
  });
  console.log('HTTP', update.status);
  console.log('update_id:', update.json?.update_id, 'status:', update.json?.status);
  if (update.json?.status === 'failed') {
    console.log('immediate fail:', JSON.stringify(update.json?.error, null, 2));
    process.exit(1);
  }
  if (update.json?.update_id) {
    await pollUpdate(storeName, update.json.update_id);
  }

  console.log('\n=== 5. SEARCH again ===');
  const search2 = await request('POST', `/memory_stores/${encodeURIComponent(storeName)}:search_memories`, {
    scope: SCOPE,
    options: { max_memories: 10 },
  });
  console.log('HTTP', search2.status, 'memories:', search2.json?.memories?.length ?? 0);

  console.log('\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
