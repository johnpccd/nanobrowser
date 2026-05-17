import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

/** Prefix for active persona id when a Foundry agent is selected. */
export const FOUNDRY_SELECTION_PREFIX = 'azf:';

/** Display prefix shown in the QA persona dropdown. */
export const FOUNDRY_DISPLAY_PREFIX = 'AzF: ';

export interface FoundryAgent {
  id: string;
  name: string;
  /** e.g. https://{account}.services.ai.azure.com/api/projects/{project} */
  projectEndpoint: string;
  /**
   * Agent resource name, e.g. eng-agent-impact-analysis.
   * Portal format `name:version` (e.g. eng-agent-impact-analysis:1) is also accepted.
   */
  agentName: string;
  /** Optional agent version when not using the name:version suffix. */
  agentVersion?: string;
  apiKey: string;
  /** @deprecated Advanced override only; normal path uses project openai/v1/responses. */
  responsesEndpoint?: string;
  /** @deprecated Not used by the project responses API. */
  openaiBaseUrl?: string;
  /** Memory store attached to the agent (memory_search_preview tool). */
  memoryStoreName?: string;
  /** Scope for memory APIs (user id or stable identifier). */
  memoryScope?: string;
}

export interface FoundryAgentsConfig {
  agents: FoundryAgent[];
}

export type FoundryAgentsStorage = BaseStorage<FoundryAgentsConfig> & {
  getSettings: () => Promise<FoundryAgentsConfig>;
  upsertAgent: (agent: FoundryAgent) => Promise<void>;
  removeAgent: (agentId: string) => Promise<void>;
  getAgent: (agentId: string) => Promise<FoundryAgent | undefined>;
};

export const DEFAULT_FOUNDRY_AGENTS_SETTINGS: FoundryAgentsConfig = {
  agents: [],
};

export function toFoundrySelectionId(agentId: string): string {
  return `${FOUNDRY_SELECTION_PREFIX}${agentId.trim()}`;
}

export function parseFoundrySelectionId(selectionId: string): string | null {
  const id = selectionId.trim();
  if (!id.startsWith(FOUNDRY_SELECTION_PREFIX)) {
    return null;
  }
  const agentId = id.slice(FOUNDRY_SELECTION_PREFIX.length).trim();
  return agentId || null;
}

export function isFoundrySelectionId(selectionId: string): boolean {
  return selectionId.trim().startsWith(FOUNDRY_SELECTION_PREFIX);
}

export interface FoundryAgentReference {
  name: string;
  version?: string;
}

/** Split portal-style `agent:version` or use explicit agentVersion. */
export function resolveFoundryAgentReference(agent: FoundryAgent): FoundryAgentReference {
  const explicitVersion = agent.agentVersion?.trim();
  const rawName = agent.agentName.trim();
  if (explicitVersion) {
    return { name: rawName.split(':')[0]!.trim() || rawName, version: explicitVersion };
  }
  const parts = rawName.split(':', 2);
  if (parts.length > 1 && parts[1]?.trim()) {
    return { name: parts[0]!.trim(), version: parts[1]!.trim() };
  }
  return { name: rawName };
}

export function buildFoundryProjectOpenAiUrl(projectEndpoint: string, path: string): string {
  const base = projectEndpoint.trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Resolved POST URL for streaming responses (project openai/v1 API). */
export function buildFoundryResponsesRequestUrl(agent: FoundryAgent): string {
  const override = agent.responsesEndpoint?.trim();
  if (override) {
    return override.replace(/\/+$/, '');
  }
  return buildFoundryProjectOpenAiUrl(agent.projectEndpoint, '/openai/v1/responses');
}

/** @deprecated Legacy agent protocol URL; shown for reference only. */
export function buildFoundryResponsesEndpoint(agent: FoundryAgent): string {
  const override = agent.responsesEndpoint?.trim();
  if (override) {
    return override.replace(/\/+$/, '');
  }
  const base = agent.projectEndpoint.trim().replace(/\/+$/, '');
  const { name } = resolveFoundryAgentReference(agent);
  return `${base}/agents/${encodeURIComponent(name)}/endpoint/protocols/openai/v1/responses`;
}

function normalizeAgent(agent: FoundryAgent): FoundryAgent | null {
  const id = agent.id.trim();
  const projectEndpoint = agent.projectEndpoint.trim().replace(/\/+$/, '');
  const agentName = agent.agentName.trim();
  if (!id || !projectEndpoint || !agentName) {
    return null;
  }

  return {
    id,
    name: agent.name.trim() || agentName.split(':')[0]!.trim() || agentName,
    projectEndpoint,
    agentName,
    agentVersion: agent.agentVersion?.trim() || undefined,
    apiKey: agent.apiKey.trim(),
    responsesEndpoint: agent.responsesEndpoint?.trim() || undefined,
    openaiBaseUrl: agent.openaiBaseUrl?.trim().replace(/\/+$/, '') || undefined,
    memoryStoreName: agent.memoryStoreName?.trim() || undefined,
    memoryScope: agent.memoryScope?.trim() || undefined,
  };
}

function normalizeSettings(settings: FoundryAgentsConfig): FoundryAgentsConfig {
  const byId = new Map<string, FoundryAgent>();
  for (const agent of settings.agents) {
    const normalized = normalizeAgent(agent);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  }

  const agents = Array.from(byId.values());
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents };
}

const storage = createStorage<FoundryAgentsConfig>('foundry-agents-settings', DEFAULT_FOUNDRY_AGENTS_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const foundryAgentsStore: FoundryAgentsStorage = {
  ...storage,
  async getSettings() {
    const settings = await storage.get();
    return normalizeSettings({
      agents: settings?.agents ?? DEFAULT_FOUNDRY_AGENTS_SETTINGS.agents,
    });
  },
  async getAgent(agentId: string) {
    const settings = await this.getSettings();
    return settings.agents.find(agent => agent.id === agentId.trim());
  },
  async upsertAgent(agent: FoundryAgent) {
    const normalized = normalizeAgent(agent);
    if (!normalized) {
      return;
    }

    const current = await this.getSettings();
    const existingIndex = current.agents.findIndex(item => item.id === normalized.id);
    const agents =
      existingIndex >= 0
        ? current.agents.map((item, index) => (index === existingIndex ? normalized : item))
        : [...current.agents, normalized];

    await storage.set(normalizeSettings({ agents }));
  },
  async removeAgent(agentId: string) {
    const id = agentId.trim();
    const current = await this.getSettings();
    await storage.set(
      normalizeSettings({
        agents: current.agents.filter(agent => agent.id !== id),
      }),
    );
  },
};
