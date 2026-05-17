import type { ChatMessage, Message, ResolvedQaUiTheme } from '@extension/storage';
import { Actors } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { t } from '@extension/i18n';
import { FiEdit2 } from 'react-icons/fi';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

/** Cursor-style meta line when the model leads with "Thought for …". */
function partitionThoughtPrefix(raw: string): { thoughtLine: string | null; body: string } {
  const trimmed = raw.replace(/^\uFEFF?\s*/, '');
  const m = trimmed.match(/^([Tt]hought for [^\n]+)\n+([\s\S]*)$/);
  if (m) return { thoughtLine: m[1], body: m[2] };
  return { thoughtLine: null, body: raw };
}

function createMarkdownComponents({
  isDarkMode,
  qaUiTheme,
}: {
  isDarkMode: boolean;
  qaUiTheme: ResolvedQaUiTheme | null;
}): Components {
  const linkCol = qaUiTheme?.linkColor ?? (isDarkMode ? '#7aa2f7' : '#2563eb');
  const inlineCodeBg = isDarkMode ? '#2a2a3a' : '#f0f2f5';
  const inlineCodeBorder = isDarkMode ? 'rgba(51,51,68,0.7)' : '#e2e8f0';
  const preBg = isDarkMode ? '#12121a' : '#f8fafc';
  const preBorder = isDarkMode ? '#333344' : '#e2e8f0';

  return {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !className;
      if (isInline) {
        return (
          <code
            className="rounded px-1.5 py-0.5 font-mono text-[0.92em]"
            style={{ backgroundColor: inlineCodeBg, border: `1px solid ${inlineCodeBorder}` }}
            {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      return (
        <pre
          className="my-3 overflow-x-auto rounded-lg p-3 font-mono text-[13px] leading-relaxed"
          style={{ backgroundColor: preBg, border: `1px solid ${preBorder}` }}>
          {children}
        </pre>
      );
    },
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            qaUiTheme?.linkColor
              ? 'underline underline-offset-2 hover:opacity-90'
              : isDarkMode
                ? 'underline decoration-white/15 underline-offset-2 hover:decoration-white/35'
                : 'underline decoration-gray-400/40 underline-offset-2 hover:decoration-gray-500/70'
          }
          style={{ color: linkCol }}>
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead className={isDarkMode ? 'bg-[#252535]' : 'bg-gray-100'}>{children}</thead>;
    },
    th({ children }) {
      return (
        <th
          className={`border-b px-3 py-2.5 text-left font-semibold first:pl-0 last:pr-0 ${
            isDarkMode ? 'border-[#333344] text-[#e4e4ef]' : 'border-gray-200 text-gray-900'
          }`}>
          {children}
        </th>
      );
    },
    td({ children }) {
      return (
        <td
          className={`border-b px-3 py-2.5 align-top first:pl-0 last:pr-0 ${
            isDarkMode ? 'border-[#2e2e3d]' : 'border-gray-100'
          }`}>
          {children}
        </td>
      );
    },
    hr() {
      return <hr className={`my-6 h-px border-0 ${isDarkMode ? 'bg-[#333344]' : 'bg-gray-200'}`} />;
    },
  };
}

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  streamingContent?: string;
  isWaitingForResponse?: boolean;
  fontSize?: number;
  qaUiTheme?: ResolvedQaUiTheme | null;
  canEditUserMessages?: boolean;
  onEditAndResend?: (messageId: string, newContent: string, imageDataList?: string[]) => void | Promise<void>;
}

/** Strip UI-only attachment lines from stored display text before editing. */
function contentForEditing(displayContent: string): string {
  return displayContent
    .replace(/\n\n📷[^\n]*$/g, '')
    .replace(/\n\n(?:📎[^\n]+\n?)+$/g, '')
    .trim();
}

