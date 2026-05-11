export enum Actors {
  SYSTEM = 'system',
  USER = 'user',
  PLANNER = 'planner',
  NAVIGATOR = 'navigator',
  VALIDATOR = 'validator',
}

export interface ToolEvent {
  kind: 'call' | 'result';
  toolName: string;
  summary: string;
  detail?: string;
  /** When set (typically on a completed \`result\`), UI shows request + response in one compact block */
  requestDetail?: string;
  status?: 'pending' | 'success' | 'error';
  /** Correlates a pending \`call\` row with the later \`result\` update (same bubble in the side panel) */
  toolRunId?: string;
  /** Provider/LangChain tool call id — pairs with {@link ToolMessage} when reloading QA history */
  modelToolCallId?: string;
  /** Name the model bound for this call (required for MCP replay; may differ from display `toolName`) */
  boundToolName?: string;
  /** Arguments object from the model’s tool call (replay as `AIMessage.tool_calls`) */
  toolArgs?: Record<string, unknown>;
}

export interface Message {
  actor: Actors;
  content: string;
  timestamp: number; // Unix timestamp in milliseconds
  imageData?: string; // Base64 encoded image data for QA mode image capture
  toolEvent?: ToolEvent;
}

export interface ChatMessage extends Message {
  id: string; // Unique ID for each message
}

export interface ChatSessionMetadata {
  id: string;
  title: string;
  createdAt: number; // Unix timestamp in milliseconds
  updatedAt: number; // Unix timestamp in milliseconds
  messageCount: number;
  tabId?: number; // Tab ID associated with this session
}

// ChatSession is the full conversation history displayed in the Sidepanel
export interface ChatSession extends ChatSessionMetadata {
  messages: ChatMessage[];
}

// ChatAgentStepHistory is the history of the every step of the agent
export interface ChatAgentStepHistory {
  task: string;
  history: string;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface ChatHistoryStorage {
  // Get all chat sessions (with empty message arrays for listing)
  getAllSessions: (tabId?: number) => Promise<ChatSession[]>;

  // Clear all chat sessions and messages
  clearAllSessions: () => Promise<void>;

  // Get only session metadata (for efficient listing)
  getSessionsMetadata: (tabId?: number) => Promise<ChatSessionMetadata[]>;

  // Get a specific chat session with its messages
  getSession: (sessionId: string) => Promise<ChatSession | null>;

  // Create a new chat session
  createSession: (title: string, tabId?: number) => Promise<ChatSession>;

  // Update an existing chat session
  updateTitle: (sessionId: string, title: string) => Promise<ChatSessionMetadata>;

  // Delete a chat session
  deleteSession: (sessionId: string) => Promise<void>;

  // Add a message to a chat session
  addMessage: (sessionId: string, message: Message) => Promise<ChatMessage>;

  // Patch an existing message (e.g. QA tool bubble: pending → completed)
  updateMessage: (sessionId: string, messageId: string, patch: Partial<Message>) => Promise<ChatMessage | null>;

  // Delete a message from a chat session
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;

  // Store the history of the agent's state
  storeAgentStepHistory: (sessionId: string, task: string, history: string) => Promise<void>;

  // Load the history of the agent's state
  loadAgentStepHistory: (sessionId: string) => Promise<ChatAgentStepHistory | null>;
}
