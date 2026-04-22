import { useState, useEffect } from 'react';
import {
  type GeneralSettingsConfig,
  generalSettingsStore,
  DEFAULT_GENERAL_SETTINGS,
  normalizeHexColor,
} from '@extension/storage';
import { t } from '@extension/i18n';
import type { MessageKey } from '@extension/i18n/lib/type';

interface QaAppearanceSettingsProps {
  isDarkMode?: boolean;
}

type ColorFieldKey =
  | 'qaColorPanelBg'
  | 'qaColorChatBg'
  | 'qaColorMessageText'
  | 'qaColorHeadingText'
  | 'qaColorMutedText'
  | 'qaColorLink'
  | 'qaColorSeparator'
  | 'qaColorInputSurface'
  | 'qaColorInputBorder'
  | 'qaColorInputText'
  | 'qaColorAccent';

const COLOR_FIELDS = [
  { key: 'qaColorPanelBg', label: 'options_qa_color_panel', desc: 'options_qa_color_panel_desc' },
  { key: 'qaColorChatBg', label: 'options_qa_color_chat', desc: 'options_qa_color_chat_desc' },
  { key: 'qaColorMessageText', label: 'options_qa_color_message', desc: 'options_qa_color_message_desc' },
  { key: 'qaColorHeadingText', label: 'options_qa_color_heading', desc: 'options_qa_color_heading_desc' },
  { key: 'qaColorMutedText', label: 'options_qa_color_muted', desc: 'options_qa_color_muted_desc' },
  { key: 'qaColorLink', label: 'options_qa_color_link', desc: 'options_qa_color_link_desc' },
  { key: 'qaColorSeparator', label: 'options_qa_color_separator', desc: 'options_qa_color_separator_desc' },
  { key: 'qaColorInputSurface', label: 'options_qa_color_inputSurface', desc: 'options_qa_color_inputSurface_desc' },
  { key: 'qaColorInputBorder', label: 'options_qa_color_inputBorder', desc: 'options_qa_color_inputBorder_desc' },
  { key: 'qaColorInputText', label: 'options_qa_color_inputText', desc: 'options_qa_color_inputText_desc' },
  { key: 'qaColorAccent', label: 'options_qa_color_accent', desc: 'options_qa_color_accent_desc' },
] as const satisfies ReadonlyArray<{ key: ColorFieldKey; label: MessageKey; desc: MessageKey }>;

function ColorRow({
  labelKey,
  descKey,
  value,
  onChange,
  isDarkMode,
}: {
  labelKey: MessageKey;
  descKey: MessageKey;
  value: string;
  onChange: (v: string) => void;
  isDarkMode: boolean;
}) {
  const normalized = normalizeHexColor(value);
  const pickerValue = normalized || '#7c7c7c';

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{t(labelKey)}</h3>
        <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{t(descKey)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`color-${labelKey}`}>
          {t(labelKey)}
        </label>
        <input
          id={`color-${labelKey}`}
          type="color"
          value={pickerValue}
          onChange={e => onChange(normalizeHexColor(e.target.value))}
          className="h-9 w-12 cursor-pointer rounded border border-gray-400 bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#rrggbb"
          spellCheck={false}
          className={`w-28 rounded-md border px-2 py-1.5 font-mono text-sm ${
            isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-800'
          }`}
        />
        <button
          type="button"
          onClick={() => onChange('')}
          className={`rounded-md px-2 py-1.5 text-sm ${
            isDarkMode ? 'bg-slate-600 text-gray-200 hover:bg-slate-500' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}>
          {t('options_qa_color_clear')}
        </button>
      </div>
    </div>
  );
}

export const QaAppearanceSettings = ({ isDarkMode = false }: QaAppearanceSettingsProps) => {
  const [settings, setSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);

  useEffect(() => {
    generalSettingsStore.getSettings().then(setSettings);
  }, []);

  const updateSetting = async <K extends keyof GeneralSettingsConfig>(key: K, value: GeneralSettingsConfig[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    await generalSettingsStore.updateSettings({ [key]: value } as Partial<GeneralSettingsConfig>);
    const latest = await generalSettingsStore.getSettings();
    setSettings(latest);
  };

  const resetQaAppearance = async () => {
    const patch: Partial<GeneralSettingsConfig> = {
      qaFontFamily: DEFAULT_GENERAL_SETTINGS.qaFontFamily,
      qaChromeFontSize: DEFAULT_GENERAL_SETTINGS.qaChromeFontSize,
      qaInputFontSize: DEFAULT_GENERAL_SETTINGS.qaInputFontSize,
    };
    for (const { key } of COLOR_FIELDS) {
      patch[key] = '' as GeneralSettingsConfig[ColorFieldKey];
    }
    setSettings(prev => ({ ...prev, ...patch }));
    await generalSettingsStore.updateSettings(patch);
    const latest = await generalSettingsStore.getSettings();
    setSettings(latest);
  };

  return (
    <div
      className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
      <h2 className={`mb-2 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
        {t('options_qa_appearance_header')}
      </h2>
      <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        {t('options_qa_appearance_description')}
      </p>

      <div className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('options_qa_fontFamily')}
            </h3>
            <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('options_qa_fontFamily_desc')}
            </p>
          </div>
          <input
            type="text"
            value={settings.qaFontFamily}
            onChange={e => updateSetting('qaFontFamily', e.target.value)}
            placeholder="system-ui, sans-serif"
            className={`mt-1 w-full rounded-md border px-3 py-2 sm:mt-0 sm:w-80 ${
              isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-800'
            }`}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('options_general_fontSize')}
            </h3>
            <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('options_general_fontSize_desc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="qaChatFontSize" className="sr-only">
              {t('options_general_fontSize')}
            </label>
            <input
              id="qaChatFontSize"
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

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('options_qa_chromeFontSize')}
            </h3>
            <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('options_qa_chromeFontSize_desc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="qaChromeFontSize" className="sr-only">
              {t('options_qa_chromeFontSize')}
            </label>
            <input
              id="qaChromeFontSize"
              type="number"
              min={0}
              max={22}
              step={1}
              value={settings.qaChromeFontSize}
              onChange={e => updateSetting('qaChromeFontSize', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>px</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {t('options_qa_inputFontSize')}
            </h3>
            <p className={`text-sm font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('options_qa_inputFontSize_desc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="qaInputFontSize" className="sr-only">
              {t('options_qa_inputFontSize')}
            </label>
            <input
              id="qaInputFontSize"
              type="number"
              min={0}
              max={28}
              step={1}
              value={settings.qaInputFontSize}
              onChange={e => updateSetting('qaInputFontSize', Number.parseInt(e.target.value, 10))}
              className={`w-20 rounded-md border ${isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'} px-3 py-2`}
            />
            <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>px</span>
          </div>
        </div>

        <div className={`border-t pt-4 ${isDarkMode ? 'border-slate-600' : 'border-gray-200'}`}>
          <h3
            className={`mb-3 text-sm font-semibold uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('options_qa_colors_section')}
          </h3>
          <div className="space-y-4">
            {COLOR_FIELDS.map(({ key, label, desc }) => (
              <ColorRow
                key={key}
                labelKey={label}
                descKey={desc}
                value={settings[key]}
                onChange={v => updateSetting(key, v)}
                isDarkMode={isDarkMode}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={resetQaAppearance}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              isDarkMode ? 'bg-slate-600 text-white hover:bg-slate-500' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}>
            {t('options_qa_reset')}
          </button>
        </div>
      </div>
    </div>
  );
};
