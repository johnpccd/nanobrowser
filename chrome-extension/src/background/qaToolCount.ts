import { generalSettingsStore } from '@extension/storage';
import type { McpServerConfig } from '@extension/storage/lib/settings/mcpTools';
import { mcpToolsSettingsStore } from '@extension/storage/lib/settings/mcpTools';
import { discoverMcpTools, type McpDiscoveredTool } from './services/mcpClient';

/**
 * Count QA tools that can bind on the next reply: built-ins that pass registration
 * checks plus MCP tools explicitly enabled per tool (via discovery; failures count as 0 for that server).
 */
export async function computeQaEnabledToolCount(): Promise<number> {
  const general = await generalSettingsStore.getSettings();
  const mcp = await mcpToolsSettingsStore.getSettings();

  let count = 0;
  if (general.qaEnableThinkingTool) {
    count += 1;
  }
  const hasSearxng = Boolean(general.searxngBaseUrl?.trim());
  if (general.qaEnableWebSearchTool && hasSearxng) {
    count += 1;
  }
  if (general.qaEnableFetchUrlTool && hasSearxng) {
    count += 1;
  }

  const servers = mcp.servers.filter(s => s.endpoint?.trim());
  const perServer = await Promise.all(servers.map(async server => countToolsForServer(server, { timeoutMs: 6000 })));

  return count + perServer.reduce((a, b) => a + b, 0);
}

async function countToolsForServer(server: McpServerConfig, opts: { timeoutMs: number }): Promise<number> {
  let tools: McpDiscoveredTool[];
  try {
    tools = await discoverMcpTools(server, { timeoutMs: opts.timeoutMs });
  } catch {
    return 0;
  }
  const names = tools.map(t => String(t.name).trim()).filter(Boolean);
  if (server.enabledToolNames === null) {
    return names.length;
  }
  const enabled = new Set(server.enabledToolNames);
  return names.filter(n => enabled.has(n)).length;
}

let qaToolCountCache: { at: number; value: number } | null = null;
const QA_TOOL_COUNT_CACHE_TTL_MS = 20_000;

export function invalidateQaToolCountCache(): void {
  qaToolCountCache = null;
}

/** Same as {@link computeQaEnabledToolCount} but reuses a short-lived cache for frequent UI updates. */
export async function getQaEnabledToolCountCached(): Promise<number> {
  const now = Date.now();
  if (qaToolCountCache && now - qaToolCountCache.at < QA_TOOL_COUNT_CACHE_TTL_MS) {
    return qaToolCountCache.value;
  }
  const value = await computeQaEnabledToolCount();
  qaToolCountCache = { at: now, value };
  return value;
}
