import { QaAppearanceSettings } from './QaAppearanceSettings';

interface AppearanceSettingsProps {
  isDarkMode?: boolean;
}

export const AppearanceSettings = ({ isDarkMode = false }: AppearanceSettingsProps) => {
  return (
    <div className="space-y-6">
      <QaAppearanceSettings isDarkMode={isDarkMode} />
    </div>
  );
};
