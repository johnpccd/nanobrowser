import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';
import { isFoundrySelectionId } from './foundryAgents';

export const DEFAULT_PERSONA_ID = 'default';

export interface Persona {
  id: string;
  name: string;
  systemPrompt: string;
}

export interface PersonasConfig {
  personas: Persona[];
  activePersonaId: string;
}

export type PersonasStorage = BaseStorage<PersonasConfig> & {
  getSettings: () => Promise<PersonasConfig>;
  setActivePersona: (personaId: string) => Promise<void>;
  upsertPersona: (persona: Persona) => Promise<void>;
  removePersona: (personaId: string) => Promise<void>;
};

export const DEFAULT_PERSONA: Persona = {
  id: DEFAULT_PERSONA_ID,
  name: 'Default',
  systemPrompt:
    'You are a helpful, knowledgeable, and friendly AI assistant. Provide clear, accurate, and helpful responses to the user. Be concise but thorough.',
};

export const DEFAULT_PERSONAS_SETTINGS: PersonasConfig = {
  personas: [DEFAULT_PERSONA],
  activePersonaId: DEFAULT_PERSONA_ID,
};

function normalizePersonas(personas: Persona[]): Persona[] {
  const cleaned = personas
    .map(persona => ({
      id: persona.id.trim(),
      name: persona.name.trim() || 'Unnamed persona',
      systemPrompt: persona.systemPrompt.trim(),
    }))
    .filter(persona => Boolean(persona.id));

  const byId = new Map<string, Persona>();
  for (const persona of cleaned) {
    byId.set(persona.id, persona);
  }

  if (!byId.has(DEFAULT_PERSONA_ID)) {
    byId.set(DEFAULT_PERSONA_ID, DEFAULT_PERSONA);
  } else {
    const existingDefault = byId.get(DEFAULT_PERSONA_ID)!;
    byId.set(DEFAULT_PERSONA_ID, {
      ...existingDefault,
      name: 'Default',
      systemPrompt: existingDefault.systemPrompt || DEFAULT_PERSONA.systemPrompt,
    });
  }

  const normalized = Array.from(byId.values());
  normalized.sort((a, b) => {
    if (a.id === DEFAULT_PERSONA_ID) return -1;
    if (b.id === DEFAULT_PERSONA_ID) return 1;
    return a.name.localeCompare(b.name);
  });

  return normalized;
}

function normalizeSettings(settings: PersonasConfig): PersonasConfig {
  const personas = normalizePersonas(settings.personas);
  const requestedActiveId = settings.activePersonaId?.trim() || DEFAULT_PERSONA_ID;
  const activePersonaId =
    isFoundrySelectionId(requestedActiveId) || personas.some(persona => persona.id === requestedActiveId)
      ? requestedActiveId
      : DEFAULT_PERSONA_ID;
  return {
    personas,
    activePersonaId,
  };
}

const storage = createStorage<PersonasConfig>('personas-settings', DEFAULT_PERSONAS_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const personasStore: PersonasStorage = {
  ...storage,
  async getSettings() {
    const settings = await storage.get();
    return normalizeSettings({
      ...DEFAULT_PERSONAS_SETTINGS,
      ...settings,
      personas: settings?.personas ?? DEFAULT_PERSONAS_SETTINGS.personas,
    });
  },
  async setActivePersona(personaId: string) {
    const current = await this.getSettings();
    const id = personaId.trim();
    const nextId =
      isFoundrySelectionId(id) || current.personas.some(persona => persona.id === id) ? id : DEFAULT_PERSONA_ID;
    await storage.set({
      ...current,
      activePersonaId: nextId,
    });
  },
  async upsertPersona(persona: Persona) {
    const current = await this.getSettings();
    const normalizedPersona: Persona = {
      id: persona.id.trim(),
      name: persona.id === DEFAULT_PERSONA_ID ? 'Default' : persona.name.trim() || 'Unnamed persona',
      systemPrompt: persona.systemPrompt.trim(),
    };
    if (!normalizedPersona.id) {
      return;
    }

    const existingIndex = current.personas.findIndex(item => item.id === normalizedPersona.id);
    const personas =
      existingIndex >= 0
        ? current.personas.map((item, index) => (index === existingIndex ? normalizedPersona : item))
        : [...current.personas, normalizedPersona];

    await storage.set(
      normalizeSettings({
        ...current,
        personas,
      }),
    );
  },
  async removePersona(personaId: string) {
    if (personaId === DEFAULT_PERSONA_ID) {
      return;
    }

    const current = await this.getSettings();
    const personas = current.personas.filter(persona => persona.id !== personaId);
    await storage.set(
      normalizeSettings({
        personas,
        activePersonaId: current.activePersonaId === personaId ? DEFAULT_PERSONA_ID : current.activePersonaId,
      }),
    );
  },
};
