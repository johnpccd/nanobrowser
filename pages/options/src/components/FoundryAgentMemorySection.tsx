import { useEffect, useRef, useState } from 'react';
import { Button } from '@extension/ui';
import type { FoundryAgent } from '@extension/storage';
import { t } from '@extension/i18n';

export interface FoundryMemoryRow {
  memoryId: string;
  kind: string;
  content: string;
  scope: string;
  updatedAt?: number;
}

interface FoundryAgentMemorySectionProps {
  agent: FoundryAgent;
  isDarkMode?: boolean;
  onPatch: (patch: Partial<FoundryAgent>) => void;
}

const tr = (key: string, substitutions?: string[]) =>
  substitutions ? t(key as never, substitutions as never) : t(key as never);

function formatUpdatedAt(updatedAt?: number): string {
  if (!updatedAt) {
    return '—';
  }
  const ms = updatedAt > 1_000_000_000_000 ? updatedAt : updatedAt * 1000;
  return new Date(ms).toLocaleString();
}

function agentConfigFingerprint(agent: FoundryAgent): string {
  return [agent.id, agent.projectEndpoint.trim(), agent.apiKey.trim()].join('\0');
}

export const FoundryAgentMemorySection = ({ agent, isDarkMode = false, onPatch }: FoundryAgentMemorySectionProps) => {
  const [memoryStoreName, setMemoryStoreName] = useState(agent.memoryStoreName ?? '');
  const [memoryScope, setMemoryScope] = useState(agent.memoryScope ?? '');
  const [memories, setMemories] = useState<FoundryMemoryRow[]>([]);
  const [storeNames, setStoreNames] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [editMemoryId, setEditMemoryId] = useState<string | null>(null);
  const [editMemoryText, setEditMemoryText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const configFingerprintRef = useRef(agentConfigFingerprint(agent));
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  const inputClass = `w-full rounded-md border px-3 py-2 text-sm ${
    isDarkMode ? 'border-slate-500 bg-slate-800 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
  }`;

  const selectClass = `${inputClass} min-w-0`;

  const trimmedStore = memoryStoreName.trim();
  const trimmedScope = memoryScope.trim();
  const memoryConfigured = Boolean(trimmedStore && trimmedScope);

  const resetDiscoveredState = () => {
    setStoreNames([]);
    setMemories([]);
    setSearchQuery('');
    setNewMemoryText('');
    setEditMemoryId(null);
    setEditMemoryText('');
    setStatusMessage('');
    setErrorMessage('');
  };

  useEffect(() => {
    setMemoryStoreName(agent.memoryStoreName ?? '');
    setMemoryScope(agent.memoryScope ?? '');
  }, [agent.id, agent.memoryStoreName, agent.memoryScope]);

  useEffect(() => {
    const fingerprint = agentConfigFingerprint(agent);
    if (configFingerprintRef.current === fingerprint) {
      return;
    }
    configFingerprintRef.current = fingerprint;
    resetDiscoveredState();
    setMemoryStoreName('');
    onPatchRef.current({ memoryStoreName: '' });
  }, [agent.id, agent.projectEndpoint, agent.apiKey]);

  const patchMemoryStoreName = (value: string) => {
    setMemoryStoreName(value);
    onPatch({ memoryStoreName: value });
  };

  const patchMemoryScope = (value: string) => {
    setMemoryScope(value);
    onPatch({ memoryScope: value });
  };

  const runMemoryAction = async (action: string, request: Record<string, unknown>) => {
    setBusyAction(action);
    setErrorMessage('');
    setStatusMessage('');
    try {
      const response = await chrome.runtime.sendMessage({
        agentId: agent.id,
        memoryStoreName: trimmedStore,
        scope: trimmedScope,
        ...request,
      });
      if (response === undefined) {
        setErrorMessage(tr('options_foundry_memory_errors_bgUnreachable'));
        return null;
      }
      if (!response.ok) {
        setErrorMessage(response.error || tr('options_foundry_memory_errors_requestFailed'));
        return null;
      }
      return response;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : tr('options_foundry_memory_errors_requestFailed'));
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const loadStores = async () => {
    if (!agent.projectEndpoint.trim() || !agent.apiKey.trim()) {
      setErrorMessage(tr('options_foundry_memory_errors_agentNotReady'));
      return;
    }

    const response = await runMemoryAction('list_stores', { type: 'foundry_memory_list_stores' });
    if (!response) {
      return;
    }
    const stores = Array.isArray(response.stores) ? response.stores : [];
    const names = stores
      .map((row: { name?: unknown }) => (typeof row?.name === 'string' ? row.name.trim() : ''))
      .filter(Boolean);
    setStoreNames(names);
    setStatusMessage(tr('options_foundry_memory_storesLoaded' as never, [String(names.length)] as never));

    if (names.length === 1) {
      patchMemoryStoreName(names[0]!);
    } else if (trimmedStore && names.includes(trimmedStore)) {
      patchMemoryStoreName(trimmedStore);
    } else if (names.length > 0 && !trimmedStore) {
      patchMemoryStoreName(names[0]!);
    }
  };

  const loadMemories = async () => {
    if (!memoryConfigured) {
      setErrorMessage(tr('options_foundry_memory_errors_notConfigured'));
      return;
    }
    const response = await runMemoryAction('search', {
      type: 'foundry_memory_search',
      query: searchQuery.trim() || undefined,
    });
    if (!response) {
      return;
    }
    const rows = Array.isArray(response.memories) ? (response.memories as FoundryMemoryRow[]) : [];
    setMemories(rows);
    setStatusMessage(tr('options_foundry_memory_loaded' as never, [String(rows.length)] as never));
  };

  const addMemory = async () => {
    if (!newMemoryText.trim()) {
      setErrorMessage(tr('options_foundry_memory_errors_contentRequired'));
      return;
    }
    const response = await runMemoryAction('add', {
      type: 'foundry_memory_update',
      content: newMemoryText,
    });
    if (!response) {
      return;
    }
    setNewMemoryText('');
    setStatusMessage(tr('options_foundry_memory_added'));
    await loadMemories();
  };

  const saveEditedMemory = async () => {
    if (!editMemoryId || !editMemoryText.trim()) {
      return;
    }
    const existing = memories.find(item => item.memoryId === editMemoryId);
    const prompt = existing
      ? `Update my stored memory. Previous: ${existing.content}. New: ${editMemoryText.trim()}`
      : editMemoryText.trim();
    const response = await runMemoryAction('edit', {
      type: 'foundry_memory_update',
      content: prompt,
    });
    if (!response) {
      return;
    }
    setEditMemoryId(null);
    setEditMemoryText('');
    setStatusMessage(tr('options_foundry_memory_updated'));
    await loadMemories();
  };

  const forgetMemory = async (row: FoundryMemoryRow) => {
    const confirmed = window.confirm(tr('options_foundry_memory_forgetConfirm'));
    if (!confirmed) {
      return;
    }
    const response = await runMemoryAction('forget', {
      type: 'foundry_memory_update',
      content: `Please remove this from my memory profile: ${row.content}`,
    });
    if (!response) {
      return;
    }
    setStatusMessage(tr('options_foundry_memory_forgetSubmitted'));
    await loadMemories();
  };

  const clearScope = async () => {
    const confirmed = window.confirm(tr('options_foundry_memory_clearScopeConfirm'));
    if (!confirmed) {
      return;
    }
    const response = await runMemoryAction('clear_scope', { type: 'foundry_memory_delete_scope' });
    if (!response) {
      return;
    }
    setMemories([]);
    setStatusMessage(tr('options_foundry_memory_scopeCleared'));
  };

  const storeSelectValue = trimmedStore && storeNames.includes(trimmedStore) ? trimmedStore : '';

  return (
    <div className={`mt-4 space-y-3 border-t pt-4 ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`}>
      <div>
        <h4 className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {tr('options_foundry_memory_header')}
        </h4>
        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {tr('options_foundry_memory_desc')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            {tr('options_foundry_memory_storeLabel')}
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={busyAction !== null} onClick={() => void loadStores()}>
              {tr('options_foundry_memory_listStores')}
            </Button>
          </div>
          {storeNames.length > 0 ? (
            <select
              value={storeSelectValue}
              onChange={e => patchMemoryStoreName(e.target.value)}
              className={selectClass}>
              <option value="">{tr('options_foundry_memory_storeSelectPlaceholder')}</option>
              {storeNames.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <input
            type="text"
            value={memoryStoreName}
            onChange={e => patchMemoryStoreName(e.target.value)}
            onInput={e => patchMemoryStoreName(e.currentTarget.value)}
            placeholder={tr('options_foundry_memory_storePlaceholder')}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            {tr('options_foundry_memory_scopeLabel')}
          </label>
          <input
            type="text"
            value={memoryScope}
            onChange={e => patchMemoryScope(e.target.value)}
            onInput={e => patchMemoryScope(e.currentTarget.value)}
            placeholder={tr('options_foundry_memory_scopePlaceholder')}
            className={inputClass}
          />
        </div>
      </div>

      {!memoryConfigured && (
        <p className={`text-xs ${isDarkMode ? 'text-amber-400' : 'text-amber-700'}`}>
          {tr('options_foundry_memory_configureHint')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!memoryConfigured || busyAction !== null}
          onClick={() => void loadMemories()}>
          {tr('options_foundry_memory_load')}
        </Button>
        <Button variant="danger" disabled={!memoryConfigured || busyAction !== null} onClick={() => void clearScope()}>
          {tr('options_foundry_memory_clearScope')}
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={tr('options_foundry_memory_searchPlaceholder')}
          className={inputClass}
          disabled={!memoryConfigured}
        />
      </div>

      <div className="space-y-2">
        <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          {tr('options_foundry_memory_addLabel')}
        </label>
        <textarea
          value={newMemoryText}
          onChange={e => setNewMemoryText(e.target.value)}
          rows={2}
          placeholder={tr('options_foundry_memory_addPlaceholder')}
          className={inputClass}
          disabled={!memoryConfigured}
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!memoryConfigured || busyAction !== null}
            onClick={() => void addMemory()}>
            {tr('options_foundry_memory_add')}
          </Button>
        </div>
      </div>

      {memories.length > 0 && (
        <div className="space-y-2">
          <p className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            {tr('options_foundry_memory_listHeader')}
          </p>
          <div className="space-y-2">
            {memories.map(row =>
              editMemoryId === row.memoryId ? (
                <div
                  key={row.memoryId}
                  className={`rounded-md border p-3 ${isDarkMode ? 'border-slate-500' : 'border-gray-200'}`}>
                  <textarea
                    value={editMemoryText}
                    onChange={e => setEditMemoryText(e.target.value)}
                    rows={3}
                    className={inputClass}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setEditMemoryId(null)}>
                      {tr('options_foundry_memory_cancel')}
                    </Button>
                    <Button variant="primary" disabled={busyAction !== null} onClick={() => void saveEditedMemory()}>
                      {tr('options_foundry_memory_saveEdit')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  key={row.memoryId}
                  className={`rounded-md border p-3 ${isDarkMode ? 'border-slate-500 bg-slate-800/50' : 'border-gray-200 bg-white'}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={isDarkMode ? 'text-sky-300' : 'text-sky-700'}>{row.kind}</span>
                    <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
                      {formatUpdatedAt(row.updatedAt)}
                    </span>
                  </div>
                  <p className={`whitespace-pre-wrap text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    {row.content}
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditMemoryId(row.memoryId);
                        setEditMemoryText(row.content);
                      }}>
                      {tr('options_foundry_memory_edit')}
                    </Button>
                    <Button variant="danger" disabled={busyAction !== null} onClick={() => void forgetMemory(row)}>
                      {tr('options_foundry_memory_forget')}
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {statusMessage && (
        <p className={`text-xs ${isDarkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>{statusMessage}</p>
      )}
      {errorMessage && <p className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>{errorMessage}</p>}
    </div>
  );
};
