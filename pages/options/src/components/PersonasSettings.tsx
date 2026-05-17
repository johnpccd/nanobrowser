import { useEffect, useState } from 'react';
import { Button } from '@extension/ui';
import { DEFAULT_PERSONA_ID, type Persona, personasStore } from '@extension/storage';
import { t } from '@extension/i18n';

interface PersonasSettingsProps {
  isDarkMode?: boolean;
}

const createPersonaDraft = (): Persona => ({
  id: `persona_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: '',
  systemPrompt: '',
});

export const PersonasSettings = ({ isDarkMode = false }: PersonasSettingsProps) => {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string>(DEFAULT_PERSONA_ID);
  const [newPersona, setNewPersona] = useState<Persona>(createPersonaDraft());

  const load = async () => {
    const settings = await personasStore.getSettings();
    setPersonas(settings.personas);
    setActivePersonaId(settings.activePersonaId);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const unsubscribe = personasStore.subscribe(() => {
      void load();
    });
    return () => unsubscribe();
  }, []);

  const savePersona = async (persona: Persona) => {
    if (!persona.name.trim() || !persona.systemPrompt.trim()) {
      return;
    }
    await personasStore.upsertPersona(persona);
  };

  const updatePersonaLocally = (personaId: string, patch: Partial<Persona>) => {
    setPersonas(prev => prev.map(persona => (persona.id === personaId ? { ...persona, ...patch } : persona)));
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-2 text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {t('options_personas_header')}
        </h2>
        <p className={`mb-4 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{t('options_personas_desc')}</p>

        <div className="mb-6 space-y-4">
          {personas.map(persona => {
            const isDefault = persona.id === DEFAULT_PERSONA_ID;
            const canSave = Boolean(persona.name.trim() && persona.systemPrompt.trim());

            return (
              <div
                key={persona.id}
                className={`rounded-lg border p-4 ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'}`}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      {isDefault ? t('options_personas_default') : t('options_personas_label')}
                    </span>
                    {activePersonaId === persona.id && (
                      <span className="rounded-full bg-sky-600 px-2 py-0.5 text-xs text-white">
                        {t('options_personas_activeBadge')}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={activePersonaId === persona.id}
                      onClick={() => personasStore.setActivePersona(persona.id)}>
                      {t('options_personas_setActive')}
                    </Button>
                    <Button variant="primary" disabled={!canSave} onClick={() => savePersona(persona)}>
                      {t('options_personas_save')}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={isDefault}
                      onClick={() => personasStore.removePersona(persona.id)}>
                      {t('options_personas_delete')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <input
                    type="text"
                    disabled={isDefault}
                    value={persona.name}
                    onChange={e => updatePersonaLocally(persona.id, { name: e.target.value })}
                    placeholder={t('options_personas_namePlaceholder')}
                    className={`w-full rounded-md border px-3 py-2 text-sm ${isDarkMode ? 'border-slate-500 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
                  />
                  <textarea
                    rows={4}
                    value={persona.systemPrompt}
                    onChange={e => updatePersonaLocally(persona.id, { systemPrompt: e.target.value })}
                    placeholder={t('options_personas_systemPromptPlaceholder')}
                    className={`w-full rounded-md border px-3 py-2 text-sm ${isDarkMode ? 'border-slate-500 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div
          className={`rounded-lg border p-4 ${isDarkMode ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'}`}>
          <h3 className={`mb-3 text-base font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {t('options_personas_addHeading')}
          </h3>
          <div className="space-y-3">
            <input
              type="text"
              value={newPersona.name}
              onChange={e => setNewPersona(prev => ({ ...prev, name: e.target.value }))}
              placeholder={t('options_personas_namePlaceholder')}
              className={`w-full rounded-md border px-3 py-2 text-sm ${isDarkMode ? 'border-slate-500 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
            />
            <textarea
              rows={4}
              value={newPersona.systemPrompt}
              onChange={e => setNewPersona(prev => ({ ...prev, systemPrompt: e.target.value }))}
              placeholder={t('options_personas_systemPromptPlaceholder')}
              className={`w-full rounded-md border px-3 py-2 text-sm ${isDarkMode ? 'border-slate-500 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'}`}
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={!newPersona.name.trim() || !newPersona.systemPrompt.trim()}
                onClick={async () => {
                  await personasStore.upsertPersona(newPersona);
                  setNewPersona(createPersonaDraft());
                }}>
                {t('options_personas_add')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
