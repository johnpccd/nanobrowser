import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  chatHistoryStore,
} from '@extension/storage';
import { mcpToolsSettingsStore, type McpServerConfig } from '@extension/storage/lib/settings/mcpTools';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { formatSearchResultsForPrompt, searchSearxng } from './services/searxng';
import { injectBuildDomTreeScripts, getMarkdownContent } from './browser/dom/service';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { Actors } from '@extension/storage/lib/chat/types';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { readUrlWithJina } from './services/jinaReader';
import { discoverMcpTools, executeMcpTool } from './services/mcpClient';

const logger = createLogger('background');

const browserContext = new BrowserContext({});

// Multi-tab connection tracking
interface TabConnection {
  executor?: Executor;
  port?: chrome.runtime.Port;
  qaStream?: AbortController;
  mode?: 'automation' | 'qa';
}

const tabConnections = new Map<number, TabConnection>();

const SIDE_PANEL_URL = chrome.runtime.getURL('side-panel/index.html');
const MAX_QA_TOOL_CALLS = 3;
/** Reasoning steps via `thinking` tool; separate cap so web/MCP budget stays usable. */
const MAX_QA_THINKING_CALLS = 5;
/** Upper bound on tool-calling round-trips (each round: one model invoke). */
const MAX_QA_TOOL_ROUNDS = 16;
const MAX_TOOL_EVENT_DETAIL_CHARS = 6000;

