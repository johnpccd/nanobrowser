/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import {
  type Message,
  Actors,
  chatHistoryStore,
  agentModelStore,
  generalSettingsStore,
  getTabMode,
  setTabMode,
  getTabActiveSession,
  setTabActiveSession,
  type TabMode,
  llmProviderStore,
  AgentNameEnum,
  ProviderTypeEnum,
  llmProviderModelNames,
} from '@extension/storage';
import favoritesStorage, { type FavoritePrompt, favoritesBaseStorage } from '@extension/storage/lib/prompt/favorites';
import { t } from '@extension/i18n';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import BookmarkList from './components/BookmarkList';
import { EventType, type AgentEvent, ExecutionState } from './types/event';
import './SidePanel.css';

// Declare chrome API types
declare global {
  interface Window {
    chrome: typeof chrome;
  }
}

const SidePanel = () => {
  const progressMessage = 'Showing progress...';
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; createdAt: number }>>([]);
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [favoritePrompts, setFavoritePrompts] = useState<FavoritePrompt[]>([]);
  const [hasConfiguredModels, setHasConfiguredModels] = useState<boolean | null>(null); // null = loading, false = no models, true = has models
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayEnabled, setReplayEnabled] = useState(false);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [mode, setMode] = useState<TabMode>('qa');
  const modeRef = useRef<TabMode>('qa');
  const [qaResponseBuffer, setQaResponseBuffer] = useState<string>('');
  const [isQaStreaming, setIsQaStreaming] = useState(false);
  const [isWaitingForQaResponse, setIsWaitingForQaResponse] = useState(false);
  // Image capture state
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCapturingImage, setIsCapturingImage] = useState(false);
  // Page content inclusion state for QA mode
  const [includePageContent, setIncludePageContent] = useState(true);
  // Font size state
  const [fontSize, setFontSize] = useState<number>(14);
  const sessionIdRef = useRef<string | null>(null);
  const isReplayingRef = useRef<boolean>(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const streamingTabIdRef = useRef<number | null>(null);
  const currentTabIdRef = useRef<number | null>(null);
  // Store streaming buffers per tab to preserve content when switching tabs
  const tabBuffersRef = useRef<Map<number, string>>(new Map());
  // Track current buffer value to access it in callbacks without dependency issues
  const qaResponseBufferRef = useRef<string>('');
  const heartbeatIntervalRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  // QA model selection state
  const [availableModels, setAvailableModels] = useState<
    Array<{ provider: string; providerName: string; model: string; displayName: string }>
  >([]);
  const [currentQAModel, setCurrentQAModel] = useState<string>('');
  const [openRouterModels, setOpenRouterModels] = useState<Array<{ id: string; name: string }>>([]);

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

  // Check if models are configured
  const checkModelConfiguration = useCallback(async () => {
    try {
      const configuredAgents = await agentModelStore.getConfiguredAgents();

      // Check if at least one agent (preferably Navigator) is configured
      const hasAtLeastOneModel = configuredAgents.length > 0;
      setHasConfiguredModels(hasAtLeastOneModel);
    } catch (error) {
      console.error('Error checking model configuration:', error);
      setHasConfiguredModels(false);
    }
  }, []);

  // Load general settings to check if replay is enabled and page content inclusion
  const loadGeneralSettings = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      setReplayEnabled(settings.replayHistoricalTasks);
      setIncludePageContent(settings.includePageContent);
      setFontSize(settings.fontSize);
    } catch (error) {
      console.error('Error loading general settings:', error);
      setReplayEnabled(false);
      setIncludePageContent(true);
      setFontSize(14);
    }
  }, []);

  // Load current tab and its state
  const loadCurrentTabState = useCallback(async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      // Save current buffer for the previous tab before switching
      const previousTabId = currentTabIdRef.current;
      if (previousTabId !== null && previousTabId !== tabId) {
        tabBuffersRef.current.set(previousTabId, qaResponseBufferRef.current);
      }

      // Restore buffer for the new tab, or clear if none exists
      const savedBuffer = tabBuffersRef.current.get(tabId) || '';
      setQaResponseBuffer(savedBuffer);
      qaResponseBufferRef.current = savedBuffer;

      // Update streaming state based on whether we have a saved buffer
      setIsQaStreaming(savedBuffer.length > 0);
      setIsWaitingForQaResponse(false);
      setShowStopButton(savedBuffer.length > 0);

      setCurrentTabId(tabId);
      currentTabIdRef.current = tabId;

      // Load mode for this tab
      const tabMode = await getTabMode(tabId);
      setMode(tabMode);
      modeRef.current = tabMode;

      // Load chat sessions for this tab
      const sessions = await chatHistoryStore.getSessionsMetadata(tabId);
      setChatSessions(sessions);

      // Load active session for this tab
      const activeSessionId = await getTabActiveSession(tabId);
      if (activeSessionId) {
        const session = await chatHistoryStore.getSession(activeSessionId);
        if (session) {
          setCurrentSessionId(activeSessionId);
          sessionIdRef.current = activeSessionId;
          setMessages(session.messages);
          setIsHistoricalSession(false);
        }
      } else {
        // No active session, clear messages
        setCurrentSessionId(null);
        sessionIdRef.current = null;
        setMessages([]);
        // Reset follow-up mode when there's no active session
        setIsFollowUpMode(false);
        // For new tabs/sessions in QA mode, enable page content by default
        if (tabMode === 'qa') {
          setIncludePageContent(true);
        }
      }
    } catch (error) {
      console.error('Error loading tab state:', error);
    }
  }, []);

  // Save current tab's active session
  const saveCurrentTabActiveSession = useCallback(
    async (sessionId: string | null) => {
      if (currentTabId) {
        await setTabActiveSession(currentTabId, sessionId);
      }
    },
    [currentTabId],
  );

  // Handle mode change
  const handleModeChange = useCallback(
    async (newMode: TabMode) => {
      if (!currentTabId) return;
      setMode(newMode);
      modeRef.current = newMode;
      await setTabMode(currentTabId, newMode);
      // Clear current session when switching modes
      if (currentSessionId) {
        setCurrentSessionId(null);
        sessionIdRef.current = null;
        setMessages([]);
        await saveCurrentTabActiveSession(null);
      }
      // For new sessions in QA mode, enable page content by default
      if (newMode === 'qa' && !currentSessionId) {
        setIncludePageContent(true);
      }
    },
    [currentTabId, currentSessionId, saveCurrentTabActiveSession],
  );

  // Fetch OpenRouter models from API
  const fetchOpenRouterModels = useCallback(async (apiKey: string) => {
    if (!apiKey) {
      setOpenRouterModels([]);
      return;
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      const models = data.data
        .map((model: { id: string; name?: string }) => ({
          id: model.id,
          name: model.name || model.id,
        }))
        .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));

      setOpenRouterModels(models);
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error);
      setOpenRouterModels([]);
    }
  }, []);

  // Load available models for QA mode
  const loadAvailableModels = useCallback(async () => {
    const models: Array<{ provider: string; providerName: string; model: string; displayName: string }> = [];

    try {
      const storedProviders = await llmProviderStore.getAllProviders();

      for (const [provider, config] of Object.entries(storedProviders)) {
        if (config.type === ProviderTypeEnum.AzureOpenAI) {
          const deploymentNames = config.azureDeploymentNames || [];
          models.push(
            ...deploymentNames.map(deployment => ({
              provider,
              providerName: config.name || provider,
              model: deployment,
              displayName: `${config.name || provider}: ${deployment}`,
            })),
          );
        } else if (config.type === ProviderTypeEnum.OpenRouter) {
          if (openRouterModels.length > 0) {
            models.push(
              ...openRouterModels.map(model => ({
                provider,
                providerName: config.name || provider,
                model: model.id,
                displayName: model.name || model.id,
              })),
            );
          }
        } else {
          const providerModels =
            config.modelNames || llmProviderModelNames[provider as keyof typeof llmProviderModelNames] || [];
          models.push(
            ...providerModels.map(model => ({
              provider,
              providerName: config.name || provider,
              model,
              displayName: `${config.name || provider}: ${model}`,
            })),
          );
        }
      }
    } catch (error) {
      console.error('Error loading available models:', error);
    }

    setAvailableModels(models);
  }, [openRouterModels]);

  // Load current QA model
  const loadCurrentQAModel = useCallback(async () => {
    try {
      const qaModel = await agentModelStore.getAgentModel(AgentNameEnum.QA);
      if (qaModel) {
        setCurrentQAModel(`${qaModel.provider}>${qaModel.modelName}`);
      } else {
        setCurrentQAModel('');
      }
    } catch (error) {
      console.error('Error loading current QA model:', error);
      setCurrentQAModel('');
    }
  }, []);

  // Handle QA model change
  const handleQAModelChange = useCallback(
    async (provider: string, model: string) => {
      try {
        const providers = await llmProviderStore.getAllProviders();
        const providerConfig = providers[provider];
        if (!providerConfig) {
          throw new Error(`Provider ${provider} not found`);
        }

        await agentModelStore.setAgentModel(AgentNameEnum.QA, {
          provider,
          modelName: model,
          parameters: {},
        });

        setCurrentQAModel(`${provider}>${model}`);
        // Reload the current QA model to ensure it's up to date
        await loadCurrentQAModel();
      } catch (error) {
        console.error('Error updating QA model:', error);
      }
    },
    [loadCurrentQAModel],
  );

  // Fetch OpenRouter models when providers are loaded
  useEffect(() => {
    const fetchOpenRouterData = async () => {
      try {
        const providers = await llmProviderStore.getAllProviders();
        const openRouterProvider = Object.entries(providers).find(
          ([, config]) => config.type === ProviderTypeEnum.OpenRouter && config.apiKey,
        );

        if (openRouterProvider) {
          const [, config] = openRouterProvider;
          if (config.apiKey) {
            await fetchOpenRouterModels(config.apiKey);
          }
        }
      } catch (error) {
        console.error('Error checking for OpenRouter provider:', error);
      }
    };

    fetchOpenRouterData();
  }, [fetchOpenRouterModels]);

  // Load available models when OpenRouter models are loaded or providers change
  useEffect(() => {
    loadAvailableModels();
  }, [loadAvailableModels]);

  // Load current QA model on mount
  useEffect(() => {
    loadCurrentQAModel();
  }, [loadCurrentQAModel]);

  // Check model configuration on mount
  useEffect(() => {
    checkModelConfiguration();
    loadGeneralSettings();
    loadCurrentTabState();
  }, [checkModelConfiguration, loadGeneralSettings, loadCurrentTabState]);

  // Listen for tab changes
  useEffect(() => {
    const handleTabActivated = async (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (activeInfo.tabId) {
        await loadCurrentTabState();
      }
    };

    const handleTabUpdated = async (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === 'complete' && tabId === currentTabId) {
        await loadCurrentTabState();
      }
    };

    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, [currentTabId, loadCurrentTabState]);

  // Re-check model configuration when the side panel becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Panel became visible, re-check configuration and settings
        checkModelConfiguration();
        loadGeneralSettings();
      }
    };

    const handleFocus = () => {
      // Panel gained focus, re-check configuration and settings
      checkModelConfiguration();
      loadGeneralSettings();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfiguration, loadGeneralSettings]);

  // Subscribe to general settings changes for immediate updates
  useEffect(() => {
    const unsubscribe = generalSettingsStore.subscribe(async () => {
      await loadGeneralSettings();
    });

    return () => {
      unsubscribe();
    };
  }, [loadGeneralSettings]);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    isReplayingRef.current = isReplaying;
  }, [isReplaying]);

  const appendMessage = useCallback((newMessage: Message, sessionId?: string | null) => {
    // Don't save progress messages
    const isProgressMessage = newMessage.content === progressMessage;

    setMessages(prev => {
      const filteredMessages = prev.filter((msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1));
      return [...filteredMessages, newMessage];
    });

    // Use provided sessionId if available, otherwise fall back to sessionIdRef.current
    const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;

    console.log('sessionId', effectiveSessionId);

    // Save message to storage if we have a session and it's not a progress message
    if (effectiveSessionId && !isProgressMessage) {
      chatHistoryStore
        .addMessage(effectiveSessionId, newMessage)
        .catch(err => console.error('Failed to save message to history:', err));
    }
  }, []);

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      const content = data?.details;
      let skip = true;
      let displayProgress = false;

      switch (actor) {
        case Actors.SYSTEM:
          switch (state) {
            case ExecutionState.TASK_START:
              // Reset historical session flag when a new task starts
              setIsHistoricalSession(false);
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              skip = false;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              setIsReplaying(false);
              skip = false;
              break;
            case ExecutionState.TASK_PAUSE:
              break;
            case ExecutionState.TASK_RESUME:
              break;
            default:
              console.error('Invalid task state', state);
              return;
          }
          break;
        case Actors.USER:
          break;
        case Actors.PLANNER:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            case ExecutionState.STEP_CANCEL:
              break;
            default:
              console.error('Invalid step state', state);
              return;
          }
          break;
        case Actors.NAVIGATOR:
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              displayProgress = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              displayProgress = false;
              break;
            case ExecutionState.STEP_CANCEL:
              displayProgress = false;
              break;
            case ExecutionState.ACT_START:
              if (content !== 'cache_content') {
                // skip to display caching content
                skip = false;
              }
              break;
            case ExecutionState.ACT_OK:
              skip = !isReplayingRef.current;
              break;
            case ExecutionState.ACT_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid action', state);
              return;
          }
          break;
        case Actors.VALIDATOR:
          // Handle legacy validator events from historical messages
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid validation', state);
              return;
          }
          break;
        default:
          console.error('Unknown actor', actor);
          return;
      }

      if (!skip) {
        appendMessage({
          actor,
          content: content || '',
          timestamp: timestamp,
        });
      }

      if (displayProgress) {
        appendMessage({
          actor,
          content: progressMessage,
          timestamp: timestamp,
        });
      }
    },
    [appendMessage],
  );

  // Stop heartbeat and close connection
  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  // Setup connection management
  const setupConnection = useCallback(() => {
    // Only setup if no existing connection
    if (portRef.current) {
      return;
    }

    try {
      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });

      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      portRef.current.onMessage.addListener((message: any) => {
        // Add type checking for message
        if (message && message.type === EventType.EXECUTION) {
          handleTaskState(message);
        } else if (message && message.type === 'error') {
          // Handle error messages from service worker
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'qa_response_chunk') {
          // Handle streaming QA response chunks - just accumulate in buffer
          // Only process chunks for the currently active tab and session
          if (
            message.sessionId === sessionIdRef.current &&
            message.tabId === currentTabIdRef.current &&
            message.tabId === streamingTabIdRef.current
          ) {
            const chunk = message.content || '';
            // Only clear waiting state when we get actual content
            if (chunk.trim() !== '') {
              setIsWaitingForQaResponse(false); // First chunk with content received
            }
            setIsQaStreaming(true);
            setQaResponseBuffer(prev => {
              const newBuffer = prev + chunk;
              qaResponseBufferRef.current = newBuffer;
              // Also update the per-tab buffer storage
              if (message.tabId !== null && message.tabId !== undefined) {
                tabBuffersRef.current.set(message.tabId, newBuffer);
              }
              return newBuffer;
            });
          }
        } else if (message && message.type === 'qa_response_complete') {
          // QA response complete - now add final message to messages array
          // Only process completion for the currently active tab and session
          if (
            message.sessionId === sessionIdRef.current &&
            message.tabId === currentTabIdRef.current &&
            message.tabId === streamingTabIdRef.current
          ) {
            // Get the accumulated content and add as a message
            setQaResponseBuffer(prev => {
              if (prev) {
                // Add the final message to messages array
                appendMessage(
                  {
                    actor: Actors.SYSTEM,
                    content: prev,
                    timestamp: Date.now(),
                  },
                  sessionIdRef.current,
                );
              }
              // Clear buffer from per-tab storage as well
              if (message.tabId !== null && message.tabId !== undefined) {
                tabBuffersRef.current.delete(message.tabId);
              }
              qaResponseBufferRef.current = '';
              return ''; // Clear buffer
            });
            setIsWaitingForQaResponse(false);
            setIsQaStreaming(false);
            setInputEnabled(true);
            setShowStopButton(false);
            streamingTabIdRef.current = null; // Clear streaming tab tracking
            // Enable follow-up mode so next message continues the same session
            setIsFollowUpMode(true);
            // Focus textarea after streaming completes in QA mode
            if (modeRef.current === 'qa' && textareaRef.current) {
              setTimeout(() => {
                textareaRef.current?.focus();
              }, 0);
            }
          }
        } else if (message && message.type === 'qa_response_error') {
          // QA response error
          // Only process error for the currently active tab and session
          if (
            message.sessionId === sessionIdRef.current &&
            message.tabId === currentTabIdRef.current &&
            message.tabId === streamingTabIdRef.current
          ) {
            appendMessage(
              {
                actor: Actors.SYSTEM,
                content: `Error: ${message.error || 'Unknown error'}`,
                timestamp: Date.now(),
              },
              sessionIdRef.current,
            );
            setQaResponseBuffer('');
            qaResponseBufferRef.current = '';
            // Clear buffer from per-tab storage as well
            if (message.tabId !== null && message.tabId !== undefined) {
              tabBuffersRef.current.delete(message.tabId);
            }
            setIsWaitingForQaResponse(false);
            setIsQaStreaming(false);
            setInputEnabled(true);
            setShowStopButton(false);
            streamingTabIdRef.current = null; // Clear streaming tab tracking
            // Enable follow-up mode so next message continues the same session
            setIsFollowUpMode(true);
            // Focus textarea after error in QA mode
            if (modeRef.current === 'qa' && textareaRef.current) {
              setTimeout(() => {
                textareaRef.current?.focus();
              }, 0);
            }
          }
        } else if (message && message.type === 'speech_to_text_result') {
          // Handle speech-to-text result
          if (message.text && setInputTextRef.current) {
            setInputTextRef.current(message.text);
          }
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'speech_to_text_error') {
          // Handle speech-to-text error
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('chat_stt_recognitionFailed'),
            timestamp: Date.now(),
          });
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'heartbeat_ack') {
          console.log('Heartbeat acknowledged');
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('Connection disconnected', error ? `Error: ${error.message}` : '');
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setIsWaitingForQaResponse(false);
        setIsQaStreaming(false);
        setQaResponseBuffer('');
        setInputEnabled(true);
        setShowStopButton(false);
      });

      // Setup heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            stopConnection(); // Stop connection if heartbeat fails
          }
        } else {
          stopConnection(); // Stop if port is invalid
        }
      }, 25000);
    } catch (error) {
      console.error('Failed to establish connection:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_conn_serviceWorker'),
        timestamp: Date.now(),
      });
      // Clear any references since connection failed
      portRef.current = null;
    }
  }, [handleTaskState, appendMessage, stopConnection]);

  // Add safety check for message sending
  const sendMessage = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to send message:', error);
        stopConnection(); // Stop connection when message sending fails
        throw error;
      }
    },
    [stopConnection],
  );

  // Handle replay command
  const handleReplay = async (historySessionId: string): Promise<void> => {
    try {
      // Check if replay is enabled in settings
      if (!replayEnabled) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_disabled'),
          timestamp: Date.now(),
        });
        return;
      }

      // Check if history exists using loadAgentStepHistory
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      if (!historyData) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_noHistory', historySessionId.substring(0, 20)),
          timestamp: Date.now(),
        });
        return;
      }

      // Get current tab ID
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Clear messages if we're in a historical session
      if (isHistoricalSession) {
        setMessages([]);
      }

      // Create a new chat session for this replay task
      const newSession = await chatHistoryStore.createSession(
        `Replay of ${historySessionId.substring(0, 20)}...`,
        tabId,
      );
      console.log('newSession for replay', newSession);

      // Store the new session ID in both state and ref
      const newTaskId = newSession.id;
      setCurrentSessionId(newTaskId);
      sessionIdRef.current = newTaskId;

      // Send replay command to background
      setInputEnabled(false);
      setShowStopButton(true);

      // Reset follow-up mode and historical session flags
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);

      const userMessage = {
        actor: Actors.USER,
        content: `/replay ${historySessionId}`,
        timestamp: Date.now(),
      };

      // Add the user message to the new session
      appendMessage(userMessage, sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send replay command to background with the task from history
      portRef.current?.postMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId: tabId,
        historySessionId: historySessionId,
        task: historyData.task, // Add the task from history
      });

      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_starting', historyData.task),
        timestamp: Date.now(),
      });
      setIsReplaying(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_failed', errorMessage),
        timestamp: Date.now(),
      });
    }
  };

  // Handle chat commands that start with /
  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Handle different commands
      if (command === '/state') {
        portRef.current?.postMessage({
          type: 'state',
        });
        return true;
      }

      if (command === '/nohighlight') {
        portRef.current?.postMessage({
          type: 'nohighlight',
        });
        return true;
      }

      if (command.startsWith('/replay ')) {
        // Parse replay command: /replay <historySessionId>
        // Handle multiple spaces by filtering out empty strings
        const parts = command.split(' ').filter(part => part.trim() !== '');
        if (parts.length !== 2) {
          appendMessage({
            actor: Actors.SYSTEM,
            content: t('chat_replay_invalidArgs'),
            timestamp: Date.now(),
          });
          return true;
        }

        const historySessionId = parts[1];
        await handleReplay(historySessionId);
        return true;
      }

      // Unsupported command
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_cmd_unknown', command),
        timestamp: Date.now(),
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Command error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      return true;
    }
  };

  const handleSendMessage = async (text: string, displayText?: string, imageData?: string) => {
    console.log('handleSendMessage', text, imageData ? '(with image)' : '');

    // Trim the input text first
    const trimmedText = text.trim();

    if (!trimmedText && !imageData) return;

    // Check if the input is a command (starts with /)
    if (trimmedText.startsWith('/')) {
      // Process command and return if it was handled
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return;
    }

    // Block sending messages in historical sessions
    if (isHistoricalSession) {
      console.log('Cannot send messages in historical sessions');
      return;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Show stop button but keep input enabled so users can prepare next message
      setShowStopButton(true);

      // Create a new chat session for this task if not in follow-up mode
      // For QA mode, always ensure we have a session (create if missing)
      if (!isFollowUpMode || (mode === 'qa' && !sessionIdRef.current)) {
        // Use display text for session title if available, otherwise use full text
        const titleText = displayText || text;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
          tabId,
        );
        console.log('newSession', newSession);

        // Store the session ID in both state and ref
        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
        await saveCurrentTabActiveSession(sessionId);
      }

      const userMessage = {
        actor: Actors.USER,
        content: displayText || text, // Use display text for chat UI, full text for background service
        timestamp: Date.now(),
      };

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send message using the utility function
      if (mode === 'qa') {
        // QA mode - send QA query
        // Ensure we have a session ID before sending
        if (!sessionIdRef.current) {
          throw new Error('No session ID available for QA query');
        }

        // IMPORTANT: Save the message to storage BEFORE sending the query
        // This ensures the message is available when we load chat history
        // Include image reference in stored message if image was attached
        const messageToStore = imageData
          ? { ...userMessage, imageData } // Store image data with the message
          : userMessage;
        await chatHistoryStore.addMessage(sessionIdRef.current, messageToStore);

        // Update UI state directly (don't use appendMessage as it would save again)
        setMessages(prev => [...prev, imageData ? { ...userMessage, imageData } : userMessage]);

        // Clear captured image after sending
        setCapturedImage(null);

        // Clear buffer for this tab when starting a new query
        tabBuffersRef.current.delete(tabId);
        setQaResponseBuffer(''); // Clear buffer
        qaResponseBufferRef.current = '';
        setIsQaStreaming(false);
        setIsWaitingForQaResponse(true); // Show loading indicator
        streamingTabIdRef.current = tabId; // Track which tab is streaming
        await sendMessage({
          type: 'qa_query',
          query: text,
          sessionId: sessionIdRef.current,
          tabId,
          imageData, // Include image in the message to background
          includePageContent, // Whether to include page content in the query
        });
        console.log(
          'qa_query sent',
          text,
          tabId,
          sessionIdRef.current,
          imageData ? '(with image)' : '',
          includePageContent ? '(with page content)' : '(generic chat)',
        );
      } else if (isFollowUpMode) {
        // Send as follow-up task
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('follow_up_task sent', text, tabId, sessionIdRef.current);
      } else {
        // Send as new task
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('new_task sent', text, tabId, sessionIdRef.current);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      if (mode === 'qa') {
        setIsWaitingForQaResponse(false);
        setIsQaStreaming(false);
        setQaResponseBuffer('');
        qaResponseBufferRef.current = '';
        // Clear buffer from per-tab storage
        if (currentTabIdRef.current !== null) {
          tabBuffersRef.current.delete(currentTabIdRef.current);
        }
        streamingTabIdRef.current = null; // Clear streaming tab tracking
      }
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  const handleStopTask = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }
      portRef.current?.postMessage({
        type: 'cancel_task',
        tabId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('cancel_task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
    }
    setIsWaitingForQaResponse(false);
    setIsQaStreaming(false);
    setQaResponseBuffer('');
    qaResponseBufferRef.current = '';
    // Clear buffer from per-tab storage
    if (currentTabIdRef.current !== null) {
      tabBuffersRef.current.delete(currentTabIdRef.current);
    }
    streamingTabIdRef.current = null; // Clear streaming tab tracking
    setInputEnabled(true);
    setShowStopButton(false);
  };

  const handleNewChat = async () => {
    // Clear messages and start a new chat
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setInputEnabled(true);
    setShowStopButton(false);
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);
    setQaResponseBuffer('');
    setIsWaitingForQaResponse(false);

    // Set mode to QA for new chats
    if (currentTabId) {
      setMode('qa');
      modeRef.current = 'qa';
      await setTabMode(currentTabId, 'qa');
    }

    // Enable page content by default for new chats in QA mode
    setIncludePageContent(true);

    // Clear active session for current tab
    await saveCurrentTabActiveSession(null);

    // Disconnect any existing connection
    stopConnection();
  };

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata(currentTabId || undefined);
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  }, []);

  const handleLoadHistory = async () => {
    await loadChatSessions();
    setShowHistory(true);
  };

  const handleBackToChat = (reset = false) => {
    setShowHistory(false);
    if (reset) {
      setCurrentSessionId(null);
      setMessages([]);
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (fullSession && fullSession.messages.length > 0) {
        setCurrentSessionId(fullSession.id);
        setMessages(fullSession.messages);
        setIsFollowUpMode(false);
        setIsHistoricalSession(true); // Mark this as a historical session
        console.log('history session selected', sessionId);
      }
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const handleSessionDelete = async (sessionId: string) => {
    try {
      await chatHistoryStore.deleteSession(sessionId);
      await loadChatSessions();
      if (sessionId === currentSessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleSessionBookmark = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);

      if (fullSession && fullSession.messages.length > 0) {
        // Get the session title
        const sessionTitle = fullSession.title;
        // Get the first 8 words of the title
        const title = sessionTitle.split(' ').slice(0, 8).join(' ');

        // Get the first message content (the task)
        const taskContent = fullSession.messages[0]?.content || '';

        // Add to favorites storage
        await favoritesStorage.addPrompt(title, taskContent);

        // Update favorites in the UI
        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);

        // Return to chat view after pinning
        handleBackToChat(true);
      }
    } catch (error) {
      console.error('Failed to pin session to favorites:', error);
    }
  };

  const handleBookmarkSelect = (content: string) => {
    // Automatically send the message instead of just pasting it
    handleSendMessage(content);
  };

  const handleBookmarkUpdateTitle = async (id: number, title: string) => {
    try {
      await favoritesStorage.updatePromptTitle(id, title);

      // Update favorites in the UI
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('Failed to update favorite prompt title:', error);
    }
  };

  const handleBookmarkDelete = async (id: number) => {
    try {
      await favoritesStorage.removePrompt(id);

      // Update favorites in the UI
      const prompts = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(prompts);
    } catch (error) {
      console.error('Failed to delete favorite prompt:', error);
    }
  };

  const handleBookmarkReorder = async (draggedId: number, targetId: number) => {
    try {
      // Directly pass IDs to storage function - it now handles the reordering logic
      await favoritesStorage.reorderPrompts(draggedId, targetId);

      // Fetch the updated list from storage to get the new IDs and reflect the authoritative order
      const updatedPromptsFromStorage = await favoritesStorage.getAllPrompts();
      setFavoritePrompts(updatedPromptsFromStorage);
    } catch (error) {
      console.error('Failed to reorder favorite prompts:', error);
    }
  };

  // Load favorite prompts from storage and subscribe to changes
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const prompts = await favoritesStorage.getAllPrompts();
        setFavoritePrompts(prompts);
      } catch (error) {
        console.error('Failed to load favorite prompts:', error);
      }
    };

    loadFavorites();

    // Subscribe to storage changes for real-time updates
    const unsubscribe = favoritesBaseStorage.subscribe(async () => {
      await loadFavorites();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop recording if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear recording timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopConnection();
    };
  }, [stopConnection]);

  // Scroll to bottom when new messages arrive or when streaming content updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, qaResponseBuffer]);

  // Handle image capture from the current page
  const handleCaptureImage = useCallback(async (): Promise<string | null> => {
    if (isCapturingImage) return null;

    try {
      setIsCapturingImage(true);

      // Get current tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Request screenshot from background service
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Screenshot capture timed out'));
        }, 10000);

        // Create a one-time message listener for the screenshot response
        const handleScreenshotResponse = (message: { type: string; screenshot?: string; error?: string }) => {
          if (message.type === 'screenshot_result') {
            clearTimeout(timeout);
            if (message.screenshot) {
              setCapturedImage(message.screenshot);
              resolve(message.screenshot);
            } else {
              reject(new Error(message.error || 'Failed to capture screenshot'));
            }
          }
        };

        // Store the listener so we can remove it later
        const port = portRef.current;
        if (port) {
          port.onMessage.addListener(handleScreenshotResponse);

          // Send screenshot request
          port.postMessage({
            type: 'capture_screenshot',
            tabId,
          });

          // Clean up listener after response
          setTimeout(() => {
            try {
              port.onMessage.removeListener(handleScreenshotResponse);
            } catch {
              // Port might be disconnected
            }
          }, 10000);
        } else {
          clearTimeout(timeout);
          reject(new Error('No connection available'));
        }
      });
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_imageCapture_failed'),
        timestamp: Date.now(),
      });
      return null;
    } finally {
      setIsCapturingImage(false);
    }
  }, [isCapturingImage, setupConnection, appendMessage]);

  // Handle removing captured image
  const handleRemoveCapturedImage = useCallback(() => {
    setCapturedImage(null);
  }, []);

  // Handle toggling page content inclusion for QA mode
  const handleToggleIncludePageContent = useCallback(async () => {
    const newValue = !includePageContent;
    setIncludePageContent(newValue);
    try {
      await generalSettingsStore.updateSettings({ includePageContent: newValue });
    } catch (error) {
      console.error('Error updating includePageContent setting:', error);
      // Revert on error
      setIncludePageContent(!newValue);
    }
  }, [includePageContent]);

  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear the timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // First check if permission is already granted
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_stt_microphone_permissionDenied'),
          timestamp: Date.now(),
        });
        return;
      }

      // If permission is not granted, open permission page
      if (permissionStatus.state !== 'granted') {
        const permissionUrl = chrome.runtime.getURL('permission/index.html');

        // Open permission page in a new window
        chrome.windows.create(
          {
            url: permissionUrl,
            type: 'popup',
            width: 500,
            height: 600,
          },
          createdWindow => {
            if (createdWindow?.id) {
              // Listen for window close to check permission status
              chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
                if (windowId === createdWindow.id) {
                  chrome.windows.onRemoved.removeListener(onWindowClose);
                  // Check permission status after window closes
                  setTimeout(async () => {
                    try {
                      const newPermissionStatus = await navigator.permissions.query({
                        name: 'microphone' as PermissionName,
                      });
                      // Only retry if permission was granted
                      if (newPermissionStatus.state === 'granted') {
                        handleMicClick();
                      }
                      // If denied or prompt, do nothing - let user manually try again
                    } catch (error) {
                      console.error('Failed to check permission status:', error);
                    }
                  }, 500);
                }
              });
            }
          },
        );
        return;
      }

      // Permission granted - proceed with recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Clear previous audio chunks
      audioChunksRef.current = [];

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Handle data available event
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle stop event
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0) {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result as string;

            // Setup connection if not exists
            if (!portRef.current) {
              setupConnection();
            }

            // Send audio to backend for speech-to-text conversion
            try {
              setIsProcessingSpeech(true);
              portRef.current?.postMessage({
                type: 'speech_to_text',
                audio: base64Audio,
              });
            } catch (error) {
              console.error('Failed to send audio for speech-to-text:', error);
              appendMessage({
                actor: Actors.SYSTEM,
                content: t('chat_stt_processingFailed'),
                timestamp: Date.now(),
              });
              setIsRecording(false);
              setIsProcessingSpeech(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      // Set up 2-minute duration limit
      const maxDuration = 2 * 60 * 1000;
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsProcessingSpeech(true);
        recordingTimerRef.current = null;
      }, maxDuration);

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);

      let errorMessage = t('chat_stt_microphone_accessFailed');
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage += t('chat_stt_microphone_grantPermission');
        } else if (error.name === 'NotFoundError') {
          errorMessage += t('chat_stt_microphone_notFound');
        } else {
          errorMessage += error.message;
        }
      }

      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setIsRecording(false);
    }
  };

  return (
    <div>
      <div
        className={`flex h-screen flex-col ${isDarkMode ? 'bg-slate-900' : "bg-[url('/bg.jpg')] bg-cover bg-no-repeat"} overflow-hidden border ${isDarkMode ? 'border-sky-800' : 'border-[rgb(186,230,253)]'} rounded-2xl`}>
        <header className="header relative">
          <div className="header-logo">
            {showHistory ? (
              <button
                type="button"
                onClick={() => handleBackToChat(false)}
                className={`${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
                aria-label={t('nav_back_a11y')}>
                {t('nav_back')}
              </button>
            ) : (
              <img src="/icon-128.png" alt="Extension Logo" className="size-6" />
            )}
          </div>
          <div className="header-icons">
            {!showHistory && (
              <>
                <select
                  value={mode}
                  onChange={e => handleModeChange(e.target.value as TabMode)}
                  className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300 bg-slate-800' : 'text-sky-400 hover:text-sky-500 bg-white'} cursor-pointer border-0 rounded px-2 py-1 text-sm`}
                  aria-label="Select mode">
                  <option value="automation">Automation Agent</option>
                  <option value="qa">QA Mode</option>
                </select>
                <button
                  type="button"
                  onClick={handleNewChat}
                  onKeyDown={e => e.key === 'Enter' && handleNewChat()}
                  className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
                  aria-label={t('nav_newChat_a11y')}
                  tabIndex={0}>
                  <PiPlusBold size={20} />
                </button>
                <button
                  type="button"
                  onClick={handleLoadHistory}
                  onKeyDown={e => e.key === 'Enter' && handleLoadHistory()}
                  className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
                  aria-label={t('nav_loadHistory_a11y')}
                  tabIndex={0}>
                  <GrHistory size={20} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              onKeyDown={e => e.key === 'Enter' && chrome.runtime.openOptionsPage()}
              className={`header-icon ${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-400 hover:text-sky-500'} cursor-pointer`}
              aria-label={t('nav_settings_a11y')}
              tabIndex={0}>
              <FiSettings size={20} />
            </button>
          </div>
        </header>
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
              visible={true}
              isDarkMode={isDarkMode}
            />
          </div>
        ) : (
          <>
            {/* Show loading state while checking model configuration */}
            {hasConfiguredModels === null && (
              <div
                className={`flex flex-1 items-center justify-center p-8 ${isDarkMode ? 'text-sky-300' : 'text-sky-600'}`}>
                <div className="text-center">
                  <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"></div>
                  <p>{t('status_checkingConfig')}</p>
                </div>
              </div>
            )}

            {/* Show setup message when no models are configured */}
            {hasConfiguredModels === false && (
              <div
                className={`flex flex-1 items-center justify-center p-8 ${isDarkMode ? 'text-sky-300' : 'text-sky-600'}`}>
                <div className="max-w-md text-center">
                  <img src="/icon-128.png" alt="Nanobrowser Logo" className="mx-auto mb-4 size-12" />
                  <h3 className={`mb-2 text-lg font-semibold ${isDarkMode ? 'text-sky-200' : 'text-sky-700'}`}>
                    {t('welcome_title')}
                  </h3>
                  <p className="mb-4">{t('welcome_instruction')}</p>
                  <button
                    onClick={() => chrome.runtime.openOptionsPage()}
                    className={`my-4 rounded-lg px-4 py-2 font-medium transition-colors ${
                      isDarkMode ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-sky-500 text-white hover:bg-sky-600'
                    }`}>
                    {t('welcome_openSettings')}
                  </button>
                  <div className="mt-4 text-sm opacity-75">
                    <a
                      href="https://github.com/nanobrowser/nanobrowser?tab=readme-ov-file#-quick-start"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-700 hover:text-sky-600'}`}>
                      {t('welcome_quickStart')}
                    </a>
                    <span className="mx-2">•</span>
                    <a
                      href="https://discord.gg/NN3ABHggMK"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${isDarkMode ? 'text-sky-400 hover:text-sky-300' : 'text-sky-700 hover:text-sky-600'}`}>
                      {t('welcome_joinCommunity')}
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Show normal chat interface when models are configured */}
            {hasConfiguredModels === true && (
              <>
                {messages.length === 0 && (
                  <>
                    <div
                      className={`border-t ${isDarkMode ? 'border-sky-900' : 'border-sky-100'} mb-2 p-2 shadow-sm backdrop-blur-sm`}>
                      <ChatInput
                        onSendMessage={handleSendMessage}
                        onStopTask={handleStopTask}
                        onMicClick={handleMicClick}
                        isRecording={isRecording}
                        isProcessingSpeech={isProcessingSpeech}
                        disabled={!inputEnabled || isHistoricalSession}
                        showStopButton={showStopButton}
                        setContent={setter => {
                          setInputTextRef.current = setter;
                        }}
                        isDarkMode={isDarkMode}
                        historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                        onReplay={handleReplay}
                        isQAMode={mode === 'qa'}
                        availableModels={availableModels}
                        currentQAModel={currentQAModel}
                        onQAModelChange={handleQAModelChange}
                        setTextareaRef={ref => {
                          textareaRef.current = ref;
                        }}
                        onCaptureImage={mode === 'qa' ? handleCaptureImage : undefined}
                        capturedImage={capturedImage}
                        onRemoveCapturedImage={handleRemoveCapturedImage}
                        isCapturingImage={isCapturingImage}
                        includePageContent={includePageContent}
                        onToggleIncludePageContent={mode === 'qa' ? handleToggleIncludePageContent : undefined}
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <BookmarkList
                        bookmarks={favoritePrompts}
                        onBookmarkSelect={handleBookmarkSelect}
                        onBookmarkUpdateTitle={handleBookmarkUpdateTitle}
                        onBookmarkDelete={handleBookmarkDelete}
                        onBookmarkReorder={handleBookmarkReorder}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                  </>
                )}
                {(messages.length > 0 || isQaStreaming || isWaitingForQaResponse) && (
                  <div
                    className={`scrollbar-gutter-stable flex-1 overflow-x-hidden overflow-y-scroll scroll-smooth p-2 ${isDarkMode ? 'bg-slate-900/80' : ''}`}>
                    <MessageList
                      messages={messages}
                      isDarkMode={isDarkMode}
                      streamingContent={isQaStreaming ? qaResponseBuffer : undefined}
                      isWaitingForResponse={isWaitingForQaResponse}
                      fontSize={fontSize}
                    />
                    <div ref={messagesEndRef} />
                  </div>
                )}
                {messages.length > 0 && (
                  <div
                    className={`border-t ${isDarkMode ? 'border-sky-900' : 'border-sky-100'} p-2 shadow-sm backdrop-blur-sm`}>
                    <ChatInput
                      onSendMessage={handleSendMessage}
                      onStopTask={handleStopTask}
                      onMicClick={handleMicClick}
                      isRecording={isRecording}
                      isProcessingSpeech={isProcessingSpeech}
                      disabled={!inputEnabled || isHistoricalSession}
                      showStopButton={showStopButton}
                      setContent={setter => {
                        setInputTextRef.current = setter;
                      }}
                      isDarkMode={isDarkMode}
                      historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                      onReplay={handleReplay}
                      isQAMode={mode === 'qa'}
                      availableModels={availableModels}
                      currentQAModel={currentQAModel}
                      onQAModelChange={handleQAModelChange}
                      setTextareaRef={ref => {
                        textareaRef.current = ref;
                      }}
                      onCaptureImage={mode === 'qa' ? handleCaptureImage : undefined}
                      capturedImage={capturedImage}
                      onRemoveCapturedImage={handleRemoveCapturedImage}
                      isCapturingImage={isCapturingImage}
                      includePageContent={includePageContent}
                      onToggleIncludePageContent={mode === 'qa' ? handleToggleIncludePageContent : undefined}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
