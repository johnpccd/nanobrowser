import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { clampOptionalFontSize, normalizeHexColor, sanitizeQaFontFamily } from './qaAppearanceUtils';

/** Matches @extension/i18n UiLocalePreference */
export type UiLocalePreference = 'auto' | 'en' | 'fr' | 'de' | 'it';

const UI_LOCALE_VALUES: UiLocalePreference[] = ['auto', 'en', 'fr', 'de', 'it'];

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
  /** When false, QA does not expose the internal `thinking` tool. */
  qaEnableThinkingTool: boolean;
  /**
   * When QA “web assist” is on (sidebar toggle / default preference), expose `web_search`
   * if SearXNG base URL is configured.
   */
  qaEnableWebSearchTool: boolean;
  /**
   * When QA web assist is on, expose `fetch_url` if SearXNG base URL is configured
   * (same gating as today for registering these tools together).
   */
  qaEnableFetchUrlTool: boolean;
  searxngBaseUrl: string;
  searxngApiKey: string;
  searxngMaxResults: number;
  jinaReaderApiKey: string;
  /** Max web_search, fetch_url, MCP, and unsupported tool calls per QA answer (thinking excluded). */
  qaMaxNonThinkingToolCalls: number;
  /** Max `thinking` tool calls per QA answer. */
  qaMaxThinkingCalls: number;
  /** Upper bound on QA tool-calling model round-trips per answer. */
  qaMaxToolRounds: number;
  /** QA / chat panel typography & colors (side panel QA mode). */
  qaFontFamily: string;
  qaChromeFontSize: number;
  qaInputFontSize: number;
  qaColorPanelBg: string;
  qaColorChatBg: string;
  qaColorMessageText: string;
  qaColorHeadingText: string;
  qaColorMutedText: string;
  qaColorLink: string;
  qaColorSeparator: string;
  qaColorInputSurface: string;
  qaColorInputBorder: string;
  qaColorInputText: string;
  qaColorAccent: string;
  /** Extension UI language; `auto` follows the browser locale. */
  uiLocale: UiLocalePreference;
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
  qaEnableThinkingTool: true,
  qaEnableWebSearchTool: false,
  qaEnableFetchUrlTool: false,
  searxngBaseUrl: '',
  searxngApiKey: '',
  searxngMaxResults: 5,
  jinaReaderApiKey: '',
  qaMaxNonThinkingToolCalls: 3,
  qaMaxThinkingCalls: 5,
  qaMaxToolRounds: 16,
  qaFontFamily: '',
  qaChromeFontSize: 13,
  qaInputFontSize: 14,
  qaColorPanelBg: '#0b1220',
  qaColorChatBg: '#0f172a',
  qaColorMessageText: '#f8fafc',
  qaColorHeadingText: '#ffffff',
  qaColorMutedText: '#94a3b8',
  qaColorLink: '#60a5fa',
  qaColorSeparator: '#334155',
  qaColorInputSurface: '#111827',
  qaColorInputBorder: '#334155',
  qaColorInputText: '#f9fafb',
  qaColorAccent: '#38bdf8',
  uiLocale: 'auto',
};

function applyQaAppearanceDefaultsIfEmpty(settings: GeneralSettingsConfig): GeneralSettingsConfig {
  const colorKeys: Array<keyof GeneralSettingsConfig> = [
    'qaColorPanelBg',
    'qaColorChatBg',
    'qaColorMessageText',
    'qaColorHeadingText',
    'qaColorMutedText',
    'qaColorLink',
    'qaColorSeparator',
    'qaColorInputSurface',
    'qaColorInputBorder',
    'qaColorInputText',
    'qaColorAccent',
  ];

  for (const key of colorKeys) {
    if (!settings[key]) {
      Object.assign(settings, { [key]: DEFAULT_GENERAL_SETTINGS[key] });
    }
  }

  if (!settings.qaChromeFontSize || settings.qaChromeFontSize <= 0) {
    settings.qaChromeFontSize = DEFAULT_GENERAL_SETTINGS.qaChromeFontSize;
  }
  if (!settings.qaInputFontSize || settings.qaInputFontSize <= 0) {
    settings.qaInputFontSize = DEFAULT_GENERAL_SETTINGS.qaInputFontSize;
  }

  return settings;
}

