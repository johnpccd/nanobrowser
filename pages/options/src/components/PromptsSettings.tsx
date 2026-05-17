import { QuickStartPromptsSettings } from './QuickStartPromptsSettings';

interface PromptsSettingsProps {
  isDarkMode?: boolean;
}

export const PromptsSettings = ({ isDarkMode = false }: PromptsSettingsProps) => {
  return (
    <div className="space-y-6">
      <QuickStartPromptsSettings isDarkMode={isDarkMode} />
    </div>
  );
};
