import { t } from '@extension/i18n';

interface AboutSettingsProps {
  isDarkMode?: boolean;
}

export const AboutSettings = ({ isDarkMode = false }: AboutSettingsProps) => {
  return (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
        {t('options_about_header' as never)}
      </h2>

      <div
        className={`rounded-xl border p-5 ${
          isDarkMode ? 'border-slate-700 bg-slate-800/50 text-gray-200' : 'border-white/30 bg-white/70 text-gray-800'
        }`}>
        <p className={`mb-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {t('options_about_buildSha' as never)}
        </p>
        <code className={`block break-all rounded-md px-3 py-2 text-xs ${isDarkMode ? 'bg-slate-900/70' : 'bg-slate-100'}`}>
          {__BUILD_SHA1__}
        </code>
      </div>
    </div>
  );
};
