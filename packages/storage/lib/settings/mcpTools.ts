import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export type McpTransport = 'streamable_http' | 'sse';
export type McpAuthType = 'none' | 'bearer';
export type McpToolAccessMode = 'all' | 'allowlist';

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  endpoint: string;
  sseMessageEndpoint?: string;
  authType: McpAuthType;
  authToken: string;
  toolAccessMode: McpToolAccessMode;
  allowedTools: string[];
}

export interface McpToolsSettingsConfig {
  enabled: boolean;
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
  enabled: false,
  servers: [],
};

function normalizeServerEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function normalizeAllowedTools(tools: string[]): string[] {
  return Array.from(new Set(tools.map(tool => tool.trim()).filter(Boolean)));
}

function normalizeServer(server: McpServerConfig): McpServerConfig {
  const endpoint = normalizeServerEndpoint(server.endpoint);
  const sseMessageEndpoint = server.sseMessageEndpoint ? normalizeServerEndpoint(server.sseMessageEndpoint) : undefined;
  return {
    ...server,
    id: server.id.trim(),
    name: server.name.trim() || 'MCP Server',
    endpoint,
    sseMessageEndpoint,
    authToken: server.authToken.trim(),
    allowedTools: normalizeAllowedTools(server.allowedTools),
  };
}

function normalizeSettings(settings: McpToolsSettingsConfig): McpToolsSettingsConfig {
  return {
    enabled: Boolean(settings.enabled),
    servers: settings.servers
      .filter(server => Boolean(server?.id?.trim() && server?.endpoint?.trim()))
      .map(server => normalizeServer(server)),
  };
}

const storage = createStorage<McpToolsSettingsConfig>('mcp-tools-settings', DEFAULT_MCP_TOOLS_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const mcpToolsSettingsStore: McpToolsSettingsStorage = {
  ...storage,
  async getSettings() {
    const settings = await storage.get();
    return normalizeSettings({
      ...DEFAULT_MCP_TOOLS_SETTINGS,
      ...settings,
      servers: settings?.servers ?? DEFAULT_MCP_TOOLS_SETTINGS.servers,
    });
  },
  async updateSettings(settings: Partial<McpToolsSettingsConfig>) {
    const current = await this.getSettings();
    const next = normalizeSettings({
      ...current,
      ...settings,
      servers: settings.servers ?? current.servers,
    });
    await storage.set(next);
  },
  async upsertServer(server: McpServerConfig) {
    const current = await this.getSettings();
    const normalizedServer = normalizeServer(server);
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
