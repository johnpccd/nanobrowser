import 'webextension-polyfill';
import {
  agentModelStore,
  AgentNameEnum,
  firewallStore,
  generalSettingsStore,
  llmProviderStore,
  analyticsSettingsStore,
  chatHistoryStore,
} from '@extension/storage';
import { t } from '@extension/i18n';
import BrowserContext from './browser/context';
import { Executor } from './agent/executor';
import { createLogger } from './log';
import { ExecutionState } from './agent/event/types';
import { createChatModel } from './agent/helper';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_AGENT_OPTIONS } from './agent/types';
import { SpeechToTextService } from './services/speechToText';
import { injectBuildDomTreeScripts, getMarkdownContent } from './browser/dom/service';
import { analytics } from './services/analytics';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { Actors } from '@extension/storage/lib/chat/types';

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

// Initialize analytics
analytics.init().catch(error => {
  logger.error('Failed to initialize analytics:', error);
});

// Listen for analytics settings changes
analyticsSettingsStore.subscribe(() => {
  analytics.updateSettings().catch(error => {
    logger.error('Failed to update analytics settings:', error);
  });
});

// Listen for simple messages (e.g., from options page)
chrome.runtime.onMessage.addListener(() => {
  // Handle other message types if needed in the future
  // Return false if response is not sent asynchronously
  // return false;
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

            // Get or create tab connection
            let tabConn = tabConnections.get(tabId);
            if (!tabConn) {
              tabConn = { port, mode: 'qa' };
              tabConnections.set(tabId, tabConn);
            } else {
              tabConn.port = port;
              tabConn.mode = 'qa';
            }

            // Cancel any existing QA stream for this tab
            if (tabConn.qaStream) {
              tabConn.qaStream.abort();
            }

            // Create new abort controller
            const abortController = new AbortController();
            tabConn.qaStream = abortController;

            // Execute QA query asynchronously
            (async () => {
              try {
                // 0. Ensure scripts are injected before getting markdown content
                await injectBuildDomTreeScripts(tabId);

                // 1. Get page markdown content
                const pageContent = await getMarkdownContent(tabId);

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

                // 4. Load chat history for this session and build conversation
                const session = await chatHistoryStore.getSession(sessionId);
                const conversationMessages: (SystemMessage | HumanMessage | AIMessage)[] = [];

                // Add system message with page content
                conversationMessages.push(
                  new SystemMessage(
                    `You are a helpful assistant. Answer questions based on the provided page content. Be concise and accurate.\n\nCurrent page content:\n${pageContent}`,
                  ),
                );

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

                // 5. Stream LLM response
                const stream = await qaLLM.stream(conversationMessages, { signal: abortController.signal });

                // 5. Stream chunks to side panel
                for await (const chunk of stream) {
                  if (tabConn?.port && !abortController.signal.aborted) {
                    const content = typeof chunk.content === 'string' ? chunk.content : String(chunk.content);
                    tabConn.port.postMessage({
                      type: 'qa_response_chunk',
                      sessionId,
                      content,
                    });
                  }
                }

                // 6. Send completion
                if (tabConn?.port && !abortController.signal.aborted) {
                  tabConn.port.postMessage({
                    type: 'qa_response_complete',
                    sessionId,
                  });
                }
              } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                  // Stream was cancelled, ignore
                  return;
                }
                const errorMessage = error instanceof Error ? error.message : String(error) || 'Unknown error occurred';

                logger.error('QA query failed:', error);

                if (tabConn?.port) {
                  tabConn.port.postMessage({
                    type: 'qa_response_error',
                    sessionId,
                    error: errorMessage,
                  });
                }
              } finally {
                if (tabConn) {
                  tabConn.qaStream = undefined;
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
