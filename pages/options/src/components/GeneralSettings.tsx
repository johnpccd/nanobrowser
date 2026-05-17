import { useState, useEffect } from 'react';
import {
  type GeneralSettingsConfig,
  type UiLocalePreference,
  generalSettingsStore,
  DEFAULT_GENERAL_SETTINGS,
} from '@extension/storage';
import { t } from '@extension/i18n';
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
        message: t('options_general_searxngTest_noUrl'),
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
          message: response?.error || t('options_general_searxngTest_failed'),
        });
        return;
      }

      const firstResult = response.firstResult
        ? t('options_general_searxngTest_firstResult', [response.firstResult.title, response.firstResult.url])
        : '';

      setSearxngTestResult({
        ok: true,
        message: t('options_general_searxngTest_ok', [response.query, String(response.resultCount), firstResult]),
      });
    } catch (error) {
      setSearxngTestResult({
        ok: false,
        message: error instanceof Error ? error.message : t('options_general_searxngTest_failed'),
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
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_uiLocale')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_uiLocale_desc')}
              </p>
            </div>
            <label htmlFor="uiLocale" className="sr-only">
              {t('options_general_uiLocale')}
            </label>
            <select
              id="uiLocale"
              value={settings.uiLocale}
              onChange={e => updateSetting('uiLocale', e.target.value as UiLocalePreference)}
              className={`w-48 rounded-md border px-3 py-2 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}>
              <option value="auto">{t('options_general_uiLocale_auto')}</option>
              <option value="en">{t('options_general_uiLocale_en')}</option>
              <option value="fr">{t('options_general_uiLocale_fr')}</option>
              <option value="de">{t('options_general_uiLocale_de')}</option>
              <option value="it">{t('options_general_uiLocale_it')}</option>
            </select>
          </div>

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
                {t('options_general_qaMaxNonThinkingToolCalls')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_qaMaxNonThinkingToolCalls_desc')}
              </p>
            </div>
            <label htmlFor="qaMaxNonThinkingToolCalls" className="sr-only">
              {t('options_general_qaMaxNonThinkingToolCalls')}
            </label>
            <input
              id="qaMaxNonThinkingToolCalls"
              type="number"
              min={1}
              max={50}
              value={settings.qaMaxNonThinkingToolCalls}
              onChange={e => updateSetting('qaMaxNonThinkingToolCalls', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_qaMaxThinkingCalls')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_qaMaxThinkingCalls_desc')}
              </p>
            </div>
            <label htmlFor="qaMaxThinkingCalls" className="sr-only">
              {t('options_general_qaMaxThinkingCalls')}
            </label>
            <input
              id="qaMaxThinkingCalls"
              type="number"
              min={0}
              max={30}
              value={settings.qaMaxThinkingCalls}
              onChange={e => updateSetting('qaMaxThinkingCalls', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_qaMaxToolRounds')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_qaMaxToolRounds_desc')}
              </p>
            </div>
            <label htmlFor="qaMaxToolRounds" className="sr-only">
              {t('options_general_qaMaxToolRounds')}
            </label>
            <input
              id="qaMaxToolRounds"
              type="number"
              min={1}
              max={64}
              value={settings.qaMaxToolRounds}
              onChange={e => updateSetting('qaMaxToolRounds', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_general_enableWebSearch')}
              </h3>
              <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {t('options_general_enableWebSearch_desc')}
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
                <span className="sr-only">{t('options_general_enableWebSearch_a11y')}</span>
              </label>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-dashed border-sky-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('options_general_searxngBaseUrl')}
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('options_general_searxngBaseUrl_desc')}
                </p>
              </div>
              <label htmlFor="searxngBaseUrl" className="sr-only">
                {t('options_general_searxngBaseUrl_a11y')}
              </label>
              <input
                id="searxngBaseUrl"
                type="url"
                value={settings.searxngBaseUrl}
                onChange={e => updateSetting('searxngBaseUrl', e.target.value)}
                placeholder={t('options_general_searxngBaseUrl_placeholder')}
                className={`w-72 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('options_general_searxngApiKey')}
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('options_general_searxngApiKey_desc')}
                </p>
              </div>
              <label htmlFor="searxngApiKey" className="sr-only">
                {t('options_general_searxngApiKey_a11y')}
              </label>
              <input
                id="searxngApiKey"
                type="password"
                value={settings.searxngApiKey}
                onChange={e => updateSetting('searxngApiKey', e.target.value)}
                placeholder={t('options_general_optionalPlaceholder')}
                className={`w-72 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('options_general_jinaReaderApiKey')}
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('options_general_jinaReaderApiKey_desc')}
                </p>
              </div>
              <label htmlFor="jinaReaderApiKey" className="sr-only">
                {t('options_general_jinaReaderApiKey_a11y')}
              </label>
              <input
                id="jinaReaderApiKey"
                type="password"
                value={settings.jinaReaderApiKey}
                onChange={e => updateSetting('jinaReaderApiKey', e.target.value)}
                placeholder={t('options_general_optionalPlaceholder')}
                className={`w-72 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('options_general_searxngMaxResults')}
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('options_general_searxngMaxResults_desc')}
                </p>
              </div>
              <label htmlFor="searxngMaxResults" className="sr-only">
                {t('options_general_searxngMaxResults_a11y')}
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
                  {t('options_general_searxngIntegrationTest')}
                </h3>
                <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('options_general_searxngIntegrationTest_desc')}
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
                {isTestingSearxng ? t('options_general_searxngTestTesting') : t('options_general_searxngTestButton')}
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
    </section>
  );
};
