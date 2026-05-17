import { useState, useEffect } from 'react';
import '@src/Options.css';
import { Button } from '@extension/ui';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { t } from '@extension/i18n';
import { FiSettings, FiCpu, FiInfo, FiTool, FiUser, FiCloud, FiLayout, FiMessageSquare } from 'react-icons/fi';
import { GeneralSettings } from './components/GeneralSettings';
import { ModelSettings } from './components/ModelSettings';
import { McpToolsSettings } from './components/McpToolsSettings';
import { PersonasSettings } from './components/PersonasSettings';
import { FoundryAgentsSettings } from './components/FoundryAgentsSettings';
import { AboutSettings } from './components/AboutSettings';
import { AppearanceSettings } from './components/AppearanceSettings';
import { PromptsSettings } from './components/PromptsSettings';
import { useUiLocaleSync } from './hooks/useUiLocaleSync';

type TabTypes = 'general' | 'appearance' | 'prompts' | 'models' | 'personas' | 'foundry' | 'mcp' | 'about';

const TABS: { id: TabTypes; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'general', icon: FiSettings, label: t('options_tabs_general') },
  { id: 'appearance', icon: FiLayout, label: t('options_tabs_appearance') },
  { id: 'prompts', icon: FiMessageSquare, label: t('options_tabs_prompts') },
  { id: 'models', icon: FiCpu, label: t('options_tabs_models') },
  { id: 'personas', icon: FiUser, label: t('options_tabs_personas') },
  { id: 'foundry', icon: FiCloud, label: t('options_tabs_foundry' as never) },
  { id: 'mcp', icon: FiTool, label: t('options_tabs_mcp' as never) },
  { id: 'about', icon: FiInfo, label: t('options_tabs_about' as never) },
];

function tabFromLocationHash(): TabTypes | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const h = window.location.hash.replace(/^#/, '').trim();
  const ids: TabTypes[] = ['general', 'appearance', 'prompts', 'models', 'personas', 'foundry', 'mcp', 'about'];
  return ids.includes(h as TabTypes) ? (h as TabTypes) : null;
}

const Options = () => {
  useUiLocaleSync();
  const [activeTab, setActiveTab] = useState<TabTypes>(() => tabFromLocationHash() ?? 'models');
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Check for dark mode preference
  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);
    return () => darkModeMediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = tabFromLocationHash();
      if (next) {
        setActiveTab(next);
      }
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const handleTabClick = (tabId: TabTypes) => {
    setActiveTab(tabId);
    const nextHash = `#${tabId}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings isDarkMode={isDarkMode} />;
      case 'appearance':
        return <AppearanceSettings isDarkMode={isDarkMode} />;
      case 'prompts':
        return <PromptsSettings isDarkMode={isDarkMode} />;
      case 'models':
        return <ModelSettings isDarkMode={isDarkMode} />;
      case 'personas':
        return <PersonasSettings isDarkMode={isDarkMode} />;
      case 'foundry':
        return <FoundryAgentsSettings isDarkMode={isDarkMode} />;
      case 'mcp':
        return <McpToolsSettings isDarkMode={isDarkMode} />;
      case 'about':
        return <AboutSettings isDarkMode={isDarkMode} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`flex min-h-screen min-w-[768px] ${isDarkMode ? 'bg-slate-900' : "bg-[url('/bg.jpg')] bg-cover bg-center"} ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
      {/* Vertical Navigation Bar */}
      <nav
        className={`w-48 border-r ${isDarkMode ? 'border-slate-700 bg-slate-800/80' : 'border-white/20 bg-[#0EA5E9]/10'} backdrop-blur-sm`}>
        <div className="p-4">
          <h1 className={`mb-6 text-xl font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_nav_header')}
          </h1>
          <ul className="space-y-2">
            {TABS.map(item => (
              <li key={item.id}>
                <Button
                  onClick={() => handleTabClick(item.id)}
                  className={`flex w-full items-center space-x-2 rounded-lg px-4 py-2 text-left text-base 
                    ${
                      activeTab !== item.id
                        ? `${isDarkMode ? 'bg-slate-700/70 text-gray-300 hover:text-white' : 'bg-[#0EA5E9]/15 font-medium text-gray-700 hover:text-white'} backdrop-blur-sm`
                        : `${isDarkMode ? 'bg-sky-800/50' : ''} text-white backdrop-blur-sm`
                    }`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className={`flex-1 ${isDarkMode ? 'bg-slate-800/50' : 'bg-white/10'} p-8 backdrop-blur-sm`}>
        <div className="mx-auto min-w-[512px] max-w-screen-lg">{renderTabContent()}</div>
      </main>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <div>Loading...</div>), <div>Error Occurred</div>);