export default memo(function MessageList({
  messages,
  isDarkMode = false,
  streamingContent,
  isWaitingForResponse = false,
  fontSize = 14,
  qaUiTheme = null,
  canEditUserMessages = false,
  onEditAndResend,
}: MessageListProps) {
  const displayMessages = useMemo(() => mergeAdjacentToolCallResultPairs(messages), [messages]);
  const markdownComponents = useMemo(
    () => createMarkdownComponents({ isDarkMode, qaUiTheme }),
    [isDarkMode, qaUiTheme],
  );

  // Check if last message is from SYSTEM actor for streaming continuation
  const lastMessage = displayMessages[displayMessages.length - 1];
  const lastWasSystem = lastMessage?.actor === 'system';

  return (
    <div className="max-w-full space-y-3">
      {displayMessages.map((message, index) => (
        <MessageBlock
          key={
            'id' in message && typeof (message as ChatMessage).id === 'string'
              ? (message as ChatMessage).id
              : `${message.actor}-${message.timestamp}-${index}`
          }
          message={message}
          isSameActor={index > 0 ? displayMessages[index - 1].actor === message.actor : false}
          isDarkMode={isDarkMode}
          fontSize={fontSize}
          qaUiTheme={qaUiTheme}
          markdownComponents={markdownComponents}
          canEdit={canEditUserMessages && message.actor === Actors.USER}
          onEditAndResend={onEditAndResend}
        />
      ))}
      {/* Render waiting indicator while waiting for first response chunk */}
      {isWaitingForResponse && (!streamingContent || streamingContent.trim() === '') && (
        <WaitingMessageBlock
          isDarkMode={isDarkMode}
          isSameActor={lastWasSystem}
          fontSize={fontSize}
          qaUiTheme={qaUiTheme}
        />
      )}
      {/* Render streaming content as a separate block */}
      {streamingContent && streamingContent.trim() !== '' && (
        <StreamingMessageBlock
          content={streamingContent}
          isDarkMode={isDarkMode}
          isSameActor={lastWasSystem}
          fontSize={fontSize}
          qaUiTheme={qaUiTheme}
          markdownComponents={markdownComponents}
        />
      )}
    </div>
  );
});

interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
  fontSize?: number;
  qaUiTheme?: ResolvedQaUiTheme | null;
  markdownComponents: Components;
  canEdit?: boolean;
  onEditAndResend?: (messageId: string, newContent: string, imageDataList?: string[]) => void | Promise<void>;
}

