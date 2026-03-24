import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

// Interface for general settings configuration
export interface GeneralSettingsConfig {
  maxSteps: number;
  maxActionsPerStep: number;
  maxFailures: number;
  useVision: boolean;
  useVisionForPlanner: boolean;
  planningInterval: number;
  displayHighlights: boolean;
  minWaitPageLoad: number;
  replayHistoricalTasks: boolean;
  includePageContent: boolean;
  fontSize: number;
  maxInputTokens: number;
  enableWebSearch: boolean;
  searxngBaseUrl: string;
  searxngApiKey: string;
  searxngMaxResults: number;
  jinaReaderApiKey: string;
}

export type GeneralSettingsStorage = BaseStorage<GeneralSettingsConfig> & {
  updateSettings: (settings: Partial<GeneralSettingsConfig>) => Promise<void>;
  getSettings: () => Promise<GeneralSettingsConfig>;
  resetToDefaults: () => Promise<void>;
};

// Default settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsConfig = {
  maxSteps: 100,
  maxActionsPerStep: 5,
  maxFailures: 3,
  useVision: false,
  useVisionForPlanner: false,
  planningInterval: 3,
  displayHighlights: true,
  minWaitPageLoad: 250,
  replayHistoricalTasks: false,
  includePageContent: true,
  fontSize: 14,
  maxInputTokens: 1000000,
  enableWebSearch: false,
  searxngBaseUrl: '',
  searxngApiKey: '',
  searxngMaxResults: 5,
  jinaReaderApiKey: '',
};

const storage = createStorage<GeneralSettingsConfig>('general-settings', DEFAULT_GENERAL_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const generalSettingsStore: GeneralSettingsStorage = {
  ...storage,
  async updateSettings(settings: Partial<GeneralSettingsConfig>) {
    const currentSettings = (await storage.get()) || DEFAULT_GENERAL_SETTINGS;
    const updatedSettings = {
      ...currentSettings,
      ...settings,
    };

    if (typeof updatedSettings.searxngBaseUrl === 'string') {
      updatedSettings.searxngBaseUrl = updatedSettings.searxngBaseUrl.trim().replace(/\/+$/, '');
    }

    if (typeof updatedSettings.jinaReaderApiKey === 'string') {
      updatedSettings.jinaReaderApiKey = updatedSettings.jinaReaderApiKey.trim();
    }

    if (typeof updatedSettings.searxngMaxResults === 'number') {
      updatedSettings.searxngMaxResults = Math.min(10, Math.max(1, Math.round(updatedSettings.searxngMaxResults)));
    }

    // If useVision is true, displayHighlights must also be true
    if (updatedSettings.useVision && !updatedSettings.displayHighlights) {
      updatedSettings.displayHighlights = true;
    }

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...settings,
    };
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};
