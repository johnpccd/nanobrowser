import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import type { ResolvedQaUiTheme } from '@extension/storage';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { HiOutlineCamera, HiOutlineDocumentText, HiOutlineChat } from 'react-icons/hi';
import { FiPaperclip, FiTool } from 'react-icons/fi';
import { t } from '@extension/i18n';

interface ModelOption {
  provider: string;
  providerName: string;
  model: string;
  displayName: string;
}

interface PersonaOption {
  id: string;
  name: string;
}

/** First-party QA tools managed in MCP options (thinking, web_search, fetch_url). */
export type QaBuiltinToolToggleId = 'thinking' | 'web_search' | 'fetch_url';

export interface QaBuiltinToolPanelRow {
  id: QaBuiltinToolToggleId;
  /** Setting from General / MCP Options (toggle state). */
  prefEnabled: boolean;
  /** Whether the background actually exposes this tool (e.g. SearXNG required for web tools). */
  exposesToModel: boolean;
}

/** MCP tool toggle panel for QA chat (built-ins + remote MCP discovery + enable flags). */
export interface QaMcpToolsPanelState {
  loading: boolean;
  error: string | null;
  builtins: QaBuiltinToolPanelRow[];
  servers: Array<{
    id: string;
    name: string;
    endpoint: string;
    tools: { name: string; enabled: boolean }[];
    error?: string;
  }>;
}

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string, imageDataList?: string[]) => void;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: Dispatch<SetStateAction<string>>) => void;
  isDarkMode?: boolean;
  // Historical session ID - if provided, shows replay button instead of send button
  historicalSessionId?: string | null;
  onReplay?: (sessionId: string) => void;
  // QA mode model selection
  isQAMode?: boolean;
  availableModels?: ModelOption[];
  currentQAModel?: string;
  onQAModelChange?: (provider: string, model: string) => void;
  personas?: PersonaOption[];
  currentPersonaId?: string;
  onPersonaChange?: (personaId: string) => void;
  // Expose textarea ref for focus management
  setTextareaRef?: (ref: HTMLTextAreaElement | null) => void;
  // Image capture — supports multiple screenshots per message.
  onCaptureImage?: () => Promise<string | null>;
  capturedImages?: string[];
  /** Pass an index to remove a single screenshot; omit to clear all. */
  onRemoveCapturedImage?: (index?: number) => void;
  isCapturingImage?: boolean;
  // Page content toggle for QA mode (current tab vs generic chat)
  includePageContent?: boolean;
  onToggleIncludePageContent?: () => void;
  qaUiTheme?: ResolvedQaUiTheme | null;
  /** Number of QA tools/slots currently bound (built-in + MCP); null while loading. */
  qaEnabledToolCount?: number | null;
  onOpenQaToolSettings?: () => void;
  qaMcpToolsPanel?: QaMcpToolsPanelState | null;
  qaMcpToolsMenuOpen?: boolean;
  onQaMcpToolsMenuOpenChange?: (open: boolean) => void;
  onToggleQaMcpTool?: (payload: {
    serverId: string;
    toolName: string;
    nextEnabled: boolean;
    discoveredNames: string[];
  }) => void;
  onToggleQaBuiltinTool?: (id: QaBuiltinToolToggleId, nextEnabled: boolean) => void;
  /** When true (e.g. Azure Foundry agent selected), QA tools menu is disabled. */
  qaToolsDisabled?: boolean;
}

// File attachment interface
interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

function qaBuiltinToolDescription(id: QaBuiltinToolToggleId): string {
  switch (id) {
    case 'thinking':
      return t('chat_mcpTools_builtin_desc_thinking');
    case 'web_search':
      return t('chat_mcpTools_builtin_desc_webSearch');
    case 'fetch_url':
      return t('chat_mcpTools_builtin_desc_fetchUrl');
    default:
      return '';
  }
}

const QA_SELECT_MIN_MODEL_PX = 56;
const QA_SELECT_MIN_PERSONA_PX = 48;
const QA_SELECT_CHROME_PX = 30;

function measureSelectLabelPx(el: HTMLElement, label: string): number {
  const style = getComputedStyle(el);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return QA_SELECT_MIN_MODEL_PX;
  }
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return Math.ceil(ctx.measureText(label).width) + QA_SELECT_CHROME_PX;
}

