import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export type McpTransport = 'streamable_http' | 'sse';
export type McpAuthType = 'none' | 'bearer';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  endpoint: string;
  sseMessageEndpoint?: string;
  authType: McpAuthType;
  authToken: string;
  /**
   * `null`: all discovered tools on this server are enabled.
   * `[]`: none enabled.
   * Non-empty array: only these tool names are enabled (discovery may add tools that stay off until enabled in QA).
   */
  enabledToolNames: string[] | null;
}

export interface McpToolsSettingsConfig {
  servers: McpServerConfig[];
}

export type McpToolsSettingsStorage = BaseStorage<McpToolsSettingsConfig> & {
  getSettings: () => Promise<McpToolsSettingsConfig>;
  updateSettings: (settings: Partial<McpToolsSettingsConfig>) => Promise<void>;
  upsertServer: (server: McpServerConfig) => Promise<void>;
  removeServer: (serverId: string) => Promise<void>;
  resetToDefaults: () => Promise<void>;
};

export const DEFAULT_MCP_TOOLS_SETTINGS: McpToolsSettingsConfig = {
  servers: [],
};

/** Raw persisted shape — may include pre–per-tool fields until next save. */
type RawMcpServer = Partial<McpServerConfig> & {
  enabled?: boolean;
  toolAccessMode?: 'all' | 'allowlist';
  allowedTools?: string[];
};

type RawMcpSettings = Partial<McpToolsSettingsConfig> & {
  /** @deprecated migrated away */
  enabled?: boolean;
};

function normalizeServerEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function uniqToolNames(names: string[]): string[] {
  return Array.from(new Set(names.map(n => String(n).trim()).filter(Boolean)));
}

/**
 * Computes next `enabledToolNames` after toggling one tool against the latest discovery list.
 */
export function nextEnabledToolNamesForToggle(
  current: string[] | null,
  discoveredNames: string[],
  toolName: string,
  nextEnabled: boolean,
): string[] | null {
  const uniqDiscovered = uniqToolNames(discoveredNames);
  const setDiscovered = new Set(uniqDiscovered);
  const inDiscovery = toolName.trim() !== '' && setDiscovered.has(toolName);
  const effectiveDiscovery = uniqDiscovered;

  let working: Set<string>;

  if (current === null) {
    working = new Set(effectiveDiscovery);
  } else {
    working = new Set(current.filter(n => setDiscovered.has(n)));
  }

  if (nextEnabled) {
    if (inDiscovery) {
      working.add(toolName);
    }
  } else {
    working.delete(toolName);
  }

  const nextArr = uniqToolNames(Array.from(working));
  const allOn =
    effectiveDiscovery.length > 0 &&
    effectiveDiscovery.every(n => nextArr.includes(n)) &&
    nextArr.length === effectiveDiscovery.length;

  if (effectiveDiscovery.length === 0) {
    return [];
  }

  if (allOn) {
    return null;
  }

  return nextArr;
}

function migratedEnabledToolNames(raw: RawMcpServer, legacyGlobalMcpDisabled: boolean): string[] | null {
  if (legacyGlobalMcpDisabled) {
    return [];
  }

  if ('enabledToolNames' in raw) {
    const value = raw.enabledToolNames;
    if (value === null) {
      return null;
    }
    if (Array.isArray(value)) {
      return uniqToolNames(value as string[]);
    }
    return null;
  }

  const serverEnabledLegacy = raw.enabled;
  const toolAccessMode = raw.toolAccessMode;
  const allowedTools = raw.allowedTools;

  if (serverEnabledLegacy === false) {
    return [];
  }
  if (toolAccessMode === 'allowlist') {
    const list = uniqToolNames(Array.isArray(allowedTools) ? allowedTools : []);
    return list.length > 0 ? list : [];
  }

  return null;
}

export function normalizeServer(server: RawMcpServer, legacyGlobalMcpDisabled: boolean): McpServerConfig {
  const endpoint = normalizeServerEndpoint(server.endpoint ?? '');
  const sseMessageEndpoint = server.sseMessageEndpoint ? normalizeServerEndpoint(server.sseMessageEndpoint) : undefined;
  const migratedEnabled = migratedEnabledToolNames(server, legacyGlobalMcpDisabled);

  return {
    id: String(server.id ?? '').trim(),
    name: String(server.name ?? '').trim() || 'MCP Server',
    transport: server.transport === 'sse' ? 'sse' : 'streamable_http',
    endpoint,
    sseMessageEndpoint,
    authType: server.authType === 'bearer' ? 'bearer' : 'none',
    authToken: String(server.authToken ?? '').trim(),
    enabledToolNames: migratedEnabled,
  };
}

function normalizeSettings(settings: RawMcpSettings): McpToolsSettingsConfig {
  const legacyGlobalMcpDisabled = settings.enabled === false;
  const serversRaw = settings.servers ?? [];

  return {
    servers: serversRaw
      .filter(s => Boolean(s?.id?.trim() && String(s.endpoint ?? '').trim()))
      .map(s => normalizeServer(s as RawMcpServer, legacyGlobalMcpDisabled)),
  };
}

const storage = createStorage<McpToolsSettingsConfig>('mcp-tools-settings', DEFAULT_MCP_TOOLS_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const mcpToolsSettingsStore: McpToolsSettingsStorage = {
  ...storage,
  async getSettings() {
    const raw = await storage.get();
    return normalizeSettings({
      ...DEFAULT_MCP_TOOLS_SETTINGS,
      ...raw,
      servers: raw?.servers ?? DEFAULT_MCP_TOOLS_SETTINGS.servers,
    });
  },
  async updateSettings(settings: Partial<McpToolsSettingsConfig>) {
    const current = await this.getSettings();
    const next = normalizeSettings({
      ...current,
      ...settings,
      servers: settings.servers ?? current.servers,
      enabled: undefined,
    });
    await storage.set(next);
  },
  async upsertServer(server: McpServerConfig) {
    const current = await this.getSettings();
    const normalizedServer = normalizeServer(server, false);
    const existingIndex = current.servers.findIndex(existing => existing.id === normalizedServer.id);
    const servers =
      existingIndex >= 0
        ? current.servers.map((existing, index) => (index === existingIndex ? normalizedServer : existing))
        : [...current.servers, normalizedServer];
    await this.updateSettings({ servers });
  },
  async removeServer(serverId: string) {
    const current = await this.getSettings();
    const normalizedId = serverId.trim();
    const servers = current.servers.filter(server => server.id !== normalizedId);
    await this.updateSettings({ servers });
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_MCP_TOOLS_SETTINGS);
  },
};