function truncateToolDetail(value: string): string {
  if (value.length <= MAX_TOOL_EVENT_DETAIL_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_TOOL_EVENT_DETAIL_CHARS)}\n\n[truncated]`;
}

/** LLM providers typically require tool names like ^[a-zA-Z0-9_-]+$ and length caps (~64). */
const MAX_MCP_BOUND_TOOL_NAME_LEN = 64;

function hashMcpToolKey(serverId: string, toolName: string): string {
  let hash = 0x811c9dc5;
  const s = `${serverId}\0${toolName}`;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeMcpToolName(serverId: string, toolName: string): string {
  const idPart = hashMcpToolKey(serverId, toolName).slice(0, 12);
  const safeTool = toolName
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const tail = safeTool || 'tool';
  const base = `mcp_${idPart}_${tail}`;
  if (base.length <= MAX_MCP_BOUND_TOOL_NAME_LEN) {
    return base;
  }
  const budget = MAX_MCP_BOUND_TOOL_NAME_LEN - `mcp_${idPart}_`.length;
  return `mcp_${idPart}_${tail.slice(0, Math.max(1, budget))}`;
}

function formatMcpInputSchemaHint(inputSchema: unknown): string {
  if (inputSchema === null || inputSchema === undefined) {
    return '';
  }
  try {
    const s = JSON.stringify(inputSchema);
    if (s.length > 450) {
      return `\nExpected arguments (JSON Schema, truncated): ${s.slice(0, 450)}…`;
    }
    return s.length > 2 ? `\nExpected arguments (JSON Schema): ${s}` : '';
  } catch {
    return '';
  }
}

/** Map model tool args to MCP `tools/call` arguments (handles `arguments_json` string). */
function coerceMcpToolCallArgs(toolArgs: Record<string, unknown>): Record<string, unknown> {
  const raw = toolArgs.arguments_json;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  const rest = { ...toolArgs };
  delete rest.arguments_json;
  return rest;
}

function emitQAToolEvent(
  port: chrome.runtime.Port | undefined,
  params: {
    sessionId: string;
    tabId: number;
    toolName: string;
    kind: 'call' | 'result';
    summary: string;
    detail?: string;
    requestDetail?: string;
    toolRunId?: string;
    status?: 'pending' | 'success' | 'error';
  },
) {
  if (!port) {
    return;
  }

  port.postMessage({
    type: 'qa_tool_event',
    sessionId: params.sessionId,
    tabId: params.tabId,
    toolMessage: {
      actor: Actors.SYSTEM,
      content: '',
      timestamp: Date.now(),
      toolEvent: {
        kind: params.kind,
        toolName: params.toolName,
        summary: params.summary,
        detail: params.detail,
        requestDetail: params.requestDetail,
        toolRunId: params.toolRunId,
        status: params.status,
      },
    },
  });
}
function getMessageTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
          return item.text;
        }

        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

// Setup side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error(error));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    await injectBuildDomTreeScripts(tabId);
  }
});

// Listen for debugger detached event
// if canceled_by_user, remove the tab from the browser context
chrome.debugger.onDetach.addListener(async (source, reason) => {
  console.log('Debugger detached:', source, reason);
  if (reason === 'canceled_by_user') {
    if (source.tabId) {
      const tabConn = tabConnections.get(source.tabId);
      tabConn?.executor?.cancel();
      await browserContext.cleanup();
    }
  }
});

// Cleanup when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  browserContext.removeAttachedPage(tabId);
  // Cleanup tab connection
  const tabConn = tabConnections.get(tabId);
  if (tabConn) {
    tabConn.executor?.cancel();
    tabConn.qaStream?.abort();
    tabConnections.delete(tabId);
  }
});

logger.info('background loaded');

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'test_searxng') {
    (async () => {
      try {
        const testQuery = 'OpenAI latest news';
        const results = await searchSearxng(
          testQuery,
          {
            enabled: true,
            baseUrl: String(message.config?.baseUrl || ''),
            apiKey: String(message.config?.apiKey || ''),
            maxResults: Number(message.config?.maxResults || 5),
          },
          undefined,
        );

        if (results.length === 0) {
          sendResponse({
            ok: false,
            error:
              'The request reached SearXNG, but no usable search results were returned for the test query. Check whether your instance has working engines enabled and whether JSON search is allowed.',
          });
          return;
        }

        sendResponse({
          ok: true,
          query: testQuery,
          resultCount: results.length,
          firstResult: {
            title: results[0].title,
            url: results[0].url,
          },
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Unknown SearXNG test failure',
        });
      }
    })();

    return true;
  }

  if (message?.type === 'mcp_discover_tools') {
    (async () => {
      try {
        const server = message.server as McpServerConfig | undefined;
        if (!server) {
          sendResponse({ ok: false, error: 'No MCP server config provided.' });
          return;
        }
        const tools = await discoverMcpTools(server);
        sendResponse({
          ok: true,
          tools: tools.map(tool => tool.name),
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'MCP tool discovery failed.',
        });
      }
    })();

    return true;
  }

  // Handle other message types if needed in the future
  return false;
});

// Setup connection listener for long-lived connections (e.g., side panel)
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'side-panel-connection') {
    const senderUrl = port.sender?.url;
    const senderId = port.sender?.id;

    if (!senderUrl || senderId !== chrome.runtime.id || senderUrl !== SIDE_PANEL_URL) {
      logger.warning('Blocked unauthorized side-panel-connection', senderId, senderUrl);
      port.disconnect();
      return;
    }

    // Track port but associate with tab when first message arrives
    let portTabId: number | null = null;

    port.onMessage.addListener(async message => {
      // Associate port with tabId from first message that has it
      if (!portTabId && message.tabId) {
        portTabId = message.tabId;
        if (portTabId !== null) {
          const tabConn = tabConnections.get(portTabId) || {};
          tabConn.port = port;
          tabConnections.set(portTabId, tabConn);
        }
      }
      try {
        switch (message.type) {
          case 'heartbeat':
            // Acknowledge heartbeat
            port.postMessage({ type: 'heartbeat_ack' });
            break;

          case 'new_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_newTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('new_task', message.tabId, message.task);

            // Get or create tab connection
            let tabConn = tabConnections.get(message.tabId);
            if (!tabConn) {
              tabConn = { port, mode: 'automation' };
              tabConnections.set(message.tabId, tabConn);
            } else {
              tabConn.port = port;
            }

            const executor = await setupExecutor(message.taskId, message.task, browserContext);
            tabConn.executor = executor;
            subscribeToExecutorEvents(executor, message.tabId);

            const result = await executor.execute();
            logger.info('new_task execution result', message.tabId, result);
            break;
          }

          case 'follow_up_task': {
            if (!message.task) return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_noTask') });
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });

            logger.info('follow_up_task', message.tabId, message.task);

            const tabConn = tabConnections.get(message.tabId);
            // If executor exists, add follow-up task
            if (tabConn?.executor) {
              tabConn.executor.addFollowUpTask(message.task);
              // Re-subscribe to events in case the previous subscription was cleaned up
              subscribeToExecutorEvents(tabConn.executor, message.tabId);
              const result = await tabConn.executor.execute();
              logger.info('follow_up_task execution result', message.tabId, result);
            } else {
              // executor was cleaned up, can not add follow-up task
              logger.info('follow_up_task: executor was cleaned up, can not add follow-up task');
              return port.postMessage({ type: 'error', error: t('bg_cmd_followUpTask_cleaned') });
            }
            break;
          }

          case 'cancel_task': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const tabConn = tabConnections.get(message.tabId);
            if (!tabConn?.executor && !tabConn?.qaStream) {
              return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            }
            if (tabConn.executor) {
              await tabConn.executor.cancel();
            }
            if (tabConn.qaStream) {
              tabConn.qaStream.abort();
              tabConn.qaStream = undefined;
            }
            break;
          }

          case 'resume_task': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const tabConn = tabConnections.get(message.tabId);
            if (!tabConn?.executor) return port.postMessage({ type: 'error', error: t('bg_cmd_resumeTask_noTask') });
            await tabConn.executor.resume();
            return port.postMessage({ type: 'success' });
          }

          case 'pause_task': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const tabConn = tabConnections.get(message.tabId);
            if (!tabConn?.executor) return port.postMessage({ type: 'error', error: t('bg_errors_noRunningTask') });
            await tabConn.executor.pause();
            return port.postMessage({ type: 'success' });
          }

          case 'screenshot': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            const page = await browserContext.switchTab(message.tabId);
            const screenshot = await page.takeScreenshot();
            logger.info('screenshot', message.tabId, screenshot);
            return port.postMessage({ type: 'success', screenshot });
          }

          case 'capture_screenshot': {
            // Handle screenshot capture for QA mode image capture feature
            if (!message.tabId) {
              return port.postMessage({ type: 'screenshot_result', error: t('bg_errors_noTabId') });
            }
            try {
              const page = await browserContext.switchTab(message.tabId);
              const screenshot = await page.takeScreenshot();
              logger.info('capture_screenshot', message.tabId, screenshot ? 'success' : 'failed');
              return port.postMessage({ type: 'screenshot_result', screenshot });
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Failed to capture screenshot';
              logger.error('capture_screenshot failed:', error);
              return port.postMessage({ type: 'screenshot_result', error: errorMessage });
            }
          }

          case 'state': {
            try {
              const browserState = await browserContext.getState(true);
              const elementsText = browserState.elementTree.clickableElementsToString(
                DEFAULT_AGENT_OPTIONS.includeAttributes,
              );

              logger.info('state', browserState);
              logger.info('interactive elements', elementsText);
              return port.postMessage({ type: 'success', msg: t('bg_cmd_state_printed') });
            } catch (error) {
              logger.error('Failed to get state:', error);
              return port.postMessage({ type: 'error', error: t('bg_cmd_state_failed') });
            }
          }

          case 'nohighlight': {
            const page = await browserContext.getCurrentPage();
            await page.removeHighlight();
            return port.postMessage({ type: 'success', msg: t('bg_cmd_nohighlight_ok') });
          }

          case 'speech_to_text': {
            try {
              if (!message.audio) {
                return port.postMessage({
                  type: 'speech_to_text_error',
                  error: t('bg_cmd_stt_noAudioData'),
                });
              }

              logger.info('Processing speech-to-text request...');

              // Get all providers for speech-to-text service
              const providers = await llmProviderStore.getAllProviders();

              // Create speech-to-text service with all providers
              const speechToTextService = await SpeechToTextService.create(providers);

              // Extract base64 audio data (remove data URL prefix if present)
              let base64Audio = message.audio;
              if (base64Audio.startsWith('data:')) {
                base64Audio = base64Audio.split(',')[1];
              }

              // Transcribe audio
              const transcribedText = await speechToTextService.transcribeAudio(base64Audio);

              logger.info('Speech-to-text completed successfully');
              return port.postMessage({
                type: 'speech_to_text_result',
                text: transcribedText,
              });
            } catch (error) {
              logger.error('Speech-to-text failed:', error);
              return port.postMessage({
                type: 'speech_to_text_error',
                error: error instanceof Error ? error.message : t('bg_cmd_stt_failed'),
              });
            }
          }

          case 'replay': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.taskId) return port.postMessage({ type: 'error', error: t('bg_errors_noTaskId') });
            if (!message.historySessionId)
              return port.postMessage({ type: 'error', error: t('bg_cmd_replay_noHistory') });
            logger.info('replay', message.tabId, message.taskId, message.historySessionId);

            try {
              // Switch to the specified tab
              await browserContext.switchTab(message.tabId);

              // Get or create tab connection
              let tabConn = tabConnections.get(message.tabId);
              if (!tabConn) {
                tabConn = { port, mode: 'automation' };
                tabConnections.set(message.tabId, tabConn);
              } else {
                tabConn.port = port;
              }

              // Setup executor with the new taskId and a dummy task description
              const executor = await setupExecutor(message.taskId, message.task, browserContext);
              tabConn.executor = executor;
              subscribeToExecutorEvents(executor, message.tabId);

              // Run replayHistory with the history session ID
              const result = await executor.replayHistory(message.historySessionId);
              logger.debug('replay execution result', message.tabId, result);
            } catch (error) {
              logger.error('Replay failed:', error);
              return port.postMessage({
                type: 'error',
                error: error instanceof Error ? error.message : t('bg_cmd_replay_failed'),
              });
            }
            break;
          }

          case 'qa_query': {
            if (!message.tabId) return port.postMessage({ type: 'error', error: t('bg_errors_noTabId') });
            if (!message.query && !message.imageData)
              return port.postMessage({ type: 'error', error: 'No query or image provided' });
            if (!message.sessionId) return port.postMessage({ type: 'error', error: 'No session ID provided' });

            const tabId = message.tabId;
            const userQuery = message.query || '';
            const sessionId = message.sessionId;
            const imageData = message.imageData as string | undefined;
            const includePageContent = message.includePageContent !== false; // Default to true
            const personaSystemPrompt = typeof message.personaSystemPrompt === 'string' ? message.personaSystemPrompt : '';
            const personaName = typeof message.personaName === 'string' ? message.personaName : 'Default';

            // Get or create tab connection
            let tabConn = tabConnections.get(tabId);
            if (!tabConn) {
              tabConn = { port, mode: 'qa' };
              tabConnections.set(tabId, tabConn);
            } else {
              // Update port reference but don't overwrite if it's the same port
              // This allows multiple tabs to share the same side panel port
              tabConn.port = port;
              tabConn.mode = 'qa';
            }

            // Cancel any existing QA stream for THIS SPECIFIC TAB only
            // Each tab has its own tabConn entry, so this won't affect other tabs
            if (tabConn.qaStream) {
              tabConn.qaStream.abort();
              tabConn.qaStream = undefined;
            }

            // Create new abort controller
            const abortController = new AbortController();
            tabConn.qaStream = abortController;

            // Execute QA query asynchronously
            // Capture tabConn in closure to ensure this stream uses the correct connection
            // even if the port reference gets updated for other tabs
            (async () => {
              // Capture the tabConn at the start to ensure we use the correct one
              const streamTabConn = tabConn;
              try {
                let pageContent = '';

                const generalSettings = await generalSettingsStore.getSettings();
                const enableWebSearch =
                  message.enableWebSearch !== undefined
                    ? Boolean(message.enableWebSearch)
                    : generalSettings.enableWebSearch;
                const session = await chatHistoryStore.getSession(sessionId);

                // 0. Only get page content if includePageContent is true
                if (includePageContent) {
                  // Ensure scripts are injected before getting markdown content
                  await injectBuildDomTreeScripts(tabId);

                  // Get page markdown content
                  pageContent = await getMarkdownContent(tabId);
                }

                // 2. Get QA model config
                const qaModel = await agentModelStore.getAgentModel(AgentNameEnum.QA);
                if (!qaModel) {
                  throw new Error('QA model not configured. Please configure it in settings.');
                }

                const providers = await llmProviderStore.getAllProviders();
                const provider = providers[qaModel.provider];
                if (!provider) {
                  throw new Error(`Provider ${qaModel.provider} not found`);
                }

                // 3. Create LLM instance
                const qaLLM = createChatModel(provider, qaModel);
                const mcpSettings = await mcpToolsSettingsStore.getSettings();

                const thinkingTool = new DynamicStructuredTool({
                  name: 'thinking',
                  description:
                    'Use for deliberate step-by-step reasoning before you answer: clarify the question, list assumptions, weigh tradeoffs, outline a plan, or note what evidence you still need. Does not fetch facts from the web or page; call web_search, fetch_url, or MCP tools when you need external data. You may call this multiple times in one turn if it helps.',
                  schema: z.object({
                    thought: z
                      .string()
                      .min(1)
                      .describe('Your reasoning: analysis, plan, uncertainties, or intermediate conclusions in plain text.'),
                  }),
                  func: async ({ thought }) => {
                    const requestDetail = thought.trim();
                    // One emit: call+result races async `addMessage` and duplicated the row in the side panel.
                    emitQAToolEvent(streamTabConn?.port, {
                      sessionId,
                      tabId,
                      toolName: 'thinking',
                      kind: 'result',
                      summary: 'Reasoning',
                      requestDetail,
                      detail: '',
                      status: 'success',
                    });
                    return '';
                  },
                });

                const webSearchTool = new DynamicStructuredTool({
                  name: 'web_search',
                  description:
                    'Search the public web using SearXNG. You must provide the exact query string to search for.',
                  schema: z.object({
                    query: z
                      .string()
                      .min(2)
                      .describe(
                        'The exact search query to run. Rewrite vague follow-ups into a concrete query yourself.',
                      ),
                  }),
                  func: async ({ query }) => {
                    const normalizedQuery = query.trim();
                    const requestDetail = `Query: ${normalizedQuery}\nBase URL: ${generalSettings.searxngBaseUrl}`;
                    const toolRunId = crypto.randomUUID();

                    emitQAToolEvent(streamTabConn?.port, {
                      sessionId,
                      tabId,
                      toolName: 'web_search',
                      kind: 'call',
                      summary: 'Searching…',
                      requestDetail,
                      toolRunId,
                      status: 'pending',
                    });

                    try {
                      const webSearchResults = await searchSearxng(
                        normalizedQuery,
                        {
                          enabled: true,
                          baseUrl: generalSettings.searxngBaseUrl,
                          apiKey: generalSettings.searxngApiKey,
                          maxResults: generalSettings.searxngMaxResults,
                        },
                        abortController.signal,
                      );
                      const formattedResults = formatSearchResultsForPrompt(webSearchResults);

                      emitQAToolEvent(streamTabConn?.port, {
                        sessionId,
                        tabId,
                        toolName: 'web_search',
                        kind: 'result',
                        summary: `Retrieved ${webSearchResults.length} search result(s)`,
                        requestDetail,
                        detail: formattedResults || 'No formatted snippets were produced.',
                        toolRunId,
                        status: 'success',
                      });

                      return formattedResults || 'No usable search results were returned.';
                    } catch (searchError) {
                      const errorMessage = searchError instanceof Error ? searchError.message : String(searchError);
                      emitQAToolEvent(streamTabConn?.port, {
                        sessionId,
                        tabId,
                        toolName: 'web_search',
                        kind: 'result',
                        summary: 'Search failed',
                        requestDetail,
                        detail: errorMessage,
                        toolRunId,
                        status: 'error',
                      });
                      return `Search failed: ${errorMessage}`;
                    }
                  },
                });
                const fetchUrlTool = new DynamicStructuredTool({
                  name: 'fetch_url',
                  description:
                    'Fetch readable page content for a specific public http/https URL using Jina Reader. Use this after search when you need the underlying page content.',
                  schema: z.object({
                    url: z.string().url().describe('The exact public http or https URL to fetch'),
                  }),
                  func: async ({ url }) => {
                    const normalizedUrl = url.trim();
                    const requestDetail = `URL: ${normalizedUrl}`;
                    const toolRunId = crypto.randomUUID();

                    emitQAToolEvent(streamTabConn?.port, {
                      sessionId,
                      tabId,
                      toolName: 'fetch_url',
                      kind: 'call',
                      summary: 'Fetching…',
                      requestDetail,
                      toolRunId,
                      status: 'pending',
                    });

                    try {
                      const result = await readUrlWithJina(
                        normalizedUrl,
                        {
                          apiKey: generalSettings.jinaReaderApiKey,
                        },
                        abortController.signal,
                      );

                      const detail = [
                        `Source URL: ${result.url}`,
                        result.truncated ? 'Content was truncated to fit the QA context window.' : '',
                        '',
                        result.content,
                      ]
                        .filter(Boolean)
                        .join('\n');

                      emitQAToolEvent(streamTabConn?.port, {
                        sessionId,
                        tabId,
                        toolName: 'fetch_url',
                        kind: 'result',
                        summary: 'Fetched readable page content',
                        requestDetail,
                        detail,
                        toolRunId,
                        status: 'success',
                      });

                      return detail;
                    } catch (fetchError) {
                      const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
                      emitQAToolEvent(streamTabConn?.port, {
                        sessionId,
                        tabId,
                        toolName: 'fetch_url',
                        kind: 'result',
                        summary: 'Fetch failed',
                        requestDetail,
                        detail: errorMessage,
                        toolRunId,
                        status: 'error',
                      });
                      return `Fetch failed: ${errorMessage}`;
                    }
                  },
                });
                const enabledMcpServers = mcpSettings.enabled
                  ? mcpSettings.servers.filter(server => server.enabled && server.endpoint)
                  : [];
                const mcpToolsByName = new Map<
                  string,
                  {
                    server: McpServerConfig;
                    toolName: string;
                  }
                >();
                const mcpDynamicTools: DynamicStructuredTool[] = [];

                for (const server of enabledMcpServers) {
                  try {
                    const discoveredTools = await discoverMcpTools(server, {
                      signal: abortController.signal,
                    });
                    for (const tool of discoveredTools) {
                      if (!tool.name) {
                        continue;
                      }
                      if (server.toolAccessMode === 'allowlist' && !server.allowedTools.includes(tool.name)) {
                        continue;
                      }
                      const normalizedToolName = normalizeMcpToolName(server.id, tool.name);
                      mcpToolsByName.set(normalizedToolName, {
                        server,
                        toolName: tool.name,
                      });
                      const mcpDescription = [
                        tool.description ||
                          `Call MCP tool "${tool.name}" on server "${server.name}" when it directly helps the user.`,
                        'Pass arguments as a single JSON object string in `arguments_json` (e.g. `{}` or `{"query":"hello"}`).',
                        formatMcpInputSchemaHint(tool.inputSchema),
                      ]
                        .filter(Boolean)
                        .join(' ');
                      mcpDynamicTools.push(
                        new DynamicStructuredTool({
                          name: normalizedToolName,
                          description: mcpDescription,
                          schema: z.object({
                            arguments_json: z
                              .string()
                              .describe(
                                'JSON object as a string of named arguments for this MCP tool. Use "{}" if none. Example: {"path":"/tmp"}',
                              ),
                          }),
                          func: async ({ arguments_json }) => {
                            let safeArgs: Record<string, unknown> = {};
                            const raw = arguments_json?.trim() ?? '';
                            if (raw) {
                              try {
                                const parsed = JSON.parse(raw) as unknown;
                                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                  safeArgs = parsed as Record<string, unknown>;
                                }
                              } catch {
                                safeArgs = {};
                              }
                            }
                            const requestDetail = truncateToolDetail(`Arguments: ${JSON.stringify(safeArgs, null, 2)}`);
                            const toolRunId = crypto.randomUUID();
                            emitQAToolEvent(streamTabConn?.port, {
                              sessionId,
                              tabId,
                              toolName: `mcp:${server.name}/${tool.name}`,
                              kind: 'call',
                              summary: 'Calling MCP…',
                              requestDetail,
                              toolRunId,
                              status: 'pending',
                            });
                            try {
                              const result = await executeMcpTool(server, {
                                toolName: tool.name,
                                argumentsInput: safeArgs,
                                signal: abortController.signal,
                              });
                              emitQAToolEvent(streamTabConn?.port, {
                                sessionId,
                                tabId,
                                toolName: `mcp:${server.name}/${tool.name}`,
                                kind: 'result',
                                summary: 'MCP tool call succeeded',
                                requestDetail,
                                detail: truncateToolDetail(result.content),
                                toolRunId,
                                status: 'success',
                              });
                              return result.content;
                            } catch (mcpError) {
                              const errorMessage = mcpError instanceof Error ? mcpError.message : String(mcpError);
                              emitQAToolEvent(streamTabConn?.port, {
                                sessionId,
                                tabId,
                                toolName: `mcp:${server.name}/${tool.name}`,
                                kind: 'result',
                                summary: 'MCP tool call failed',
                                requestDetail,
                                detail: truncateToolDetail(errorMessage),
                                toolRunId,
                                status: 'error',
                              });
                              return `MCP tool call failed: ${errorMessage}`;
                            }
                          },
                        }),
                      );
                    }
                  } catch (error) {
                    logger.warning('Failed to discover MCP tools', server.name, error);
                  }
                }

                const qaTools: DynamicStructuredTool[] = [thinkingTool];
                if (enableWebSearch && generalSettings.searxngBaseUrl) {
                  qaTools.push(webSearchTool, fetchUrlTool);
                }
                qaTools.push(...mcpDynamicTools);

                const qaLLMWithTools =
                  typeof (qaLLM as BaseChatModel & { bindTools?: (tools: unknown[]) => BaseChatModel }).bindTools ===
                  'function'
                    ? (qaLLM as BaseChatModel & { bindTools: (tools: unknown[]) => BaseChatModel }).bindTools(qaTools)
                    : null;

                // 4. Load chat history for this session and build conversation
                const conversationMessages: (SystemMessage | HumanMessage | AIMessage)[] = [];

                // Add system message - different prompts based on whether page content is included
                const systemSections: string[] = [
                  (personaSystemPrompt || '').trim() ||
                    (includePageContent && pageContent
                      ? 'You are a helpful assistant. Answer questions based on the provided page content and any web search results. Be concise and accurate.'
                      : 'You are a helpful, knowledgeable, and friendly AI assistant. Provide clear, accurate, and helpful responses to the user. Be concise but thorough.'),
                ];

                systemSections.push(`Active persona: ${personaName}`);

                if (includePageContent && pageContent) {
                  systemSections.push(`Current page content:\n${pageContent}`);
                }

                if (qaLLMWithTools) {
                  const promptHints: string[] = [
                    'The `thinking` tool is available: call it to work through logic, planning, or ambiguity before you commit to an answer. It only records your reasoning for this turn; it does not load new information.',
                    `Use at most ${MAX_QA_THINKING_CALLS} thinking calls per answer; then finalize or use other tools.`,
                  ];
                  if (enableWebSearch && generalSettings.searxngBaseUrl) {
                    promptHints.push(
                      'Web search is available as the `web_search` tool.',
                      'Readable page fetch is available as the `fetch_url` tool.',
                      'You decide whether to use it and what query to send.',
                      'If the user gives a vague follow-up like "look that up online", infer the concrete search query from the conversation yourself before calling the tool.',
                      'Use `web_search` to discover relevant links or fresh information.',
                      'Use `fetch_url` only when you want to inspect the contents of a specific result URL or source page more deeply.',
                      `Use at most ${MAX_QA_TOOL_CALLS} web_search calls in one answer.`,
                      `Use at most ${MAX_QA_TOOL_CALLS} fetch_url calls in one answer.`,
                      'Cite URLs from search results when relying on them.',
                    );
                  }
                  if (mcpDynamicTools.length > 0) {
                    promptHints.push(
                      'MCP tools are registered under short names starting with `mcp_`.',
                      'For every MCP tool call you must pass `arguments_json`: a string containing a JSON object of named parameters (use "{}" if the tool needs no arguments).',
                      'Use MCP tools only when they are directly helpful to answer the user request.',
                      `Use at most ${MAX_QA_TOOL_CALLS} MCP tool calls in one answer.`,
                    );
                  }
                  systemSections.push(promptHints.join(' '));
                } else if ((enableWebSearch && generalSettings.searxngBaseUrl) || mcpDynamicTools.length > 0) {
                  systemSections.push(
                    'External tools are enabled, but this QA model does not support tool calling in this path. Do not claim to have used tools unless you actually have.',
                  );
                }

                conversationMessages.push(new SystemMessage(systemSections.join('\n\n')));

                // Convert stored messages to LangChain messages
                // Include ALL messages from history to maintain conversation context
                if (session && session.messages && session.messages.length > 0) {
                  for (const msg of session.messages) {
                    if (msg.actor === Actors.USER) {
                      // Check if message has an image attached (stored in extended message type)
                      const msgWithImage = msg as { imageData?: string } & typeof msg;
                      if (msgWithImage.imageData) {
                        // Create message with both text and image
                        conversationMessages.push(
                          new HumanMessage({
                            content: [
                              { type: 'text', text: msg.content || 'Please analyze this image.' },
                              {
                                type: 'image_url',
                                image_url: { url: `data:image/jpeg;base64,${msgWithImage.imageData}` },
                              },
                            ],
                          }),
                        );
                      } else {
                        conversationMessages.push(new HumanMessage(msg.content));
                      }
                    } else if (msg.actor === Actors.SYSTEM) {
                      // SYSTEM actor is used for AI responses in QA mode
                      conversationMessages.push(new AIMessage(msg.content));
                    }
                    // Skip other actor types (PLANNER, NAVIGATOR, VALIDATOR) as they're not relevant for QA
                  }
                }

                // Add the current user query only if it's not already the last message in history
                // (to avoid duplicates since we save the message before sending)
                // Note: The saved message might use displayText, so we check if the query is contained in or matches the last message
                const lastMessage = session?.messages?.[session.messages.length - 1];
                const isLastMessageCurrentQuery =
                  lastMessage?.actor === Actors.USER &&
                  (lastMessage.content.trim() === userQuery.trim() ||
                    lastMessage.content.trim().includes(userQuery.trim()) ||
                    userQuery.trim().includes(lastMessage.content.trim()));

                if (!isLastMessageCurrentQuery) {
                  // If we have an image attached to the current query, include it
                  if (imageData) {
                    conversationMessages.push(
                      new HumanMessage({
                        content: [
                          { type: 'text', text: userQuery || 'Please analyze this image.' },
                          {
                            type: 'image_url',
                            image_url: { url: `data:image/jpeg;base64,${imageData}` },
                          },
                        ],
                      }),
                    );
                  } else {
                    conversationMessages.push(new HumanMessage(userQuery));
                  }
                }

                if (qaLLMWithTools) {
                  const toolConversationMessages = [...conversationMessages];
                  let toolCallCount = 0;
                  let thinkingCallCount = 0;
                  let directAnswerText = '';

                  let toolRounds = 0;
                  while (
                    toolRounds < MAX_QA_TOOL_ROUNDS &&
                    (toolCallCount < MAX_QA_TOOL_CALLS || thinkingCallCount < MAX_QA_THINKING_CALLS)
                  ) {
                    toolRounds += 1;
                    const toolResponse = await qaLLMWithTools.invoke(toolConversationMessages, {
                      signal: abortController.signal,
                    });
                    const toolCalls =
                      'tool_calls' in toolResponse && Array.isArray(toolResponse.tool_calls)
                        ? toolResponse.tool_calls
                        : [];

                    if (toolCalls.length === 0) {
                      directAnswerText = getMessageTextContent(toolResponse.content);
                      break;
                    }

                    toolConversationMessages.push(toolResponse);

                    for (const toolCall of toolCalls) {
                      const toolName = 'name' in toolCall ? String(toolCall.name || '') : '';
                      const toolArgs =
                        'args' in toolCall && toolCall.args && typeof toolCall.args === 'object'
                          ? (toolCall.args as Record<string, unknown>)
                          : {};
                      const toolCallId =
                        'id' in toolCall && typeof toolCall.id === 'string' ? toolCall.id : `tool-${Date.now()}`;

                      const isThinkingTool = toolName === 'thinking';
                      const isBuiltInWebTool = toolName === 'web_search' || toolName === 'fetch_url';
                      const mcpToolMeta = mcpToolsByName.get(toolName);

                      if (!isThinkingTool && !isBuiltInWebTool && !mcpToolMeta) {
                        toolConversationMessages.push(
                          new ToolMessage({
                            tool_call_id: toolCallId,
                            content: `Unsupported tool: ${toolName}`,
                          }),
                        );
                        toolCallCount += 1;
                        continue;
                      }

                      let toolResult: string;

                      if (isThinkingTool) {
                        if (thinkingCallCount >= MAX_QA_THINKING_CALLS) {
                          toolConversationMessages.push(
                            new ToolMessage({
                              tool_call_id: toolCallId,
                              content: `You have reached the thinking-step limit (${MAX_QA_THINKING_CALLS}) for this answer. Continue with web or MCP tools if you need facts, then give the user a clear final answer without calling thinking again.`,
                            }),
                          );
                          continue;
                        }
                        thinkingCallCount += 1;
                        toolResult = await thinkingTool.func({
                          thought: String(toolArgs.thought ?? ''),
                        });
                      } else if (isBuiltInWebTool) {
                        if (toolCallCount >= MAX_QA_TOOL_CALLS) {
                          toolConversationMessages.push(
                            new ToolMessage({
                              tool_call_id: toolCallId,
                              content: `Non-thinking tool budget exhausted (${MAX_QA_TOOL_CALLS} per answer). Answer with the context you already have.`,
                            }),
                          );
                          continue;
                        }
                        toolCallCount += 1;
                        toolResult =
                          toolName === 'web_search'
                            ? await webSearchTool.func({
                                query: String(toolArgs.query || ''),
                              })
                            : await fetchUrlTool.func({
                                url: String(toolArgs.url || ''),
                              });
                      } else {
                        if (toolCallCount >= MAX_QA_TOOL_CALLS) {
                          toolConversationMessages.push(
                            new ToolMessage({
                              tool_call_id: toolCallId,
                              content: `Non-thinking tool budget exhausted (${MAX_QA_TOOL_CALLS} per answer). Answer with the context you already have.`,
                            }),
                          );
                          continue;
                        }
                        toolCallCount += 1;
                        const prettyToolName = `mcp:${mcpToolMeta!.server.name}/${mcpToolMeta!.toolName}`;
                        const mcpCallArgs = coerceMcpToolCallArgs(toolArgs);
                        const requestDetail = truncateToolDetail(`Arguments: ${JSON.stringify(mcpCallArgs, null, 2)}`);
                        const toolRunId = crypto.randomUUID();
                        emitQAToolEvent(streamTabConn?.port, {
                          sessionId,
                          tabId,
                          toolName: prettyToolName,
                          kind: 'call',
                          summary: 'Calling MCP…',
                          requestDetail,
                          toolRunId,
                          status: 'pending',
                        });
                        try {
                          const mcpResult = await executeMcpTool(mcpToolMeta!.server, {
                            toolName: mcpToolMeta!.toolName,
                            argumentsInput: mcpCallArgs,
                            signal: abortController.signal,
                          });
                          toolResult = mcpResult.content;
                          emitQAToolEvent(streamTabConn?.port, {
                            sessionId,
                            tabId,
                            toolName: prettyToolName,
                            kind: 'result',
                            summary: 'MCP tool call succeeded',
                            requestDetail,
                            detail: truncateToolDetail(mcpResult.content),
                            toolRunId,
                            status: 'success',
                          });
                        } catch (mcpError) {
                          const errorMessage = mcpError instanceof Error ? mcpError.message : String(mcpError);
                          emitQAToolEvent(streamTabConn?.port, {
                            sessionId,
                            tabId,
                            toolName: prettyToolName,
                            kind: 'result',
                            summary: 'MCP tool call failed',
                            requestDetail,
                            detail: truncateToolDetail(errorMessage),
                            toolRunId,
                            status: 'error',
                          });
                          toolResult = `MCP tool call failed: ${errorMessage}`;
                        }
                      }

                      toolConversationMessages.push(
                        new ToolMessage({
                          tool_call_id: toolCallId,
                          content: toolResult,
                        }),
                      );
                    }
                  }

                  if (directAnswerText.trim()) {
                    const chunks = directAnswerText.match(/[\s\S]{1,120}/g) ?? [directAnswerText];
                    for (const content of chunks) {
                      if (streamTabConn?.port && !abortController.signal.aborted) {
                        streamTabConn.port.postMessage({
                          type: 'qa_response_chunk',
                          sessionId,
                          tabId,
                          content,
                        });
                      }
                    }
                  } else {
                    toolConversationMessages.push(
                      new HumanMessage(
                        'Provide the final answer to the user using the gathered context. Do not call any more tools.',
                      ),
                    );

                    const stream = await qaLLM.stream(toolConversationMessages, { signal: abortController.signal });

                    for await (const chunk of stream) {
                      if (streamTabConn?.port && !abortController.signal.aborted) {
                        const content =
                          typeof chunk.content === 'string' ? chunk.content : getMessageTextContent(chunk.content);
                        if (!content) {
                          continue;
                        }
                        streamTabConn.port.postMessage({
                          type: 'qa_response_chunk',
                          sessionId,
                          tabId,
                          content,
                        });
                      }
                    }
                  }
                } else {
                  const stream = await qaLLM.stream(conversationMessages, { signal: abortController.signal });

                  for await (const chunk of stream) {
                    if (streamTabConn?.port && !abortController.signal.aborted) {
                      const content =
                        typeof chunk.content === 'string' ? chunk.content : getMessageTextContent(chunk.content);
                      if (!content) {
                        continue;
                      }
                      streamTabConn.port.postMessage({
                        type: 'qa_response_chunk',
                        sessionId,
                        tabId,
                        content,
                      });
                    }
                  }
                }

                // 6. Send completion
                if (streamTabConn?.port && !abortController.signal.aborted) {
                  streamTabConn.port.postMessage({
                    type: 'qa_response_complete',
                    sessionId,
                    tabId,
                  });
                }
              } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                  // Stream was cancelled, ignore
                  return;
                }
                const errorMessage = error instanceof Error ? error.message : String(error) || 'Unknown error occurred';

                logger.error('QA query failed:', error);

                if (streamTabConn?.port) {
                  streamTabConn.port.postMessage({
                    type: 'qa_response_error',
                    sessionId,
                    tabId,
                    error: errorMessage,
                  });
                }
              } finally {
                // Only clear the stream reference if this is still the active stream for this tab
                // Check against the current tabConn to avoid clearing if a new stream started
                const currentTabConn = tabConnections.get(tabId);
                if (currentTabConn && currentTabConn.qaStream === abortController) {
                  currentTabConn.qaStream = undefined;
                }
              }
            })();

            break;
          }

          default:
            return port.postMessage({ type: 'error', error: t('errors_cmd_unknown', [message.type]) });
        }
      } catch (error) {
        console.error('Error handling port message:', error);
        port.postMessage({
          type: 'error',
          error: error instanceof Error ? error.message : t('errors_unknown'),
        });
      }
    });

    port.onDisconnect.addListener(() => {
      // this event is also triggered when the side panel is closed, so we need to cancel the task
      console.log('Side panel disconnected');
      if (portTabId) {
        const tabConn = tabConnections.get(portTabId);
        if (tabConn) {
          tabConn.port = undefined;
          tabConn.executor?.cancel();
          tabConn.qaStream?.abort();
        }
      }
    });
  }
});

async function setupExecutor(taskId: string, task: string, browserContext: BrowserContext) {
  const providers = await llmProviderStore.getAllProviders();
  // if no providers, need to display the options page
  if (Object.keys(providers).length === 0) {
    throw new Error(t('bg_setup_noApiKeys'));
  }

  // Clean up any legacy validator settings for backward compatibility
  await agentModelStore.cleanupLegacyValidatorSettings();

  const agentModels = await agentModelStore.getAllAgentModels();
  // verify if every provider used in the agent models exists in the providers
  for (const agentModel of Object.values(agentModels)) {
    if (!providers[agentModel.provider]) {
      throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
    }
  }

  const navigatorModel = agentModels[AgentNameEnum.Navigator];
  if (!navigatorModel) {
    throw new Error(t('bg_setup_noNavigatorModel'));
  }
  // Log the provider config being used for the navigator
  const navigatorProviderConfig = providers[navigatorModel.provider];
  const navigatorLLM = createChatModel(navigatorProviderConfig, navigatorModel);

  let plannerLLM: BaseChatModel | null = null;
  const plannerModel = agentModels[AgentNameEnum.Planner];
  if (plannerModel) {
    // Log the provider config being used for the planner
    const plannerProviderConfig = providers[plannerModel.provider];
    plannerLLM = createChatModel(plannerProviderConfig, plannerModel);
  }

  // Apply firewall settings to browser context
  const firewall = await firewallStore.getFirewall();
  if (firewall.enabled) {
    browserContext.updateConfig({
      allowedUrls: firewall.allowList,
      deniedUrls: firewall.denyList,
    });
  } else {
    browserContext.updateConfig({
      allowedUrls: [],
      deniedUrls: [],
    });
  }

  const generalSettings = await generalSettingsStore.getSettings();
  browserContext.updateConfig({
    minimumWaitPageLoadTime: generalSettings.minWaitPageLoad / 1000.0,
    displayHighlights: generalSettings.displayHighlights,
  });

  const executor = new Executor(task, taskId, browserContext, navigatorLLM, {
    plannerLLM: plannerLLM ?? navigatorLLM,
    agentOptions: {
      maxSteps: generalSettings.maxSteps,
      maxFailures: generalSettings.maxFailures,
      maxActionsPerStep: generalSettings.maxActionsPerStep,
      useVision: generalSettings.useVision,
      useVisionForPlanner: true,
      planningInterval: generalSettings.planningInterval,
    },
    generalSettings: generalSettings,
  });

  return executor;
}

// Update subscribeToExecutorEvents to use port for specific tab
async function subscribeToExecutorEvents(executor: Executor, tabId: number) {
  // Clear previous event listeners to prevent multiple subscriptions
  executor.clearExecutionEvents();

  // Subscribe to new events
  executor.subscribeExecutionEvents(async event => {
    try {
      const tabConn = tabConnections.get(tabId);
      if (tabConn?.port) {
        tabConn.port.postMessage(event);
      }
    } catch (error) {
      logger.error('Failed to send message to side panel:', error);
    }

    if (
      event.state === ExecutionState.TASK_OK ||
      event.state === ExecutionState.TASK_FAIL ||
      event.state === ExecutionState.TASK_CANCEL
    ) {
      const tabConn = tabConnections.get(tabId);
      await tabConn?.executor?.cleanup();
    }
  });
}