/** Sizes QA model/persona selects to fit labels when space allows; shrinks proportionally when narrow. */
function useQaToolbarSelectWidths(
  containerRef: RefObject<HTMLDivElement | null>,
  modelSelectRef: RefObject<HTMLSelectElement | null>,
  personaSelectRef: RefObject<HTMLSelectElement | null>,
  modelLabel: string,
  personaLabel: string,
  hasPersona: boolean,
  enabled: boolean,
): { modelWidthPx?: number; personaWidthPx?: number } {
  const [widths, setWidths] = useState<{ modelWidthPx?: number; personaWidthPx?: number }>({});

  useLayoutEffect(() => {
    if (!enabled) {
      setWidths({});
      return;
    }

    const container = containerRef.current;
    const modelEl = modelSelectRef.current;
    if (!container || !modelEl) {
      return;
    }

    const update = () => {
      const growWidth = container.clientWidth;
      if (growWidth <= 0) {
        return;
      }

      const modelContent = Math.max(measureSelectLabelPx(modelEl, modelLabel), QA_SELECT_MIN_MODEL_PX);
      const personaEl = personaSelectRef.current;

      if (!hasPersona || !personaEl) {
        setWidths({ modelWidthPx: Math.min(modelContent, growWidth), personaWidthPx: undefined });
        return;
      }

      const personaContent = Math.max(measureSelectLabelPx(personaEl, personaLabel), QA_SELECT_MIN_PERSONA_PX);
      const gap = 4;
      const totalIdeal = modelContent + personaContent + gap;

      if (totalIdeal <= growWidth) {
        setWidths({ modelWidthPx: modelContent, personaWidthPx: personaContent });
        return;
      }

      const modelRatio = modelContent / (modelContent + personaContent);
      let modelW = Math.max(QA_SELECT_MIN_MODEL_PX, Math.floor((growWidth - gap) * modelRatio));
      let personaW = growWidth - gap - modelW;
      if (personaW < QA_SELECT_MIN_PERSONA_PX) {
        personaW = QA_SELECT_MIN_PERSONA_PX;
        modelW = Math.max(QA_SELECT_MIN_MODEL_PX, growWidth - gap - personaW);
      }
      setWidths({ modelWidthPx: modelW, personaWidthPx: personaW });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, modelSelectRef, personaSelectRef, modelLabel, personaLabel, hasPersona, enabled]);

  return widths;
}

/** Compact control for QA toolbar icons (attach, mic, page toggle, capture, tools). */
function toolbarIconButtonClass(
  isDarkMode: boolean,
  disabled: boolean,
  variant: 'neutral' | 'active' = 'neutral',
  size: 'icon' | 'badge' = 'icon',
): string {
  const sizing = size === 'icon' ? 'size-8' : 'h-8 min-w-8 w-auto gap-0.5 px-1.5';
  const base = `flex shrink-0 items-center justify-center rounded-lg border transition-colors ${sizing}`;
  if (disabled) {
    return `${base} cursor-not-allowed opacity-50`;
  }
  if (variant === 'active') {
    return `${base} ${
      isDarkMode
        ? 'border-sky-600 bg-sky-700 text-white hover:bg-sky-600'
        : 'border-sky-300 bg-sky-100 text-sky-700 hover:bg-sky-200'
    }`;
  }
  return `${base} ${
    isDarkMode
      ? 'border-[#3d3d52] bg-[#2a2a3a] text-[#c8c8d4] hover:border-[#5a5a72] hover:bg-[#32324a]'
      : 'border-gray-300 bg-gray-50 text-gray-700 hover:border-gray-400 hover:bg-gray-100'
  }`;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
  historicalSessionId,
  onReplay,
  isQAMode = false,
  availableModels = [],
  currentQAModel,
  onQAModelChange,
  personas = [],
  currentPersonaId,
  onPersonaChange,
  setTextareaRef,
  onCaptureImage,
  capturedImages = [],
  onRemoveCapturedImage,
  isCapturingImage = false,
  includePageContent = true,
  onToggleIncludePageContent,
  qaUiTheme = null,
  qaEnabledToolCount,
  onOpenQaToolSettings,
  qaMcpToolsPanel = null,
  qaMcpToolsMenuOpen = false,
  onQaMcpToolsMenuOpenChange,
  onToggleQaMcpTool,
  onToggleQaBuiltinTool,
  qaToolsDisabled = false,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const hasCapturedImages = capturedImages.length > 0;
  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0 && !hasCapturedImages),
    [disabled, text, attachedFiles, hasCapturedImages],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qaMcpMenuAnchorRef = useRef<HTMLDivElement>(null);
  const qaMcpMenuPopoverRef = useRef<HTMLDivElement>(null);
  const qaSelectsGrowRef = useRef<HTMLDivElement>(null);
  const qaModelSelectRef = useRef<HTMLSelectElement>(null);
  const qaPersonaSelectRef = useRef<HTMLSelectElement>(null);

  /** Fixed geometry for portaled MCP menu (escapes overflow-hidden + paints above header). */
  const [mcpMenuFixedStyle, setMcpMenuFixedStyle] = useState<CSSProperties | null>(null);

  const selectedModelLabel = useMemo(() => {
    if (!currentQAModel) {
      return 'Select model...';
    }
    const [provider, model] = currentQAModel.split('>');
    return availableModels.find(m => m.provider === provider && m.model === model)?.displayName ?? currentQAModel;
  }, [currentQAModel, availableModels]);

  const selectedPersonaLabel = useMemo(
    () => personas.find(p => p.id === currentPersonaId)?.name ?? '',
    [personas, currentPersonaId],
  );

  const hasQaPersonaSelect = personas.length > 0 && Boolean(onPersonaChange);
  const qaSelectWidths = useQaToolbarSelectWidths(
    qaSelectsGrowRef,
    qaModelSelectRef,
    qaPersonaSelectRef,
    selectedModelLabel,
    selectedPersonaLabel,
    hasQaPersonaSelect,
    isQAMode && availableModels.length > 0,
  );

  const qaSelectClass = (disabledSelect: boolean) =>
    `max-w-full shrink-0 rounded-md px-1.5 py-1 text-[11px] transition-colors ${
      disabledSelect
        ? 'cursor-not-allowed opacity-50'
        : isDarkMode
          ? 'border border-slate-600 bg-slate-700 text-gray-200 hover:bg-slate-600'
          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
    }`;

  // Handle text changes and resize textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    // Resize textarea
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  };

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  // Expose textarea ref for focus management
  useEffect(() => {
    if (setTextareaRef) {
      setTextareaRef(textareaRef.current);
    }
  }, [setTextareaRef]);

  // Initial resize when component mounts
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedText = text.trim();

      if (trimmedText || attachedFiles.length > 0 || hasCapturedImages) {
        let messageContent = trimmedText;
        let displayContent = trimmedText;

        // Security: Clearly separate user input from file content
        // The background service will sanitize file content using guardrails
        if (attachedFiles.length > 0) {
          const fileContents = attachedFiles
            .map(file => {
              // Tag file content for background service to identify and sanitize
              return `\n\n<nano_file_content type="file" name="${file.name}">\n${file.content}\n</nano_file_content>`;
            })
            .join('\n');

          // Combine user message with tagged file content (for background service)
          messageContent = trimmedText
            ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
            : `<nano_attached_files>${fileContents}</nano_attached_files>`;

          // Create display version with only filenames (for UI)
          const fileList = attachedFiles.map(file => `📎 ${file.name}`).join('\n');
          displayContent = trimmedText ? `${trimmedText}\n\n${fileList}` : fileList;
        }

        // Add image indicator(s) to display content if screenshots are attached.
        if (hasCapturedImages) {
          const indicator =
            capturedImages.length === 1
              ? `📷 ${t('chat_imageCapture_attached')}`
              : `📷 ${t('chat_imageCapture_attached')} (${capturedImages.length})`;
          displayContent = displayContent ? `${displayContent}\n\n${indicator}` : indicator;
        }

        onSendMessage(messageContent, displayContent, hasCapturedImages ? [...capturedImages] : undefined);
        setText('');
        setAttachedFiles([]);
        // Clear captured images after sending
        if (hasCapturedImages && onRemoveCapturedImage) {
          onRemoveCapturedImage();
        }

        // In QA mode, keep focus on textarea after submission
        if (isQAMode && textareaRef.current && !disabled) {
          // Use setTimeout to ensure focus happens after state updates
          setTimeout(() => {
            textareaRef.current?.focus();
          }, 0);
        }
      }
    },
    [text, attachedFiles, capturedImages, hasCapturedImages, onSendMessage, isQAMode, disabled, onRemoveCapturedImage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const handleReplay = useCallback(() => {
    if (historicalSessionId && onReplay) {
      onReplay(historicalSessionId);
    }
  }, [historicalSessionId, onReplay]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: AttachedFile[] = [];
    const allowedTypes = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.xml', '.yaml', '.yml'];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();

      // Check if file type is allowed
      if (!allowedTypes.includes(fileExt)) {
        console.warn(`File type ${fileExt} not supported. Only text-based files are allowed.`);
        continue;
      }

      // Check file size (limit to 1MB)
      if (file.size > 1024 * 1024) {
        console.warn(`File ${file.name} is too large. Maximum size is 1MB.`);
        continue;
      }

      try {
        const content = await file.text();
        newFiles.push({
          name: file.name,
          content,
          type: file.type || 'text/plain',
        });
      } catch (error) {
        console.error(`Error reading file ${file.name}:`, error);
      }
    }

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Imperatively open a full-size preview for a captured screenshot.
   * Kept imperative (matches the previous single-image implementation) so it doesn't pull a portal
   * dependency into the composer.
   */
  const openImagePreview = useCallback((image: string) => {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-50 flex items-center justify-center';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const dismiss = () => {
      window.removeEventListener('keydown', onBackdropKey);
      root.remove();
    };
    const onBackdropKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onBackdropKey);
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'absolute inset-0 border-0 bg-black/80 p-0';
    backdrop.setAttribute('aria-label', t('chat_imageCapture_closeModal'));
    backdrop.onclick = dismiss;
    const inner = document.createElement('div');
    inner.className = 'relative z-10 max-h-[90vh] max-w-[90vw]';
    inner.onclick = e => e.stopPropagation();
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${image}`;
    img.alt = t('chat_imageCapture_fullImage');
    img.className = 'max-h-[90vh] max-w-[90vw] object-contain rounded-lg';
    inner.appendChild(img);
    root.appendChild(backdrop);
    root.appendChild(inner);
    document.body.appendChild(root);
  }, []);

  const formStyle: CSSProperties = {
    ...(qaUiTheme?.inputBorder ? { borderColor: qaUiTheme.inputBorder } : {}),
  };

  const textareaStyle: CSSProperties = {
    fontSize: qaUiTheme ? `${qaUiTheme.inputFontSizePx}px` : undefined,
    ...(qaUiTheme?.inputSurface ? { backgroundColor: qaUiTheme.inputSurface } : {}),
    ...(qaUiTheme?.inputText ? { color: qaUiTheme.inputText } : {}),
  };

  const toolbarStyle: CSSProperties = {
    ...(qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : {}),
    ...(qaUiTheme?.inputSurface ? { backgroundColor: qaUiTheme.inputSurface } : {}),
  };

  const neutralControlStyle: CSSProperties = {
    ...(qaUiTheme?.inputSurface ? { backgroundColor: qaUiTheme.inputSurface } : {}),
    ...(qaUiTheme?.inputBorder ? { borderColor: qaUiTheme.inputBorder } : {}),
    ...(qaUiTheme?.inputText ? { color: qaUiTheme.inputText } : {}),
    ...(qaUiTheme?.chromeFontSizePx ? { fontSize: `${Math.max(qaUiTheme.chromeFontSizePx - 1, 11)}px` } : {}),
  };

  const accentControlStyle: CSSProperties = {
    ...(qaUiTheme?.accentColor ? { backgroundColor: qaUiTheme.accentColor } : {}),
    ...(qaUiTheme?.inputBorder ? { borderColor: qaUiTheme.inputBorder } : {}),
    ...(qaUiTheme?.inputText ? { color: qaUiTheme.inputText } : {}),
    ...(qaUiTheme?.chromeFontSizePx ? { fontSize: `${Math.max(qaUiTheme.chromeFontSizePx - 1, 11)}px` } : {}),
  };

  /** “ON” treatment for QA toolbar toggles (e.g. include page content) so active state reads clearly. */
  const toggleOnControlStyle = accentControlStyle;

  useLayoutEffect(() => {
    if (!qaMcpToolsMenuOpen) {
      setMcpMenuFixedStyle(null);
      return;
    }

    const updatePosition = () => {
      const anchor = qaMcpMenuAnchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 8;
      const maxW = Math.min(vw - 16, 22 * 16);
      const left = Math.max(8, Math.min(rect.left, vw - maxW - 8));
      /** Prior max was 18rem; ~double scroll area while staying within viewport above the anchor. */
      const maxPreferredPx = 36 * 16;
      const availAbove = Math.max(rect.top - gap - 12, 120);
      const maxMenuPx = Math.min(maxPreferredPx, availAbove);
      setMcpMenuFixedStyle({
        position: 'fixed',
        left,
        bottom: vh - rect.top + gap,
        zIndex: 2147483647,
        minWidth: 18 * 16,
        maxWidth: maxW,
        width: maxW,
        maxHeight: `${maxMenuPx}px`,
        display: 'flex',
        flexDirection: 'column',
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [qaMcpToolsMenuOpen]);

  useEffect(() => {
    if (!qaMcpToolsMenuOpen || !onQaMcpToolsMenuOpenChange) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onQaMcpToolsMenuOpenChange(false);
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (qaMcpMenuAnchorRef.current?.contains(t) || qaMcpMenuPopoverRef.current?.contains(t)) {
        return;
      }
      onQaMcpToolsMenuOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [qaMcpToolsMenuOpen, onQaMcpToolsMenuOpenChange]);

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-xl border transition-colors ${disabled ? 'cursor-not-allowed' : ''} ${
        qaUiTheme?.inputBorder
          ? ''
          : isDarkMode
            ? 'border-[#333344] focus-within:border-[#4d4d60] hover:border-[#4d4d60]'
            : 'focus-within:border-sky-400 hover:border-sky-400'
      }`}
      style={formStyle}
      aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        {/* File attachments and captured image display */}
        {(attachedFiles.length > 0 || hasCapturedImages) && (
          <div
            className={`flex flex-wrap gap-2 border-b p-2 ${
              qaUiTheme?.inputSurface ? '' : isDarkMode ? 'border-[#333344] bg-[#1a1a24]' : 'border-gray-200 bg-gray-50'
            }`}
            style={
              qaUiTheme?.inputSurface
                ? { backgroundColor: qaUiTheme.inputSurface, borderBottomColor: qaUiTheme.inputBorder }
                : undefined
            }>
            {/* Captured screenshot previews — one chip per image so the user can review/remove each. */}
            {capturedImages.map((image, index) => (
              <div
                key={`captured-${index}-${image.length}`}
                className={`relative flex items-center gap-1 rounded-md p-1 ${
                  isDarkMode ? 'bg-slate-700' : 'bg-gray-200'
                }`}>
                <button
                  type="button"
                  className="cursor-pointer rounded p-0 transition-opacity hover:opacity-80"
                  aria-label={t('chat_imageCapture_viewFull')}
                  onClick={() => openImagePreview(image)}>
                  <img
                    src={`data:image/jpeg;base64,${image}`}
                    alt=""
                    className="pointer-events-none h-12 w-auto max-w-[100px] rounded object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveCapturedImage?.(index)}
                  className={`absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full text-xs ${
                    isDarkMode
                      ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  aria-label={t('chat_imageCapture_remove')}>
                  ✕
                </button>
              </div>
            ))}
            {/* File attachments */}
            {attachedFiles.map((file, index) => (
              <div
                key={index}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                  isDarkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                }`}>
                <span className="text-xs">📎</span>
                <span className="max-w-[150px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(index)}
                  className={`ml-1 rounded-sm transition-colors ${
                    isDarkMode ? 'hover:bg-slate-600' : 'hover:bg-gray-300'
                  }`}
                  aria-label={`Remove ${file.name}`}>
                  <span className="text-xs">✕</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-disabled={disabled}
          rows={5}
          className={`w-full resize-none border-none p-2 focus:outline-none ${
            qaUiTheme?.inputSurface || qaUiTheme?.inputText
              ? disabled
                ? 'cursor-not-allowed opacity-70'
                : ''
              : disabled
                ? isDarkMode
                  ? 'cursor-not-allowed bg-[#1a1a24] text-[#6b6b7e]'
                  : 'cursor-not-allowed bg-gray-100 text-gray-500'
                : isDarkMode
                  ? 'bg-[#252535] text-[#d1d1d1] placeholder:text-[#6b6b7e]'
                  : 'bg-white'
          }`}
          style={textareaStyle}
          placeholder={attachedFiles.length > 0 ? 'Add a message (optional)...' : t('chat_input_placeholder')}
          aria-label={t('chat_input_editor')}
        />

        <div
          className={`flex min-w-0 items-center gap-1 px-2 py-1.5 ${
            qaUiTheme?.inputSurface
              ? ''
              : disabled
                ? isDarkMode
                  ? 'bg-[#1a1a24]'
                  : 'bg-gray-100'
                : isDarkMode
                  ? 'bg-[#252535]'
                  : 'bg-white'
          }`}
          style={toolbarStyle}>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-gray-500">
            {/* File attachment — distinct control so updates are obvious after rebuild */}
            <button
              type="button"
              onClick={handleFileSelect}
              disabled={disabled}
              aria-label={t('chat_attach_files_tooltip')}
              title={t('chat_attach_files_tooltip')}
              className={
                isQAMode
                  ? toolbarIconButtonClass(isDarkMode, disabled)
                  : `flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      disabled
                        ? 'cursor-not-allowed opacity-50'
                        : isDarkMode
                          ? 'border-[#3d3d52] bg-[#2a2a3a] text-[#c8c8d4] hover:border-[#5a5a72] hover:bg-[#32324a]'
                          : 'border-gray-300 bg-gray-50 text-gray-700 hover:border-gray-400 hover:bg-gray-100'
                    }`
              }
              style={
                qaUiTheme?.inputBorder || qaUiTheme?.inputSurface
                  ? {
                      ...(qaUiTheme.inputBorder ? { borderColor: qaUiTheme.inputBorder } : {}),
                      ...(qaUiTheme.inputSurface ? { backgroundColor: `${qaUiTheme.inputSurface}ee` } : {}),
                      ...(qaUiTheme.inputText ? { color: qaUiTheme.inputText } : {}),
                    }
                  : undefined
              }>
              <FiPaperclip className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
              {!isQAMode && (
                <span className="max-w-[4.5rem] truncate sm:max-w-none">{t('chat_attach_files_button')}</span>
              )}
            </button>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />

            {onMicClick && (
              <>
                <button
                  type="button"
                  onClick={onMicClick}
                  disabled={disabled || isProcessingSpeech}
                  aria-label={
                    isProcessingSpeech
                      ? t('chat_stt_processing')
                      : isRecording
                        ? t('chat_stt_recording_stop')
                        : t('chat_stt_input_start')
                  }
                  title={
                    isProcessingSpeech
                      ? t('chat_stt_processing')
                      : isRecording
                        ? t('chat_stt_recording_stop')
                        : t('chat_stt_input_start')
                  }
                  className={
                    isRecording
                      ? `flex size-8 shrink-0 items-center justify-center rounded-lg border border-red-600 bg-red-500 text-white transition-colors hover:bg-red-600 ${
                          disabled || isProcessingSpeech ? 'cursor-not-allowed opacity-50' : ''
                        }`
                      : toolbarIconButtonClass(isDarkMode, disabled || isProcessingSpeech)
                  }
                  style={isRecording ? undefined : neutralControlStyle}>
                  {isProcessingSpeech ? (
                    <AiOutlineLoading3Quarters className="size-4 animate-spin" />
                  ) : (
                    <FaMicrophone className={`size-4 ${isRecording ? 'animate-pulse' : ''}`} />
                  )}
                </button>
                {isQAMode && availableModels.length > 0 && onQAModelChange && (
                  <>
                    <div
                      ref={qaSelectsGrowRef}
                      data-qa-growable
                      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                      <select
                        ref={qaModelSelectRef}
                        value={currentQAModel || ''}
                        onChange={e => {
                          const value = e.target.value;
                          if (value) {
                            const [provider, model] = value.split('>');
                            if (provider && model) {
                              onQAModelChange(provider, model);
                            }
                          }
                        }}
                        disabled={disabled}
                        title={selectedModelLabel}
                        className={qaSelectClass(disabled)}
                        style={{
                          ...neutralControlStyle,
                          ...(qaSelectWidths.modelWidthPx != null
                            ? { width: `${qaSelectWidths.modelWidthPx}px` }
                            : { minWidth: `${QA_SELECT_MIN_MODEL_PX}px` }),
                        }}
                        aria-label="Select QA model">
                        {!currentQAModel && (
                          <option value="" disabled>
                            Select model...
                          </option>
                        )}
                        {availableModels.map(option => {
                          const value = `${option.provider}>${option.model}`;
                          return (
                            <option key={value} value={value}>
                              {option.displayName}
                            </option>
                          );
                        })}
                      </select>
                      {hasQaPersonaSelect && (
                        <select
                          ref={qaPersonaSelectRef}
                          value={currentPersonaId || ''}
                          onChange={e => onPersonaChange!(e.target.value)}
                          disabled={disabled}
                          title={selectedPersonaLabel}
                          className={qaSelectClass(disabled)}
                          style={{
                            ...neutralControlStyle,
                            ...(qaSelectWidths.personaWidthPx != null
                              ? { width: `${qaSelectWidths.personaWidthPx}px` }
                              : { minWidth: `${QA_SELECT_MIN_PERSONA_PX}px` }),
                          }}
                          aria-label="Select QA persona">
                          {personas.map(persona => (
                            <option key={persona.id} value={persona.id}>
                              {persona.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {/* Page content (current tab) vs generic chat */}
                    {onToggleIncludePageContent && (
                      <button
                        type="button"
                        onClick={onToggleIncludePageContent}
                        disabled={disabled}
                        aria-label={t('chat_pageContent_toggle')}
                        title={
                          includePageContent
                            ? t('chat_pageContent_tooltip_enabled')
                            : t('chat_pageContent_tooltip_disabled')
                        }
                        className={toolbarIconButtonClass(
                          isDarkMode,
                          disabled,
                          includePageContent ? 'active' : 'neutral',
                        )}
                        style={includePageContent ? toggleOnControlStyle : neutralControlStyle}>
                        {includePageContent ? (
                          <HiOutlineDocumentText className="size-4" aria-hidden />
                        ) : (
                          <HiOutlineChat className="size-4" aria-hidden />
                        )}
                      </button>
                    )}
                    {/* Image Capture button */}
                    {onCaptureImage && (
                      <button
                        type="button"
                        onClick={onCaptureImage}
                        disabled={disabled || isCapturingImage}
                        aria-label={t('chat_imageCapture_button')}
                        title={t('chat_imageCapture_tooltip')}
                        className={toolbarIconButtonClass(isDarkMode, disabled || isCapturingImage)}
                        style={neutralControlStyle}>
                        {isCapturingImage ? (
                          <AiOutlineLoading3Quarters className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <HiOutlineCamera className="size-4" aria-hidden />
                        )}
                      </button>
                    )}
                    {onOpenQaToolSettings &&
                      qaMcpToolsPanel &&
                      onQaMcpToolsMenuOpenChange &&
                      onToggleQaMcpTool &&
                      onToggleQaBuiltinTool && (
                        <>
                          <div className="inline-flex shrink-0" ref={qaMcpMenuAnchorRef}>
                            <button
                              type="button"
                              onClick={() => {
                                if (disabled || qaToolsDisabled) return;
                                onQaMcpToolsMenuOpenChange(!qaMcpToolsMenuOpen);
                              }}
                              disabled={disabled || qaToolsDisabled}
                              aria-expanded={qaMcpToolsMenuOpen}
                              aria-haspopup="dialog"
                              aria-label={
                                qaToolsDisabled
                                  ? t('chat_qaTools_disabledFoundry')
                                  : qaEnabledToolCount != null
                                    ? t('chat_qaTools_tooltip', [String(qaEnabledToolCount)])
                                    : t('chat_qaTools_button')
                              }
                              title={
                                qaToolsDisabled
                                  ? t('chat_qaTools_disabledFoundry')
                                  : qaEnabledToolCount != null
                                    ? t('chat_qaTools_tooltip', [String(qaEnabledToolCount)])
                                    : t('chat_qaTools_button')
                              }
                              className={toolbarIconButtonClass(
                                isDarkMode,
                                disabled || qaToolsDisabled,
                                qaMcpToolsMenuOpen ? 'active' : 'neutral',
                                'badge',
                              )}
                              style={
                                qaUiTheme?.inputBorder || qaUiTheme?.inputSurface
                                  ? {
                                      ...(qaUiTheme.inputBorder
                                        ? {
                                            borderColor: qaMcpToolsMenuOpen
                                              ? qaUiTheme.accentColor
                                              : qaUiTheme.inputBorder,
                                          }
                                        : {}),
                                      ...(qaUiTheme.inputSurface
                                        ? { backgroundColor: `${qaUiTheme.inputSurface}ee` }
                                        : {}),
                                      ...(qaUiTheme.inputText ? { color: qaUiTheme.inputText } : {}),
                                    }
                                  : undefined
                              }>
                              <FiTool className="size-4 shrink-0" aria-hidden />
                              <span
                                className={`min-w-[1.15rem] rounded-full px-1 py-px text-center text-[10px] font-semibold tabular-nums leading-tight ${
                                  isDarkMode ? 'bg-sky-700 text-white' : 'bg-sky-600 text-white'
                                }`}>
                                {qaEnabledToolCount != null ? qaEnabledToolCount : t('chat_qaTools_countLoading')}
                              </span>
                            </button>
                          </div>
                          {qaMcpToolsMenuOpen &&
                            !qaToolsDisabled &&
                            mcpMenuFixedStyle &&
                            createPortal(
                              <div
                                ref={qaMcpMenuPopoverRef}
                                role="dialog"
                                aria-label={t('chat_mcpTools_menu_title')}
                                className={`rounded-lg border text-left shadow-xl ${
                                  isDarkMode
                                    ? 'border-slate-600 bg-slate-800 text-gray-100'
                                    : 'border-gray-200 bg-white text-gray-900'
                                }`}
                                style={{
                                  ...mcpMenuFixedStyle,
                                  ...(qaUiTheme?.inputBorder
                                    ? {
                                        borderColor: qaUiTheme.inputBorder,
                                        backgroundColor: qaUiTheme.inputSurface ?? undefined,
                                      }
                                    : {}),
                                }}>
                                <div className="border-b border-inherit px-3 py-2 text-xs font-semibold">
                                  {t('chat_mcpTools_menu_title')}
                                </div>
                                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
                                  <div>
                                    <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                                      {t('chat_mcpTools_builtins_heading')}
                                    </p>
                                    <ul className="space-y-0.5">
                                      {(qaMcpToolsPanel.builtins ?? []).map(row => (
                                        <li key={row.id}>
                                          <label
                                            className={`flex cursor-pointer flex-col gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-black/10 ${isDarkMode ? 'hover:bg-white/10' : ''}`}>
                                            <span className="flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                checked={row.prefEnabled}
                                                disabled={disabled}
                                                onChange={e => onToggleQaBuiltinTool(row.id, e.target.checked)}
                                                className="rounded border-gray-400"
                                              />
                                              <span className="font-mono text-[11px]">{row.id}</span>
                                            </span>
                                            <span
                                              className={`pl-6 text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                                              {qaBuiltinToolDescription(row.id)}
                                            </span>
                                          </label>
                                          {row.prefEnabled && !row.exposesToModel ? (
                                            <p
                                              className={`ml-6 mt-0.5 text-[10px] ${isDarkMode ? 'text-amber-300/95' : 'text-amber-800'}`}>
                                              {t('chat_mcpTools_builtin_needsSearxng')}
                                            </p>
                                          ) : null}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className={`border-t border-inherit pt-2 ${isDarkMode ? '' : ''}`}>
                                    <p className="mb-1 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                                      {t('chat_mcpTools_mcpServers_heading')}
                                      {qaMcpToolsPanel.loading ? (
                                        <AiOutlineLoading3Quarters
                                          className="size-3 shrink-0 animate-spin"
                                          aria-hidden
                                        />
                                      ) : null}
                                    </p>
                                    {qaMcpToolsPanel.error ? (
                                      <p
                                        className={`mb-2 p-1 text-xs ${isDarkMode ? 'text-rose-300' : 'text-rose-600'}`}>
                                        {qaMcpToolsPanel.error}
                                      </p>
                                    ) : null}

                                    {!qaMcpToolsPanel.loading &&
                                      !qaMcpToolsPanel.error &&
                                      qaMcpToolsPanel.servers.length === 0 && (
                                        <p className="p-1 text-xs text-gray-400">{t('chat_mcpTools_noMcpServers')}</p>
                                      )}
                                    {qaMcpToolsPanel.servers.map(server => (
                                      <div key={server.id} className="mb-3 last:mb-0">
                                        <p className="break-all px-1 font-mono text-[11px] font-semibold">
                                          {server.name}
                                        </p>
                                        {server.error && (
                                          <p
                                            className={`mt-0.5 px-1 text-[11px] ${isDarkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                                            {server.error}
                                          </p>
                                        )}
                                        <ul className="mt-1 space-y-0.5">
                                          {server.tools.map(tool => (
                                            <li key={`${server.id}:${tool.name}`}>
                                              <label
                                                className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-black/10 ${isDarkMode ? 'hover:bg-white/10' : ''}`}>
                                                <input
                                                  type="checkbox"
                                                  checked={tool.enabled}
                                                  disabled={
                                                    disabled || qaMcpToolsPanel.loading || Boolean(server.error)
                                                  }
                                                  onChange={e =>
                                                    onToggleQaMcpTool({
                                                      serverId: server.id,
                                                      toolName: tool.name,
                                                      nextEnabled: e.target.checked,
                                                      discoveredNames: server.tools.map(t => t.name),
                                                    })
                                                  }
                                                  className="rounded border-gray-400"
                                                />
                                                <span className="truncate font-mono">{tool.name}</span>
                                              </label>
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="border-t border-inherit p-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onQaMcpToolsMenuOpenChange(false);
                                      onOpenQaToolSettings();
                                    }}
                                    className={`text-xs font-medium underline-offset-2 hover:underline ${
                                      isDarkMode ? 'text-sky-400' : 'text-sky-600'
                                    }`}>
                                    {t('chat_mcpTools_manage_servers')}
                                  </button>
                                </div>
                              </div>,
                              document.body,
                            )}
                        </>
                      )}
                  </>
                )}
              </>
            )}
          </div>

          {showStopButton ? (
            <button
              type="button"
              onClick={onStopTask}
              className="shrink-0 whitespace-nowrap rounded-md bg-red-500 px-2.5 py-1 text-xs text-white transition-colors hover:bg-red-600 sm:px-3 sm:text-sm"
              style={qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : undefined}>
              {t('chat_buttons_stop')}
            </button>
          ) : historicalSessionId ? (
            <button
              type="button"
              onClick={handleReplay}
              disabled={!historicalSessionId}
              aria-disabled={!historicalSessionId}
              className={`shrink-0 whitespace-nowrap rounded-md bg-green-500 px-2.5 py-1 text-xs text-white transition-colors hover:enabled:bg-green-600 sm:px-3 sm:text-sm ${!historicalSessionId ? 'cursor-not-allowed opacity-50' : ''}`}
              style={qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : undefined}>
              {t('chat_buttons_replay')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-white transition-colors hover:enabled:opacity-90 sm:px-3 sm:text-sm ${qaUiTheme?.accentColor ? '' : 'bg-[#19C2FF] hover:enabled:bg-[#0073DC]'} ${isSendButtonDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
              style={{
                ...(qaUiTheme?.accentColor ? { backgroundColor: qaUiTheme.accentColor } : {}),
                ...(qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : {}),
              }}>
              {t('chat_buttons_send')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