function MessageBlock({
  message,
  isSameActor,
  isDarkMode = false,
  fontSize = 14,
  qaUiTheme = null,
  markdownComponents,
  canEdit = false,
  onEditAndResend,
}: MessageBlockProps) {
  // Tracks which screenshot (by index) is open in the lightbox. `null` means closed.
  const [openImageIndex, setOpenImageIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [isResending, setIsResending] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCloseModal = useCallback(() => {
    setOpenImageIndex(null);
  }, []);

  // Prefer the multi-image list. Fall back to the legacy single `imageData` for old sessions.
  const imageList = useMemo<string[]>(() => {
    if (message.imageDataList && message.imageDataList.length > 0) return message.imageDataList;
    if (message.imageData) return [message.imageData];
    return [];
  }, [message.imageData, message.imageDataList]);

  if (!message.actor) {
    console.error('No actor found');
    return <div />;
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === t('chat_progress_message');
  const isUser = message.actor === Actors.USER;
  const messageId =
    'id' in message && typeof (message as ChatMessage).id === 'string' ? (message as ChatMessage).id : null;
  const { thoughtLine, body: bodyAfterThought } = partitionThoughtPrefix(message.content);

  const handleStartEdit = useCallback(() => {
    setEditDraft(contentForEditing(bodyAfterThought));
    setIsEditing(true);
  }, [bodyAfterThought]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditDraft('');
  }, []);

  const handleConfirmEdit = useCallback(async () => {
    const trimmed = editDraft.trim();
    if (!trimmed || !messageId || !onEditAndResend) return;
    setIsResending(true);
    try {
      const images =
        message.imageDataList && message.imageDataList.length > 0
          ? message.imageDataList
          : message.imageData
            ? [message.imageData]
            : undefined;
      await onEditAndResend(messageId, trimmed, images);
      setIsEditing(false);
      setEditDraft('');
    } finally {
      setIsResending(false);
    }
  }, [editDraft, messageId, onEditAndResend, message.imageData, message.imageDataList]);

  useEffect(() => {
    if (!isEditing) return;
    const textarea = editTextareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [isEditing, editDraft]);

  const messageColor = qaUiTheme?.messageText ?? (isDarkMode ? '#d1d1d1' : '#374151');
  const mdWrapClass = `max-w-none [&_p]:mb-3 [&_p:last-child]:mb-0 [&_li>p]:mb-0 [&_li>p]:inline [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_strong]:font-semibold [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 ${
    isDarkMode
      ? '[&_blockquote]:border-[#4a4a5c] [&_blockquote]:text-[#b8b8c8]'
      : '[&_blockquote]:border-gray-300 [&_blockquote]:text-gray-600'
  }`;

  return (
    <>
      <div
        className={`flex max-w-full gap-3 ${
          !isSameActor
            ? `mt-3 border-t pt-3 first:mt-0 first:border-t-0 first:pt-0 ${
                qaUiTheme?.separatorColor ? '' : isDarkMode ? 'border-[#333344]/90' : 'border-sky-200/50'
              }`
            : ''
        }`}
        style={!isSameActor && qaUiTheme?.separatorColor ? { borderTopColor: qaUiTheme.separatorColor } : undefined}>
        {!isSameActor && (
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: actor.iconBackground }}>
            <img src={actor.icon} alt={actor.name} className="size-6" />
          </div>
        )}
        {isSameActor && <div className="w-8" />}

        <div className="group min-w-0 flex-1">
          {!isSameActor && (
            <div
              className={`mb-1 text-[13px] font-medium ${
                qaUiTheme?.headingText ? '' : isDarkMode ? 'text-[#9b9bb0]' : 'text-gray-600'
              }`}
              style={qaUiTheme?.headingText ? { color: qaUiTheme.headingText } : undefined}>
              {actor.name}
            </div>
          )}

          <div className="space-y-1">
            {/* Display attached screenshot thumbnails (supports multiple). */}
            {imageList.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {imageList.map((image, idx) => (
                  <button
                    key={`${idx}-${image.length}`}
                    type="button"
                    onClick={() => setOpenImageIndex(idx)}
                    className="group relative block overflow-hidden rounded-lg border border-gray-200 transition-colors hover:border-[#5b7cff]/60 dark:border-[#333344]"
                    aria-label={t('chat_imageCapture_viewFull')}>
                    <img
                      src={`data:image/jpeg;base64,${image}`}
                      alt={t('chat_imageCapture_attached')}
                      className={`h-auto max-h-32 max-w-full object-cover ${
                        imageList.length === 1 ? 'w-full' : 'w-auto'
                      }`}
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                      <span className="rounded bg-black/50 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                        {t('chat_imageCapture_clickToExpand')}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {message.toolEvent ? (
              <ToolEventBlock toolEvent={message.toolEvent} isDarkMode={isDarkMode} fontSize={fontSize} />
            ) : (
              <div
                className={`break-words ${qaUiTheme?.messageText ? '' : isDarkMode ? 'text-[#d1d1d1]' : 'text-gray-700'}`}
                style={{
                  fontSize: `${fontSize}px`,
                  ...(qaUiTheme?.messageText ? { color: qaUiTheme.messageText } : {}),
                }}>
                {isProgress ? (
                  <div className={`h-1 overflow-hidden rounded ${isDarkMode ? 'bg-[#2a2a3a]' : 'bg-gray-200'}`}>
                    <div
                      className="h-full animate-progress bg-blue-500"
                      style={qaUiTheme?.accentColor ? { backgroundColor: qaUiTheme.accentColor } : undefined}
                    />
                  </div>
                ) : (
                  <>
                    {thoughtLine ? (
                      <p
                        className={`mb-2 text-[13px] leading-snug ${
                          qaUiTheme?.mutedText ? '' : isDarkMode ? 'text-[#888888]' : 'text-gray-500'
                        }`}
                        style={qaUiTheme?.mutedText ? { color: qaUiTheme.mutedText } : undefined}>
                        {thoughtLine}
                      </p>
                    ) : null}
                    <div
                      className={
                        isUser
                          ? `rounded-lg border px-3 py-2 ${isDarkMode ? 'border-[#333344] bg-[#252535]' : 'border-gray-200 bg-gray-50'}`
                          : ''
                      }
                      style={!isUser ? { color: messageColor } : { color: messageColor }}>
                      {isUser && isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            ref={editTextareaRef}
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                handleCancelEdit();
                              } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                void handleConfirmEdit();
                              }
                            }}
                            disabled={isResending}
                            rows={3}
                            className={`w-full resize-none rounded-md border bg-transparent px-1 py-0.5 outline-none focus:ring-1 ${
                              isDarkMode
                                ? 'border-[#44445a] text-[#e4e4ef] focus:ring-[#5b7cff]/50'
                                : 'border-gray-300 text-gray-800 focus:ring-blue-400/50'
                            }`}
                            style={{ fontSize: `${fontSize}px` }}
                            aria-label={t('chat_message_edit_a11y')}
                          />
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              disabled={isResending}
                              className={`rounded-md px-2.5 py-1 text-[12px] ${
                                isDarkMode ? 'text-[#b4b4c8] hover:bg-[#333344]' : 'text-gray-600 hover:bg-gray-200'
                              }`}>
                              {t('chat_message_edit_cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleConfirmEdit()}
                              disabled={isResending || !editDraft.trim()}
                              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${
                                isDarkMode
                                  ? 'bg-[#5b7cff] text-white hover:bg-[#4a6ae8]'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              } disabled:opacity-50`}>
                              {t('chat_message_edit_resend')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className={mdWrapClass}>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeHighlight]}
                            components={markdownComponents}>
                            {bodyAfterThought}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            {!isProgress && (
              <div className="flex items-center justify-end gap-2">
                {isUser && canEdit && messageId && onEditAndResend && !isEditing && (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 ${
                      isDarkMode
                        ? 'text-[#9b9bb0] hover:bg-[#333344] hover:text-[#e4e4ef]'
                        : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700'
                    }`}
                    aria-label={t('chat_message_edit_a11y')}>
                    <FiEdit2 className="size-3" aria-hidden />
                    {t('chat_message_edit')}
                  </button>
                )}
                <div
                  className={`text-[11px] tabular-nums ${
                    qaUiTheme?.mutedText ? '' : isDarkMode ? 'text-[#6b6b7e]' : 'text-gray-400'
                  }`}
                  style={qaUiTheme?.mutedText ? { color: qaUiTheme.mutedText } : undefined}>
                  {formatTimestamp(message.timestamp)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {openImageIndex !== null && imageList[openImageIndex] && (
        <ImageModal imageData={imageList[openImageIndex]} onClose={handleCloseModal} />
      )}
    </>
  );
}

/** Legacy QA tool UI emitted separate `call` then `result` messages; collapse to one row with full request + response. */
function mergeAdjacentToolCallResultPairs(messages: Message[]): Message[] {
  const out: Message[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    const next = messages[i + 1];
    const te = m.toolEvent;
    const nte = next?.toolEvent;
    if (
      te?.kind === 'call' &&
      nte?.kind === 'result' &&
      te.toolName === nte.toolName &&
      m.actor === next.actor &&
      nte.requestDetail === undefined &&
      !te.toolRunId &&
      !nte.toolRunId
    ) {
      out.push({
        ...next,
        toolEvent: {
          ...nte,
          requestDetail: te.detail ?? '',
        },
      });
      i += 2;
    } else {
      out.push(m);
      i += 1;
    }
  }
  return out;
}

interface ToolEventBlockProps {
  toolEvent: NonNullable<Message['toolEvent']>;
  isDarkMode?: boolean;
  fontSize?: number;
}

function ToolEventBlock({ toolEvent, isDarkMode = false, fontSize = 14 }: ToolEventBlockProps) {
  const accentRing =
    toolEvent.status === 'pending'
      ? isDarkMode
        ? 'ring-1 ring-amber-500/35'
        : 'ring-1 ring-amber-400/50'
      : toolEvent.status === 'error'
        ? isDarkMode
          ? 'ring-1 ring-rose-500/35'
          : 'ring-1 ring-rose-400/45'
        : toolEvent.status === 'success'
          ? isDarkMode
            ? 'ring-1 ring-emerald-500/25'
            : 'ring-1 ring-emerald-400/40'
          : '';

  const shell = isDarkMode
    ? `rounded-lg border border-[#333344] bg-[#252535] text-[#d1d1d1] ${accentRing}`
    : `rounded-lg border border-gray-200 bg-gray-50 text-gray-800 ${accentRing}`;

  const hasRequest = toolEvent.requestDetail !== undefined;
  const isPendingWithRequest = toolEvent.status === 'pending' && hasRequest;
  const isCombinedExchange = hasRequest && (toolEvent.kind === 'result' || isPendingWithRequest);
  const monoSize = Math.max(10, fontSize - 3);

  const preClass = `whitespace-pre-wrap break-words font-mono leading-snug max-h-[min(50vh,24rem)] overflow-y-auto overflow-x-auto ${
    isDarkMode ? 'text-[#c9d1d9]' : 'text-slate-800'
  }`;

  const labelClass = `mb-0.5 text-[10px] font-semibold uppercase tracking-wider ${
    isDarkMode ? 'text-[#888888]' : 'text-gray-500'
  }`;

  return (
    <details className={`ide-details text-left ${shell}`} open={false}>
      <summary className="cursor-pointer select-none px-2.5 py-2 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          <span
            className="ide-details-chevron inline-flex size-5 shrink-0 items-center justify-center text-[15px] font-semibold leading-none text-[#888888] transition-transform duration-150"
            aria-hidden>
            ▸
          </span>
          <div
            className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium leading-tight"
            style={{ fontSize: `${Math.min(fontSize - 1, 12)}px` }}>
            <span className={isDarkMode ? 'text-[#b4b4c8]' : 'text-gray-700'}>{toolEvent.toolName}</span>
            {toolEvent.summary ? (
              <span className={`font-normal ${isDarkMode ? 'text-[#8f8f9d]' : 'text-gray-500'}`}>
                {' '}
                · {toolEvent.summary}
              </span>
            ) : null}
          </div>
        </div>
      </summary>
      <div className={`space-y-2 border-t px-2.5 py-2 ${isDarkMode ? 'border-[#333344]' : 'border-gray-200'}`}>
        {isCombinedExchange ? (
          <>
            <div>
              <div className={labelClass}>Request</div>
              <pre className={preClass} style={{ fontSize: `${monoSize}px` }}>
                {toolEvent.requestDetail ?? ''}
              </pre>
            </div>
            <div>
              <div className={labelClass}>Response</div>
              {isPendingWithRequest ? (
                <div
                  className={`rounded-md border border-dashed px-2 py-1.5 text-[11px] italic ${
                    isDarkMode ? 'border-amber-600/40 text-[#c4b5a0]' : 'border-amber-300 text-amber-900/75'
                  }`}>
                  Waiting for response…
                </div>
              ) : (
                <pre className={preClass} style={{ fontSize: `${monoSize}px` }}>
                  {toolEvent.detail ?? ''}
                </pre>
              )}
            </div>
          </>
        ) : toolEvent.kind === 'call' ? (
          toolEvent.detail && (
            <pre className={preClass} style={{ fontSize: `${monoSize}px` }}>
              {toolEvent.detail}
            </pre>
          )
        ) : (
          toolEvent.detail && (
            <pre className={preClass} style={{ fontSize: `${monoSize}px` }}>
              {toolEvent.detail}
            </pre>
          )
        )}
      </div>
    </details>
  );
}

// Image Modal Component
interface ImageModalProps {
  imageData: string;
  onClose: () => void;
}

function ImageModal({ imageData, onClose }: ImageModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
        aria-label={t('chat_imageCapture_closeModal')}
      />
      <div className="relative z-10 max-h-[90vh] max-w-[90vw]">
        <img
          src={`data:image/jpeg;base64,${imageData}`}
          alt={t('chat_imageCapture_fullImage')}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full bg-white text-gray-800 shadow-lg transition-colors hover:bg-gray-100"
          aria-label={t('chat_imageCapture_closeModal')}>
          ✕
        </button>
      </div>
    </div>
  );
}

interface StreamingMessageBlockProps {
  content: string;
  isDarkMode?: boolean;
  isSameActor?: boolean;
  fontSize?: number;
  qaUiTheme?: ResolvedQaUiTheme | null;
  markdownComponents: Components;
}

function StreamingMessageBlock({
  content,
  isDarkMode = false,
  isSameActor = false,
  fontSize = 14,
  qaUiTheme = null,
  markdownComponents,
}: StreamingMessageBlockProps) {
  const actor = ACTOR_PROFILES['system'];
  const { thoughtLine, body: bodyAfterThought } = partitionThoughtPrefix(content);
  const messageColor = qaUiTheme?.messageText ?? (isDarkMode ? '#d1d1d1' : '#374151');
  const mdWrapClass = `max-w-none [&_p]:mb-3 [&_p:last-child]:mb-0 [&_li>p]:mb-0 [&_li>p]:inline [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold [&_strong]:font-semibold [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 ${
    isDarkMode
      ? '[&_blockquote]:border-[#4a4a5c] [&_blockquote]:text-[#b8b8c8]'
      : '[&_blockquote]:border-gray-300 [&_blockquote]:text-gray-600'
  }`;

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameActor
          ? `mt-3 border-t pt-3 first:mt-0 first:border-t-0 first:pt-0 ${
              qaUiTheme?.separatorColor ? '' : isDarkMode ? 'border-[#333344]/90' : 'border-sky-200/50'
            }`
          : ''
      }`}
      style={!isSameActor && qaUiTheme?.separatorColor ? { borderTopColor: qaUiTheme.separatorColor } : undefined}>
      {!isSameActor && (
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: actor.iconBackground }}>
          <img src={actor.icon} alt={actor.name} className="size-6" />
        </div>
      )}
      {isSameActor && <div className="w-8" />}

      <div className="min-w-0 flex-1">
        {!isSameActor && (
          <div
            className={`mb-1 text-[13px] font-medium ${
              qaUiTheme?.headingText ? '' : isDarkMode ? 'text-[#9b9bb0]' : 'text-gray-600'
            }`}
            style={qaUiTheme?.headingText ? { color: qaUiTheme.headingText } : undefined}>
            {actor.name}
          </div>
        )}

        <div className="space-y-1">
          <div
            className={`break-words ${qaUiTheme?.messageText ? '' : isDarkMode ? 'text-[#d1d1d1]' : 'text-gray-700'}`}
            style={{
              fontSize: `${fontSize}px`,
              ...(qaUiTheme?.messageText ? { color: qaUiTheme.messageText } : {}),
            }}>
            {thoughtLine ? (
              <p
                className={`mb-2 text-[13px] leading-snug ${
                  qaUiTheme?.mutedText ? '' : isDarkMode ? 'text-[#888888]' : 'text-gray-500'
                }`}
                style={qaUiTheme?.mutedText ? { color: qaUiTheme.mutedText } : undefined}>
                {thoughtLine}
              </p>
            ) : null}
            <div className={mdWrapClass} style={{ color: messageColor }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={markdownComponents}>
                {bodyAfterThought}
              </ReactMarkdown>
            </div>
            <span
              className="ml-0.5 inline-block h-[1em] w-px translate-y-0.5 animate-pulse rounded-sm align-text-bottom"
              style={{
                backgroundColor: qaUiTheme?.accentColor ?? (isDarkMode ? '#7c7cff' : '#2563eb'),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface WaitingMessageBlockProps {
  isDarkMode?: boolean;
  isSameActor?: boolean;
  fontSize?: number;
  qaUiTheme?: ResolvedQaUiTheme | null;
}

function WaitingMessageBlock({
  isDarkMode = false,
  isSameActor = false,
  fontSize = 14,
  qaUiTheme = null,
}: WaitingMessageBlockProps) {
  const actor = ACTOR_PROFILES['system'];

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameActor
          ? `mt-3 border-t pt-3 first:mt-0 first:border-t-0 first:pt-0 ${
              qaUiTheme?.separatorColor ? '' : isDarkMode ? 'border-[#333344]/90' : 'border-sky-200/50'
            }`
          : ''
      }`}
      style={!isSameActor && qaUiTheme?.separatorColor ? { borderTopColor: qaUiTheme.separatorColor } : undefined}>
      {!isSameActor && (
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: actor.iconBackground }}>
          <img src={actor.icon} alt={actor.name} className="size-6" />
        </div>
      )}
      {isSameActor && <div className="w-8" />}

      <div className="min-w-0 flex-1">
        {!isSameActor && (
          <div
            className={`mb-1 text-sm font-semibold ${qaUiTheme?.headingText ? '' : isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}
            style={qaUiTheme?.headingText ? { color: qaUiTheme.headingText } : undefined}>
            {actor.name}
          </div>
        )}

        <div className="space-y-0.5">
          <p
            className={`text-[13px] leading-relaxed ${
              qaUiTheme?.mutedText ? '' : isDarkMode ? 'text-[#888888]' : 'text-gray-500'
            } ${!qaUiTheme?.mutedText && isDarkMode ? 'animate-pulse' : ''}`}
            style={{
              fontSize: `${fontSize}px`,
              ...(qaUiTheme?.mutedText ? { color: qaUiTheme.mutedText } : {}),
            }}>
            Thinking…
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats a timestamp (in milliseconds) to a readable time string
 * @param timestamp Unix timestamp in milliseconds
 * @returns Formatted time string
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  // Check if the message is from today
  const isToday = date.toDateString() === now.toDateString();

  // Check if the message is from yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  // Check if the message is from this year
  const isThisYear = date.getFullYear() === now.getFullYear();

  // Format the time (HH:MM)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr; // Just show the time for today's messages
  }

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  if (isThisYear) {
    // Show month and day for this year
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  // Show full date for older messages
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}
