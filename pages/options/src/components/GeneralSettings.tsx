import { useState, useEffect } from 'react';
import { type GeneralSettingsConfig, generalSettingsStore, DEFAULT_GENERAL_SETTINGS } from '@extension/storage';
import { t } from '@extension/i18n';
import { QuickStartPromptsSettings } from './QuickStartPromptsSettings';

interface GeneralSettingsProps {
  isDarkMode?: boolean;
}

export const GeneralSettings = ({ isDarkMode = false }: GeneralSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);
  const [isTestingSearxng, setIsTestingSearxng] = useState(false);
  const [searxngTestResult, setSearxngTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    // Load initial settings
    generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(key: K, value: GeneralSettingsConfig[K]) => {
    // Optimistically update the local state for responsiveness
    setSettings(prevSettings => ({ ...prevSettings, [key]: value }));

    // Call the store to update the setting
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);

    // After the store update (which might have side effects, e.g., useVision affecting displayHighlights),
    // fetch the latest settings from the store and update the local state again to ensure UI consistency.
    const latestSettings = await generalSettingsStore.getSettings();
    setSettings(latestSettings);
  };

  const testSearxngConnection = async () => {
    if (!settings.searxngBaseUrl.trim()) {
      setSearxngTestResult({
        ok: false,
        message: 'Enter a SearXNG base URL first.',
      });
      return;
    }

    setIsTestingSearxng(true);
    setSearxngTestResult(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'test_searxng',
        config: {
          baseUrl: settings.searxngBaseUrl,
          apiKey: settings.searxngApiKey,
          maxResults: settings.searxngMaxResults,
        },
      });

      if (!response?.ok) {
        setSearxngTestResult({
          ok: false,
          message: response?.error || 'SearXNG test failed.',
        });
        return;
      }

      const firstResult = response.firstResult
        ? ` First result: ${response.firstResult.title} (${response.firstResult.url})`
        : '';

      setSearxngTestResult({
        ok: true,
        message: `SearXNG integration test passed using "${response.query}". Parsed ${response.resultCount} result(s).${firstResult}`,
      });
    } catch (error) {
      setSearxngTestResult({
        ok: false,
        message: error instanceof Error ? error.message : 'SearXNG test failed.',
      });
    } finally {
      setIsTestingSearxng(false);
    }
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-4 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {t('options_general_header')}
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_maxSteps')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxSteps_desc')}
              </p>
            </div>
            <label htmlFor="maxSteps" className="sr-only">
              {t('options_general_maxSteps')}
            </label>
            <input
              id="maxSteps"
              type="number"
              min={1}
              max={50}
              value={settings.maxSteps}
              onChange={e => updateSetting('maxSteps', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_maxActions')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxActions_desc')}
              </p>
            </div>
            <label htmlFor="maxActionsPerStep" className="sr-only">
              {t('options_general_maxActions')}
            </label>
            <input
              id="maxActionsPerStep"
              type="number"
              min={1}
              max={50}
              value={settings.maxActionsPerStep}
              onChange={e => updateSetting('maxActionsPerStep', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_maxFailures')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxFailures_desc')}
              </p>
            </div>
            <label htmlFor="maxFailures" className="sr-only">
              {t('options_general_maxFailures')}
            </label>
            <input
              id="maxFailures"
              type="number"
              min={1}
              max={10}
              value={settings.maxFailures}
              onChange={e => updateSetting('maxFailures', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_enableVision')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_enableVision_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="useVision"
                type="checkbox"
                checked={settings.useVision}
                onChange={e => updateSetting('useVision', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="useVision"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{t('options_general_enableVision')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_displayHighlights')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_displayHighlights_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="displayHighlights"
                type="checkbox"
                checked={settings.displayHighlights}
                onChange={e => updateSetting('displayHighlights', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="displayHighlights"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{t('options_general_displayHighlights')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_planningInterval')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_planningInterval_desc')}
              </p>
            </div>
            <label htmlFor="planningInterval" className="sr-only">
              {t('options_general_planningInterval')}
            </label>
            <input
              id="planningInterval"
              type="number"
              min={1}
              max={20}
              value={settings.planningInterval}
              onChange={e => updateSetting('planningInterval', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_minWaitPageLoad')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_minWaitPageLoad_desc')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <label htmlFor="minWaitPageLoad" className="sr-only">
                {t('options_general_minWaitPageLoad')}
              </label>
              <input
                id="minWaitPageLoad"
                type="number"
                min={250}
                max={5000}
                step={50}
                value={settings.minWaitPageLoad}
                onChange={e => updateSetting('minWaitPageLoad', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_replayHistoricalTasks')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_replayHistoricalTasks_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="replayHistoricalTasks"
                type="checkbox"
                checked={settings.replayHistoricalTasks}
                onChange={e => updateSetting('replayHistoricalTasks', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="replayHistoricalTasks"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{t('options_general_replayHistoricalTasks')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_includePageContent')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_includePageContent_desc')}
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="includePageContent"
                type="checkbox"
                checked={settings.includePageContent}
                onChange={e => updateSetting('includePageContent', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="includePageContent"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{t('options_general_includePageContent')}</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Enable QA Web Search
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Allow QA mode to fetch fresh search results from your SearXNG instance for web/current questions.
              </p>
            </div>
            <div className="relative inline-flex cursor-pointer items-center">
              <input
                id="enableWebSearch"
                type="checkbox"
                checked={settings.enableWebSearch}
                onChange={e => updateSetting('enableWebSearch', e.target.checked)}
                className="peer sr-only"
              />
              <label
                htmlFor="enableWebSearch"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">Enable QA Web Search</span>
              </label>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-dashed border-sky-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  SearXNG Base URL
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Example: `https://search.yourdomain.com`
                </p>
              </div>
              <label htmlFor="searxngBaseUrl" className="sr-only">
                SearXNG Base URL
              </label>
              <input
                id="searxngBaseUrl"
                type="url"
                value={settings.searxngBaseUrl}
                onChange={e => updateSetting('searxngBaseUrl', e.target.value)}
                placeholder="https://search.yourdomain.com"
                className={`w-72 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  SearXNG API Key
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Optional. Leave blank if your instance allows public JSON search requests.
                </p>
              </div>
              <label htmlFor="searxngApiKey" className="sr-only">
                SearXNG API Key
              </label>
              <input
                id="searxngApiKey"
                type="password"
                value={settings.searxngApiKey}
                onChange={e => updateSetting('searxngApiKey', e.target.value)}
                placeholder="Optional"
                className={`w-72 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Jina Reader API Key
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Optional. Used by the QA `read_url` tool to open result links with higher Jina Reader rate limits.
                </p>
              </div>
              <label htmlFor="jinaReaderApiKey" className="sr-only">
                Jina Reader API Key
              </label>
              <input
                id="jinaReaderApiKey"
                type="password"
                value={settings.jinaReaderApiKey}
                onChange={e => updateSetting('jinaReaderApiKey', e.target.value)}
                placeholder="Optional"
                className={`w-72 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Search Result Count
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  How many web results QA mode should include from SearXNG per search.
                </p>
              </div>
              <label htmlFor="searxngMaxResults" className="sr-only">
                Search Result Count
              </label>
              <input
                id="searxngMaxResults"
                type="number"
                min={1}
                max={10}
                value={settings.searxngMaxResults}
                onChange={e => updateSetting('searxngMaxResults', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Integration Test
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Sends a real test search through the extension background worker and verifies usable results come
                  back.
                </p>
              </div>
              <button
                type="button"
                onClick={testSearxngConnection}
                disabled={isTestingSearxng || !settings.searxngBaseUrl.trim()}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  isTestingSearxng || !settings.searxngBaseUrl.trim()
                    ? 'cursor-not-allowed bg-gray-300 text-gray-600'
                    : isDarkMode
                      ? 'bg-sky-600 text-white hover:bg-sky-500'
                      : 'bg-sky-500 text-white hover:bg-sky-600'
                }`}>
                {isTestingSearxng ? 'Testing...' : 'Test SearXNG'}
              </button>
            </div>

            {searxngTestResult && (
              <div
                className={`rounded-md border px-3 py-2 text-sm ${
                  searxngTestResult.ok
                    ? isDarkMode
                      ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : isDarkMode
                      ? 'border-rose-700 bg-rose-950/40 text-rose-300'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}>
                {searxngTestResult.message}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_fontSize')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_fontSize_desc')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <label htmlFor="fontSize" className="sr-only">
                {t('options_general_fontSize')}
              </label>
              <input
                id="fontSize"
                type="number"
                min={10}
                max={24}
                step={1}
                value={settings.fontSize}
                onChange={e => updateSetting('fontSize', Number.parseInt(e.target.value, 10))}
                className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>px</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_maxInputTokens')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_maxInputTokens_desc')}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <label htmlFor="maxInputTokens" className="sr-only">
                {t('options_general_maxInputTokens')}
              </label>
              <input
                id="maxInputTokens"
                type="number"
                min={10000}
                max={10000000}
                step={10000}
                value={settings.maxInputTokens}
                onChange={e => updateSetting('maxInputTokens', Number.parseInt(e.target.value, 10))}
                className={`w-32 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>tokens</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Start Prompts Settings */}
      <QuickStartPromptsSettings isDarkMode={isDarkMode} />
    </section>
  );
};