function clampQaToolBudgets(settings: GeneralSettingsConfig): GeneralSettingsConfig {
  const n = Number(settings.qaMaxNonThinkingToolCalls);
  const t = Number(settings.qaMaxThinkingCalls);
  const r = Number(settings.qaMaxToolRounds);
  settings.qaMaxNonThinkingToolCalls = Number.isFinite(n)
    ? Math.min(50, Math.max(1, Math.round(n)))
    : DEFAULT_GENERAL_SETTINGS.qaMaxNonThinkingToolCalls;
  settings.qaMaxThinkingCalls = Number.isFinite(t)
    ? Math.min(30, Math.max(0, Math.round(t)))
    : DEFAULT_GENERAL_SETTINGS.qaMaxThinkingCalls;
  settings.qaMaxToolRounds = Number.isFinite(r)
    ? Math.min(64, Math.max(1, Math.round(r)))
    : DEFAULT_GENERAL_SETTINGS.qaMaxToolRounds;
  return settings;
}

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

    if (typeof updatedSettings.uiLocale === 'string' && !UI_LOCALE_VALUES.includes(updatedSettings.uiLocale)) {
      updatedSettings.uiLocale = DEFAULT_GENERAL_SETTINGS.uiLocale;
    }

    if (typeof updatedSettings.qaFontFamily === 'string') {
      updatedSettings.qaFontFamily = sanitizeQaFontFamily(updatedSettings.qaFontFamily);
    }

    if (typeof updatedSettings.qaChromeFontSize === 'number') {
      updatedSettings.qaChromeFontSize = clampOptionalFontSize(updatedSettings.qaChromeFontSize, 10, 22);
    }

    if (typeof updatedSettings.qaInputFontSize === 'number') {
      updatedSettings.qaInputFontSize = clampOptionalFontSize(updatedSettings.qaInputFontSize, 10, 28);
    }

    const qaColorKeys = [
      'qaColorPanelBg',
      'qaColorChatBg',
      'qaColorMessageText',
      'qaColorHeadingText',
      'qaColorMutedText',
      'qaColorLink',
      'qaColorSeparator',
      'qaColorInputSurface',
      'qaColorInputBorder',
      'qaColorInputText',
      'qaColorAccent',
    ] as (keyof GeneralSettingsConfig)[];

    for (const key of qaColorKeys) {
      const v = updatedSettings[key];
      if (typeof v === 'string') {
        Object.assign(updatedSettings, { [key]: normalizeHexColor(v) });
      }
    }

    // If useVision is true, displayHighlights must also be true
    if (updatedSettings.useVision && !updatedSettings.displayHighlights) {
      updatedSettings.displayHighlights = true;
    }

    clampQaToolBudgets(updatedSettings);

    await storage.set(updatedSettings);
  },
  async getSettings() {
    const settings = await storage.get();
    const merged = {
      ...DEFAULT_GENERAL_SETTINGS,
      ...settings,
    };
    const storedRecord = settings as Partial<GeneralSettingsConfig> | undefined;

    merged.qaEnableThinkingTool =
      typeof merged.qaEnableThinkingTool === 'boolean'
        ? merged.qaEnableThinkingTool
        : DEFAULT_GENERAL_SETTINGS.qaEnableThinkingTool;

    merged.qaEnableWebSearchTool =
      storedRecord && typeof storedRecord.qaEnableWebSearchTool === 'boolean'
        ? storedRecord.qaEnableWebSearchTool
        : merged.enableWebSearch;

    merged.qaEnableFetchUrlTool =
      storedRecord && typeof storedRecord.qaEnableFetchUrlTool === 'boolean'
        ? storedRecord.qaEnableFetchUrlTool
        : merged.enableWebSearch;

    merged.uiLocale =
      storedRecord && typeof storedRecord.uiLocale === 'string' && UI_LOCALE_VALUES.includes(storedRecord.uiLocale)
        ? storedRecord.uiLocale
        : DEFAULT_GENERAL_SETTINGS.uiLocale;

    return clampQaToolBudgets(applyQaAppearanceDefaultsIfEmpty(merged));
  },
  async resetToDefaults() {
    await storage.set(DEFAULT_GENERAL_SETTINGS);
  },
};
