import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import type { ResolvedQaUiTheme } from '@extension/storage';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { HiOutlineCamera, HiOutlineDocumentText, HiOutlineChat } from 'react-icons/hi';
import { t } from '@extension/i18n';

interface ModelOption {
  provider: string;
  providerName: string;
  model: string;
  displayName: string;
}

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string, imageData?: string) => void;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
  // Historical session ID - if provided, shows replay button instead of send button
  historicalSessionId?: string | null;
  onReplay?: (sessionId: string) => void;
  // QA mode model selection
  isQAMode?: boolean;
  availableModels?: ModelOption[];
  currentQAModel?: string;
  onQAModelChange?: (provider: string, model: string) => void;
  // Expose textarea ref for focus management
  setTextareaRef?: (ref: HTMLTextAreaElement | null) => void;
  // Image capture
  onCaptureImage?: () => Promise<string | null>;
  capturedImage?: string | null;
  onRemoveCapturedImage?: () => void;
  isCapturingImage?: boolean;
  // Page content toggle for QA mode
  includePageContent?: boolean;
  onToggleIncludePageContent?: () => void;
  // Web search toggle for QA mode
  enableWebSearch?: boolean;
  onToggleEnableWebSearch?: () => void;
  qaUiTheme?: ResolvedQaUiTheme | null;
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
  setTextareaRef,
  onCaptureImage,
  capturedImage,
  onRemoveCapturedImage,
  isCapturingImage = false,
  includePageContent = true,
  onToggleIncludePageContent,
  enableWebSearch = false,
  onToggleEnableWebSearch,
  qaUiTheme = null,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0 && !capturedImage),
    [disabled, text, attachedFiles, capturedImage],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      if (trimmedText || attachedFiles.length > 0 || capturedImage) {
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

        // Add image indicator to display content if image is attached
        if (capturedImage) {
          displayContent = displayContent
            ? `${displayContent}\n\n📷 ${t('chat_imageCapture_attached')}`
            : `📷 ${t('chat_imageCapture_attached')}`;
        }

        onSendMessage(messageContent, displayContent, capturedImage || undefined);
        setText('');
        setAttachedFiles([]);
        // Clear captured image after sending
        if (capturedImage && onRemoveCapturedImage) {
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
    [text, attachedFiles, capturedImage, onSendMessage, isQAMode, disabled, onRemoveCapturedImage],
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

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-lg border transition-colors ${disabled ? 'cursor-not-allowed' : 'focus-within:border-sky-400 hover:border-sky-400'} ${qaUiTheme?.inputBorder ? '' : isDarkMode ? 'border-slate-700' : ''}`}
      style={formStyle}
      aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        {/* File attachments and captured image display */}
        {(attachedFiles.length > 0 || capturedImage) && (
          <div
            className={`flex flex-wrap gap-2 border-b p-2 ${
              qaUiTheme?.inputSurface ? '' : isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50'
            }`}
            style={
              qaUiTheme?.inputSurface
                ? { backgroundColor: qaUiTheme.inputSurface, borderBottomColor: qaUiTheme.inputBorder }
                : undefined
            }>
            {/* Captured image preview */}
            {capturedImage && (
              <div
                className={`relative flex items-center gap-1 rounded-md p-1 ${
                  isDarkMode ? 'bg-slate-700' : 'bg-gray-200'
                }`}>
                <img
                  src={`data:image/jpeg;base64,${capturedImage}`}
                  alt={t('chat_imageCapture_preview')}
                  className="h-12 w-auto max-w-[100px] rounded object-cover cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => {
                    // Open image in a modal-like view
                    const modal = document.createElement('div');
                    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer';
                    modal.onclick = () => modal.remove();
                    const img = document.createElement('img');
                    img.src = `data:image/jpeg;base64,${capturedImage}`;
                    img.className = 'max-h-[90vh] max-w-[90vw] object-contain rounded-lg';
                    img.onclick = e => e.stopPropagation();
                    modal.appendChild(img);
                    document.body.appendChild(modal);
                  }}
                />
                <button
                  type="button"
                  onClick={onRemoveCapturedImage}
                  className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-xs ${
                    isDarkMode
                      ? 'bg-slate-600 text-gray-200 hover:bg-slate-500'
                      : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                  }`}
                  aria-label={t('chat_imageCapture_remove')}>
                  ✕
                </button>
              </div>
            )}
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
                  ? 'cursor-not-allowed bg-slate-800 text-gray-400'
                  : 'cursor-not-allowed bg-gray-100 text-gray-500'
                : isDarkMode
                  ? 'bg-slate-800 text-gray-200'
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
                  ? 'bg-slate-800'
                  : 'bg-gray-100'
                : isDarkMode
                  ? 'bg-slate-800'
                  : 'bg-white'
          }`}
          style={toolbarStyle}>
          <div className="flex gap-2 text-gray-500">
            {/* File attachment button */}
            <button
              type="button"
              onClick={handleFileSelect}
              disabled={disabled}
              aria-label="Attach files"
              title="Attach text files (txt, md, json, csv, etc.)"
              className={`rounded-md p-1.5 transition-colors ${
                disabled
                  ? 'cursor-not-allowed opacity-50'
                  : isDarkMode
                    ? 'text-gray-400 hover:bg-slate-700 hover:text-gray-200'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
              style={neutralControlStyle}>
              <span className="text-lg">📎</span>
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
                      className={`rounded-md px-2 py-1.5 text-xs transition-colors max-w-[200px] ${
                        disabled
                          ? 'cursor-not-allowed opacity-50'
                          : isDarkMode
                            ? 'bg-slate-700 text-gray-200 hover:bg-slate-600 border border-slate-600'
                            : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
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
                                ? 'bg-sky-700 text-white hover:bg-sky-600 border border-sky-600'
                                : 'bg-sky-100 text-sky-700 hover:bg-sky-200 border border-sky-300'
                              : isDarkMode
                                ? 'bg-slate-700 text-gray-400 hover:bg-slate-600 border border-slate-600'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-300'
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
                                ? 'bg-emerald-700 text-white border border-emerald-600 hover:bg-emerald-600'
                                : 'bg-emerald-100 text-emerald-700 border border-emerald-300 hover:bg-emerald-200'
                              : isDarkMode
                                ? 'bg-slate-700 text-gray-400 border border-slate-600 hover:bg-slate-600'
                                : 'bg-gray-100 text-gray-500 border border-gray-300 hover:bg-gray-200'
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
                              ? 'bg-slate-700 text-gray-200 hover:bg-slate-600 border border-slate-600'
                              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
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
