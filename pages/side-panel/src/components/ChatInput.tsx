import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
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

/** MCP tool toggle panel for QA chat (discovery + enable flags). */
export interface QaMcpToolsPanelState {
  loading: boolean;
  error: string | null;
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
  // Page content toggle for QA mode
  includePageContent?: boolean;
  onToggleIncludePageContent?: () => void;
  // Web search toggle for QA mode
  enableWebSearch?: boolean;
  onToggleEnableWebSearch?: () => void;
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
}

// File attachment interface
interface AttachedFile {
  name: string;
  content: string;
  type: string;
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
  enableWebSearch = false,
  onToggleEnableWebSearch,
  qaUiTheme = null,
  qaEnabledToolCount,
  onOpenQaToolSettings,
  qaMcpToolsPanel = null,
  qaMcpToolsMenuOpen = false,
  onQaMcpToolsMenuOpenChange,
  onToggleQaMcpTool,
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
  const qaMcpMenuRef = useRef<HTMLDivElement>(null);

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

  /** Same “ON” treatment as page-content toggle so both read clearly as active. */
  const toggleOnControlStyle = accentControlStyle;

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
      if (qaMcpMenuRef.current && !qaMcpMenuRef.current.contains(e.target as Node)) {
        onQaMcpToolsMenuOpenChange(false);
      }
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
          className={`flex items-center justify-between px-2 py-1.5 ${
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
          <div className="flex gap-2 text-gray-500">
            {/* File attachment — distinct control so updates are obvious after rebuild */}
            <button
              type="button"
              onClick={handleFileSelect}
              disabled={disabled}
              aria-label={t('chat_attach_files_tooltip')}
              title={t('chat_attach_files_tooltip')}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                disabled
                  ? 'cursor-not-allowed opacity-50'
                  : isDarkMode
                    ? 'border-[#3d3d52] bg-[#2a2a3a] text-[#c8c8d4] hover:border-[#5a5a72] hover:bg-[#32324a]'
                    : 'border-gray-300 bg-gray-50 text-gray-700 hover:border-gray-400 hover:bg-gray-100'
              }`}
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
              <span className="max-w-[4.5rem] truncate sm:max-w-none">{t('chat_attach_files_button')}</span>
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
                  className={`rounded-md p-1.5 transition-colors ${
                    disabled || isProcessingSpeech
                      ? 'cursor-not-allowed opacity-50'
                      : isRecording
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : isDarkMode
                          ? 'text-gray-400 hover:bg-slate-700 hover:text-gray-200'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                  style={isRecording ? undefined : neutralControlStyle}>
                  {isProcessingSpeech ? (
                    <AiOutlineLoading3Quarters className="size-4 animate-spin" />
                  ) : (
                    <FaMicrophone className={`size-4 ${isRecording ? 'animate-pulse' : ''}`} />
                  )}
                </button>
                {isQAMode && availableModels.length > 0 && onQAModelChange && (
                  <>
                    <select
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
                      className={`max-w-[200px] rounded-md px-2 py-1.5 text-xs transition-colors ${
                        disabled
                          ? 'cursor-not-allowed opacity-50'
                          : isDarkMode
                            ? 'border border-slate-600 bg-slate-700 text-gray-200 hover:bg-slate-600'
                            : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                      style={neutralControlStyle}
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
                    {personas.length > 0 && onPersonaChange && (
                      <select
                        value={currentPersonaId || ''}
                        onChange={e => onPersonaChange(e.target.value)}
                        disabled={disabled}
                        className={`max-w-[180px] rounded-md px-2 py-1.5 text-xs transition-colors ${
                          disabled
                            ? 'cursor-not-allowed opacity-50'
                            : isDarkMode
                              ? 'border border-slate-600 bg-slate-700 text-gray-200 hover:bg-slate-600'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                        style={neutralControlStyle}
                        aria-label="Select QA persona">
                        {personas.map(persona => (
                          <option key={persona.id} value={persona.id}>
                            {persona.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {/* Page Content Toggle button */}
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
                        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                          disabled
                            ? 'cursor-not-allowed opacity-50'
                            : includePageContent
                              ? isDarkMode
                                ? 'border border-sky-600 bg-sky-700 text-white hover:bg-sky-600'
                                : 'border border-sky-300 bg-sky-100 text-sky-700 hover:bg-sky-200'
                              : isDarkMode
                                ? 'border border-slate-600 bg-slate-700 text-gray-400 hover:bg-slate-600'
                                : 'border border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        style={includePageContent ? toggleOnControlStyle : neutralControlStyle}>
                        {includePageContent ? (
                          <HiOutlineDocumentText className="size-4" />
                        ) : (
                          <HiOutlineChat className="size-4" />
                        )}
                        <span className="hidden sm:inline">
                          {includePageContent ? t('chat_pageContent_enabled') : t('chat_pageContent_disabled')}
                        </span>
                      </button>
                    )}
                    {onToggleEnableWebSearch && (
                      <button
                        type="button"
                        onClick={onToggleEnableWebSearch}
                        disabled={disabled}
                        aria-label="Toggle web search"
                        title={
                          enableWebSearch
                            ? 'Click to disable web search for this chat'
                            : 'Click to enable web search for this chat'
                        }
                        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                          disabled
                            ? 'cursor-not-allowed opacity-50'
                            : enableWebSearch
                              ? isDarkMode
                                ? 'border border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-600'
                                : 'border border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                              : isDarkMode
                                ? 'border border-slate-600 bg-slate-700 text-gray-400 hover:bg-slate-600'
                                : 'border border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        style={enableWebSearch ? toggleOnControlStyle : neutralControlStyle}>
                        <span className="hidden sm:inline">{enableWebSearch ? 'Web search on' : 'Web search off'}</span>
                        <span className="sm:hidden">{enableWebSearch ? 'Web' : 'No Web'}</span>
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
                        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                          disabled || isCapturingImage
                            ? 'cursor-not-allowed opacity-50'
                            : isDarkMode
                              ? 'border border-slate-600 bg-slate-700 text-gray-200 hover:bg-slate-600'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                        style={neutralControlStyle}>
                        {isCapturingImage ? (
                          <AiOutlineLoading3Quarters className="size-4 animate-spin" />
                        ) : (
                          <HiOutlineCamera className="size-4" />
                        )}
                        <span className="hidden sm:inline">{t('chat_imageCapture_label')}</span>
                      </button>
                    )}
                    {onOpenQaToolSettings && qaMcpToolsPanel && onQaMcpToolsMenuOpenChange && onToggleQaMcpTool && (
                      <div className="relative" ref={qaMcpMenuRef}>
                        <button
                          type="button"
                          onClick={() => {
                            if (disabled) return;
                            onQaMcpToolsMenuOpenChange(!qaMcpToolsMenuOpen);
                          }}
                          disabled={disabled}
                          aria-expanded={qaMcpToolsMenuOpen}
                          aria-haspopup="dialog"
                          aria-label={
                            qaEnabledToolCount != null
                              ? t('chat_qaTools_tooltip', [String(qaEnabledToolCount)])
                              : t('chat_qaTools_button')
                          }
                          title={
                            qaEnabledToolCount != null
                              ? t('chat_qaTools_tooltip', [String(qaEnabledToolCount)])
                              : t('chat_qaTools_button')
                          }
                          className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                            disabled
                              ? 'cursor-not-allowed opacity-50'
                              : isDarkMode
                                ? `border ${qaMcpToolsMenuOpen ? 'border-sky-500' : 'border-slate-600'} bg-slate-700 text-gray-200 hover:bg-slate-600`
                                : `border ${qaMcpToolsMenuOpen ? 'border-sky-500' : 'border-gray-300'} bg-white text-gray-700 hover:bg-gray-50`
                          }`}
                          style={
                            qaUiTheme?.inputBorder || qaUiTheme?.inputSurface
                              ? {
                                  ...(qaUiTheme.inputBorder
                                    ? {
                                        borderColor: qaMcpToolsMenuOpen ? qaUiTheme.accentColor : qaUiTheme.inputBorder,
                                      }
                                    : {}),
                                  ...(qaUiTheme.inputSurface ? { backgroundColor: `${qaUiTheme.inputSurface}ee` } : {}),
                                  ...(qaUiTheme.inputText ? { color: qaUiTheme.inputText } : {}),
                                }
                              : undefined
                          }>
                          <FiTool className="size-4 shrink-0" aria-hidden />
                          <span
                            className={`min-w-[1.15rem] rounded-full px-1 py-px text-center text-[10px] font-semibold leading-tight tabular-nums ${
                              isDarkMode ? 'bg-sky-700 text-white' : 'bg-sky-600 text-white'
                            }`}>
                            {qaEnabledToolCount != null ? qaEnabledToolCount : t('chat_qaTools_countLoading')}
                          </span>
                        </button>
                        {qaMcpToolsMenuOpen && (
                          <div
                            role="dialog"
                            aria-label={t('chat_mcpTools_menu_title')}
                            className={`absolute bottom-full left-0 z-[100] mb-1 flex max-h-72 min-w-[18rem] max-w-[min(22rem,calc(100vw-3rem))] flex-col rounded-lg border text-left shadow-lg ${
                              isDarkMode
                                ? 'border-slate-600 bg-slate-800 text-gray-100'
                                : 'border-gray-200 bg-white text-gray-900'
                            }`}
                            style={
                              qaUiTheme?.inputBorder
                                ? {
                                    borderColor: qaUiTheme.inputBorder,
                                    backgroundColor: qaUiTheme.inputSurface ?? undefined,
                                  }
                                : undefined
                            }>
                            <div className="border-b border-inherit px-3 py-2 text-xs font-semibold">
                              {t('chat_mcpTools_menu_title')}
                            </div>
                            <div className="flex-1 overflow-y-auto px-2 py-2">
                              {qaMcpToolsPanel.loading && qaMcpToolsPanel.servers.length === 0 && (
                                <div className="flex items-center gap-2 px-1 py-2 text-xs text-gray-400">
                                  <AiOutlineLoading3Quarters className="size-3.5 shrink-0 animate-spin" aria-hidden />
                                  {t('chat_mcpTools_loading')}
                                </div>
                              )}
                              {qaMcpToolsPanel.error && !qaMcpToolsPanel.loading && (
                                <p className={`px-1 py-1 text-xs ${isDarkMode ? 'text-rose-300' : 'text-rose-600'}`}>
                                  {qaMcpToolsPanel.error}
                                </p>
                              )}
                              {!qaMcpToolsPanel.loading &&
                                !qaMcpToolsPanel.error &&
                                qaMcpToolsPanel.servers.length === 0 && (
                                  <p className="px-1 py-2 text-xs text-gray-400">{t('chat_mcpTools_empty')}</p>
                                )}
                              {qaMcpToolsPanel.servers.map(server => (
                                <div key={server.id} className="mb-3 last:mb-0">
                                  <p className="break-all px-1 font-mono text-[11px] font-semibold">{server.name}</p>
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
                                            disabled={disabled || qaMcpToolsPanel.loading || Boolean(server.error)}
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
                            <div className="border-t border-inherit px-2 py-2">
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
                          </div>
                        )}
                      </div>
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
              className="rounded-md bg-red-500 px-3 py-1 text-white transition-colors hover:bg-red-600"
              style={qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : undefined}>
              {t('chat_buttons_stop')}
            </button>
          ) : historicalSessionId ? (
            <button
              type="button"
              onClick={handleReplay}
              disabled={!historicalSessionId}
              aria-disabled={!historicalSessionId}
              className={`rounded-md bg-green-500 px-3 py-1 text-white transition-colors hover:enabled:bg-green-600 ${!historicalSessionId ? 'cursor-not-allowed opacity-50' : ''}`}
              style={qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : undefined}>
              {t('chat_buttons_replay')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className={`rounded-md px-3 py-1 text-white transition-colors hover:enabled:opacity-90 ${qaUiTheme?.accentColor ? '' : 'bg-[#19C2FF] hover:enabled:bg-[#0073DC]'} ${isSendButtonDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
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
