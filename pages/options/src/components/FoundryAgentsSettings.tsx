import { useEffect, useState } from 'react';
import { Button } from '@extension/ui';
import {
  type FoundryAgent,
  buildFoundryResponsesEndpoint,
  buildFoundryResponsesRequestUrl,
  foundryAgentsStore,
} from '@extension/storage';
import { t } from '@extension/i18n';

interface FoundryAgentsSettingsProps {
  isDarkMode?: boolean;
}

const createAgentDraft = (): FoundryAgent => ({
  id: `azf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  projectEndpoint: '',
  agentName: '',
  agentVersion: '',
  apiKey: '',
  responsesEndpoint: '',
  openaiBaseUrl: '',
});

export const FoundryAgentsSettings = ({ isDarkMode = false }: FoundryAgentsSettingsProps) => {
  const [agents, setAgents] = useState<FoundryAgent[]>([]);
  const [newAgent, setNewAgent] = useState<FoundryAgent>(createAgentDraft());

  const load = async () => {
    const settings = await foundryAgentsStore.getSettings();
    setAgents(settings.agents);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const unsubscribe = foundryAgentsStore.subscribe(() => {
      void load();
    });
    return () => unsubscribe();
  }, []);

  const inputClass = `w-full rounded-md border px-3 py-2 text-sm ${
    isDarkMode ? 'border-slate-500 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
  }`;

  const cardClass = `rounded-lg border p-4 ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'}`;

  const canSave = (agent: FoundryAgent) =>
    Boolean(agent.name.trim() && agent.projectEndpoint.trim() && agent.agentName.trim() && agent.apiKey.trim());

  const updateAgentLocally = (agentId: string, patch: Partial<FoundryAgent>) => {
    setAgents(prev => prev.map(agent => (agent.id === agentId ? { ...agent, ...patch } : agent)));
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-2 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {t('options_foundry_header')}
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{t('options_foundry_desc')}</p>

        <div className="mb-6 space-y-4">
          {agents.map(agent => (
            <div key={agent.id} className={cardClass}>
              <div className="mb-3 flex items-center justify-between">
                <span className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  {agent.name || agent.agentName}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    disabled={!canSave(agent)}
                    onClick={() => foundryAgentsStore.upsertAgent(agent)}>
                    {t('options_foundry_save')}
                  </Button>
                  <Button variant="danger" onClick={() => foundryAgentsStore.removeAgent(agent.id)}>
                    {t('options_foundry_delete')}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  value={agent.name}
                  onChange={e => updateAgentLocally(agent.id, { name: e.target.value })}
                  placeholder={t('options_foundry_namePlaceholder')}
                  className={inputClass}
                />
                <input
                  type="text"
                  value={agent.projectEndpoint}
                  onChange={e => updateAgentLocally(agent.id, { projectEndpoint: e.target.value })}
                  placeholder={t('options_foundry_projectEndpointPlaceholder')}
                  className={inputClass}
                />
                <input
                  type="text"
                  value={agent.agentName}
                  onChange={e => updateAgentLocally(agent.id, { agentName: e.target.value })}
                  placeholder={t('options_foundry_agentNamePlaceholder')}
                  className={inputClass}
                />
                <input
                  type="text"
                  value={agent.agentVersion ?? ''}
                  onChange={e => updateAgentLocally(agent.id, { agentVersion: e.target.value })}
                  placeholder={t('options_foundry_agentVersionPlaceholder')}
                  className={inputClass}
                />
                <input
                  type="password"
                  value={agent.apiKey}
                  onChange={e => updateAgentLocally(agent.id, { apiKey: e.target.value })}
                  placeholder={t('options_foundry_apiKeyPlaceholder')}
                  className={inputClass}
                  autoComplete="off"
                />
                <input
                  type="text"
                  value={agent.responsesEndpoint ?? ''}
                  onChange={e => updateAgentLocally(agent.id, { responsesEndpoint: e.target.value })}
                  placeholder={t('options_foundry_responsesEndpointPlaceholder')}
                  className={inputClass}
                />
                <input
                  type="text"
                  value={agent.openaiBaseUrl ?? ''}
                  onChange={e => updateAgentLocally(agent.id, { openaiBaseUrl: e.target.value })}
                  placeholder={t('options_foundry_openaiBaseUrlPlaceholder')}
                  className={inputClass}
                />
                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('options_foundry_resolvedEndpoint')}: {buildFoundryResponsesRequestUrl(agent)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className={cardClass}>
          <h3 className={`mb-3 text-base font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_foundry_addHeading')}
          </h3>
          <div className="space-y-3">
            <input
              type="text"
              value={newAgent.name}
              onChange={e => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
              placeholder={t('options_foundry_namePlaceholder')}
              className={inputClass}
            />
            <input
              type="text"
              value={newAgent.projectEndpoint}
              onChange={e => setNewAgent(prev => ({ ...prev, projectEndpoint: e.target.value }))}
              placeholder={t('options_foundry_projectEndpointPlaceholder')}
              className={inputClass}
            />
            <input
              type="text"
              value={newAgent.agentName}
              onChange={e => setNewAgent(prev => ({ ...prev, agentName: e.target.value }))}
              placeholder={t('options_foundry_agentNamePlaceholder')}
              className={inputClass}
            />
            <input
              type="text"
              value={newAgent.agentVersion ?? ''}
              onChange={e => setNewAgent(prev => ({ ...prev, agentVersion: e.target.value }))}
              placeholder={t('options_foundry_agentVersionPlaceholder')}
              className={inputClass}
            />
            <input
              type="password"
              value={newAgent.apiKey}
              onChange={e => setNewAgent(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder={t('options_foundry_apiKeyPlaceholder')}
              className={inputClass}
              autoComplete="off"
            />
            <input
              type="text"
              value={newAgent.responsesEndpoint ?? ''}
              onChange={e => setNewAgent(prev => ({ ...prev, responsesEndpoint: e.target.value }))}
              placeholder={t('options_foundry_responsesEndpointPlaceholder')}
              className={inputClass}
            />
            <input
              type="text"
              value={newAgent.openaiBaseUrl ?? ''}
              onChange={e => setNewAgent(prev => ({ ...prev, openaiBaseUrl: e.target.value }))}
              placeholder={t('options_foundry_openaiBaseUrlPlaceholder')}
              className={inputClass}
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={!canSave(newAgent)}
                onClick={async () => {
                  await foundryAgentsStore.upsertAgent(newAgent);
                  setNewAgent(createAgentDraft());
                }}>
                {t('options_foundry_add')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
