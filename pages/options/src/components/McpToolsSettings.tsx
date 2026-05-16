import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_GENERAL_SETTINGS, type GeneralSettingsConfig, generalSettingsStore } from '@extension/storage';
import {
  DEFAULT_MCP_TOOLS_SETTINGS,
  mcpToolsSettingsStore,
  type McpAuthType,
  type McpServerConfig,
  type McpToolsSettingsConfig,
  type McpTransport,
} from '@extension/storage/lib/settings/mcpTools';
import { t } from '@extension/i18n';

interface McpToolsSettingsProps {
  isDarkMode?: boolean;
}

const EMPTY_SERVER_DRAFT: McpServerConfig = {
  id: '',
  name: '',
  transport: 'streamable_http',
  endpoint: '',
  sseMessageEndpoint: '',
  authType: 'none',
  authToken: '',
  enabledToolNames: null,
};

function createServerId(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const uniqueSuffix = Math.random().toString(36).slice(2, 8);
  return `${normalized || 'mcp-server'}-${uniqueSuffix}`;
}

export const McpToolsSettings = ({ isDarkMode = false }: McpToolsSettingsProps) => {
  const tr = (key: string) => t(key as never);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettingsConfig>(DEFAULT_GENERAL_SETTINGS);
  const [settings, setSettings] = useState<McpToolsSettingsConfig>(DEFAULT_MCP_TOOLS_SETTINGS);
  const [draft, setDraft] = useState<McpServerConfig>(EMPTY_SERVER_DRAFT);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const [discoveringServerId, setDiscoveringServerId] = useState<string | null>(null);
  const [discoverySuccess, setDiscoverySuccess] = useState<{ serverId: string; tools: string[] } | null>(null);

  const activeServers = useMemo(() => settings.servers, [settings.servers]);

  useEffect(() => {
    let cancelled = false;
    const reloadFromStorage = async () => {
      const [mcpLatest, genLatest] = await Promise.all([
        mcpToolsSettingsStore.getSettings(),
        generalSettingsStore.getSettings(),
      ]);
      if (!cancelled) {
        setSettings(mcpLatest);
        setGeneralSettings(genLatest);
      }
    };

    void reloadFromStorage();

    const unsubMcp = mcpToolsSettingsStore.subscribe(() => {
      void reloadFromStorage();
    });
    const unsubGen = generalSettingsStore.subscribe(() => {
      void reloadFromStorage();
    });

    return () => {
      cancelled = true;
      unsubMcp();
      unsubGen();
    };
  }, []);

  async function persistGeneralSettings(patch: Partial<GeneralSettingsConfig>) {
    await generalSettingsStore.updateSettings(patch);
    setGeneralSettings(await generalSettingsStore.getSettings());
  }

  const validateDraft = (candidate: McpServerConfig): string => {
    if (!candidate.name.trim()) {
      return tr('options_mcp_errors_nameRequired');
    }
    if (!candidate.endpoint.trim()) {
      return tr('options_mcp_errors_endpointRequired');
    }
    try {
      const endpointUrl = new URL(candidate.endpoint);
      if (!['http:', 'https:'].includes(endpointUrl.protocol)) {
        return tr('options_mcp_errors_endpointProtocol');
      }
    } catch {
      return tr('options_mcp_errors_endpointInvalid');
    }
    if (candidate.transport === 'sse' && candidate.sseMessageEndpoint?.trim()) {
      try {
        const messageUrl = new URL(candidate.sseMessageEndpoint);
        if (!['http:', 'https:'].includes(messageUrl.protocol)) {
          return tr('options_mcp_errors_sseMessageProtocol');
        }
      } catch {
        return tr('options_mcp_errors_sseMessageInvalid');
      }
    }
    if (candidate.authType === 'bearer' && !candidate.authToken.trim()) {
      return tr('options_mcp_errors_tokenRequired');
    }
    return '';
  };

  const resetDraft = () => {
    setDraft(EMPTY_SERVER_DRAFT);
    setEditingServerId(null);
    setValidationError('');
  };

  const beginEdit = (server: McpServerConfig) => {
    setDraft(server);
    setEditingServerId(server.id);
    setValidationError('');
  };

  const submitDraft = async () => {
    const candidate: McpServerConfig = {
      ...draft,
      id: editingServerId || createServerId(draft.name),
    };
    const error = validateDraft(candidate);
    if (error) {
      setValidationError(error);
      return;
    }
    await mcpToolsSettingsStore.upsertServer(candidate);
    const latest = await mcpToolsSettingsStore.getSettings();
    setSettings(latest);
    resetDraft();
  };

  const removeServer = async (serverId: string) => {
    await mcpToolsSettingsStore.removeServer(serverId);
    const latest = await mcpToolsSettingsStore.getSettings();
    setSettings(latest);
    if (editingServerId === serverId) {
      resetDraft();
    }
  };

  const discoverTools = async (server: McpServerConfig) => {
    setDiscoveringServerId(server.id);
    setValidationError('');
    setDiscoverySuccess(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'mcp_discover_tools',
        server,
      });
      if (response === undefined) {
        setValidationError(tr('options_mcp_errors_bgUnreachable'));
        return;
      }
      if (!response.ok) {
        setValidationError(response.error || tr('options_mcp_errors_discoveryFailed'));
        return;
      }
      const discoveredTools = Array.isArray(response.tools) ? response.tools.map((name: unknown) => String(name)) : [];
      if (discoveredTools.length === 0) {
        setValidationError(tr('options_mcp_errors_discoveryEmpty'));
        return;
      }
      setDiscoverySuccess({ serverId: server.id, tools: discoveredTools });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : tr('options_mcp_errors_discoveryFailed'));
    } finally {
      setDiscoveringServerId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div
        className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-white'} p-6 text-left shadow-sm`}>
        <h2 className={`mb-1 text-left text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          {tr('options_mcp_header')}
        </h2>
        <p className={`mb-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{tr('options_mcp_desc')}</p>
        <p className={`mb-6 text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
          {tr('options_mcp_perTool_hint')}
        </p>

        <div className={`mb-6 space-y-4 rounded-lg border p-4 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
          <div>
            <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {tr('options_mcp_qaBuiltin_header')}
            </h3>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {tr('options_mcp_qaBuiltin_desc')}
            </p>
          </div>

          <div
            className={`flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between ${isDarkMode ? 'border-slate-600' : 'border-gray-200'}`}>
            <div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                {tr('options_mcp_qaBuiltin_thinking')}
              </p>
              <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {tr('options_mcp_qaBuiltin_thinking_desc')}
              </p>
            </div>
            <div className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                id="qaThinkingToolEnabled"
                type="checkbox"
                checked={generalSettings.qaEnableThinkingTool}
                onChange={e => void persistGeneralSettings({ qaEnableThinkingTool: e.target.checked })}
                className="peer sr-only"
              />
              <label
                htmlFor="qaThinkingToolEnabled"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{tr('options_mcp_qaBuiltin_thinking')}</span>
              </label>
            </div>
          </div>

          <div
            className={`flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between ${isDarkMode ? 'border-slate-600' : 'border-gray-200'}`}>
            <div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                {tr('options_mcp_qaBuiltin_webSearch')}
              </p>
              <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {tr('options_mcp_qaBuiltin_webSearch_desc')}
              </p>
            </div>
            <div className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                id="qaWebSearchToolEnabled"
                type="checkbox"
                checked={generalSettings.qaEnableWebSearchTool}
                onChange={e => void persistGeneralSettings({ qaEnableWebSearchTool: e.target.checked })}
                className="peer sr-only"
              />
              <label
                htmlFor="qaWebSearchToolEnabled"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{tr('options_mcp_qaBuiltin_webSearch')}</span>
              </label>
            </div>
          </div>

          <div
            className={`flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between ${isDarkMode ? 'border-slate-600' : 'border-gray-200'}`}>
            <div>
              <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                {tr('options_mcp_qaBuiltin_fetchUrl')}
              </p>
              <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {tr('options_mcp_qaBuiltin_fetchUrl_desc')}
              </p>
            </div>
            <div className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                id="qaFetchUrlToolEnabled"
                type="checkbox"
                checked={generalSettings.qaEnableFetchUrlTool}
                onChange={e => void persistGeneralSettings({ qaEnableFetchUrlTool: e.target.checked })}
                className="peer sr-only"
              />
              <label
                htmlFor="qaFetchUrlToolEnabled"
                className={`peer h-6 w-11 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'} after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300`}>
                <span className="sr-only">{tr('options_mcp_qaBuiltin_fetchUrl')}</span>
              </label>
            </div>
          </div>
        </div>

        <div className={`space-y-4 rounded-lg border ${isDarkMode ? 'border-slate-700' : 'border-gray-200'} p-4`}>
          <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {editingServerId ? tr('options_mcp_editServer') : tr('options_mcp_addServer')}
          </h3>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              type="text"
              value={draft.name}
              onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
              placeholder={tr('options_mcp_name_placeholder')}
              className={`rounded-md border px-3 py-2 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}
            />
            <select
              value={draft.transport}
              onChange={e => setDraft(prev => ({ ...prev, transport: e.target.value as McpTransport }))}
              className={`rounded-md border px-3 py-2 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}>
              <option value="streamable_http">{tr('options_mcp_transport_streamableHttp')}</option>
              <option value="sse">{tr('options_mcp_transport_sse')}</option>
            </select>
            <input
              type="url"
              value={draft.endpoint}
              onChange={e => setDraft(prev => ({ ...prev, endpoint: e.target.value }))}
              placeholder={
                draft.transport === 'sse'
                  ? tr('options_mcp_endpoint_placeholder_sse')
                  : tr('options_mcp_endpoint_placeholder_streamable')
              }
              className={`rounded-md border px-3 py-2 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              } md:col-span-2`}
            />
            {draft.transport === 'sse' && (
              <>
                <input
                  type="url"
                  value={draft.sseMessageEndpoint ?? ''}
                  onChange={e => setDraft(prev => ({ ...prev, sseMessageEndpoint: e.target.value }))}
                  placeholder={tr('options_mcp_sseMessageEndpoint_placeholder')}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    isDarkMode
                      ? 'border-slate-600 bg-slate-700 text-gray-200'
                      : 'border-gray-300 bg-white text-gray-700'
                  } md:col-span-2`}
                />
                <p
                  className={`text-xs leading-relaxed md:col-span-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {tr('options_mcp_sse_hint')}
                </p>
              </>
            )}
            <select
              value={draft.authType}
              onChange={e => setDraft(prev => ({ ...prev, authType: e.target.value as McpAuthType }))}
              className={`rounded-md border px-3 py-2 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              }`}>
              <option value="none">{tr('options_mcp_auth_none')}</option>
              <option value="bearer">{tr('options_mcp_auth_bearer')}</option>
            </select>
            <input
              type="password"
              value={draft.authToken}
              onChange={e => setDraft(prev => ({ ...prev, authToken: e.target.value }))}
              placeholder={tr('options_mcp_authToken_placeholder')}
              disabled={draft.authType !== 'bearer'}
              className={`rounded-md border px-3 py-2 text-sm ${
                isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-gray-300 bg-white text-gray-700'
              } disabled:opacity-50`}
            />
          </div>

          {validationError && (
            <p className={`text-sm ${isDarkMode ? 'text-rose-300' : 'text-rose-600'}`}>{validationError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submitDraft}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                isDarkMode ? 'bg-sky-600 text-white hover:bg-sky-500' : 'bg-sky-500 text-white hover:bg-sky-600'
              }`}>
              {editingServerId ? tr('options_mcp_saveChanges') : tr('options_mcp_addButton')}
            </button>
            {editingServerId && (
              <button
                type="button"
                onClick={resetDraft}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  isDarkMode
                    ? 'bg-slate-700 text-gray-200 hover:bg-slate-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}>
                {tr('options_mcp_cancelEdit')}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <h3 className={`text-base font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {tr('options_mcp_servers')}
          </h3>
          {activeServers.length === 0 ? (
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{tr('options_mcp_empty')}</p>
          ) : (
            activeServers.map(server => (
              <div
                key={server.id}
                className={`rounded-md border p-3 ${isDarkMode ? 'border-slate-600 bg-slate-700/40' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      {server.name}
                    </p>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{server.endpoint}</p>
                    <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {server.transport === 'streamable_http'
                        ? tr('options_mcp_transport_streamableHttp')
                        : tr('options_mcp_transport_sse')}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(server)}
                      className={`rounded px-2 py-1 text-xs ${
                        isDarkMode
                          ? 'bg-slate-600 text-gray-100 hover:bg-slate-500'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}>
                      {tr('options_mcp_edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => discoverTools(server)}
                      disabled={discoveringServerId === server.id}
                      className={`rounded px-2 py-1 text-xs ${
                        isDarkMode
                          ? 'bg-sky-700 text-sky-100 hover:bg-sky-600'
                          : 'bg-sky-100 text-sky-700 hover:bg-sky-200'
                      } disabled:cursor-not-allowed disabled:opacity-60`}>
                      {discoveringServerId === server.id
                        ? tr('options_mcp_discovering')
                        : tr('options_mcp_discoverTools')}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeServer(server.id)}
                      className={`rounded px-2 py-1 text-xs ${
                        isDarkMode
                          ? 'bg-rose-700 text-rose-100 hover:bg-rose-600'
                          : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                      }`}>
                      {tr('options_mcp_remove')}
                    </button>
                  </div>
                </div>
                {discoverySuccess?.serverId === server.id && discoverySuccess.tools.length > 0 && (
                  <div
                    className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                      isDarkMode
                        ? 'border-emerald-700/60 bg-emerald-950/35 text-emerald-100'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    }`}>
                    <p className="font-medium">
                      {t('options_mcp_discover_success' as never, [String(discoverySuccess.tools.length)] as never)}
                    </p>
                    <ul
                      className={`mt-1 list-inside list-disc space-y-0.5 ${isDarkMode ? 'text-emerald-200/95' : 'text-emerald-900'}`}>
                      {discoverySuccess.tools.map(name => (
                        <li key={name} className="font-mono">
                          {name}
                        </li>
                      ))}
                    </ul>
                    <p className={`mt-2 ${isDarkMode ? 'text-emerald-300/90' : 'text-emerald-800'}`}>
                      {tr('options_mcp_discover_toolTogglesHint')}
                    </p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};
