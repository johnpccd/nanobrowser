import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useState, useCallback } from 'react';
import { t } from '@extension/i18n';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  streamingContent?: string;
  isWaitingForResponse?: boolean;
  fontSize?: number;
}

export default memo(function MessageList({
  messages,
  isDarkMode = false,
  streamingContent,
  isWaitingForResponse = false,
  fontSize = 14,
}: MessageListProps) {
  // Check if last message is from SYSTEM actor for streaming continuation
  const lastMessage = messages[messages.length - 1];
  const lastWasSystem = lastMessage?.actor === 'system';

  return (
    <div className="max-w-full space-y-4">
      {messages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 ? messages[index - 1].actor === message.actor : false}
          isDarkMode={isDarkMode}
          fontSize={fontSize}
        />
      ))}
      {/* Render waiting indicator while waiting for first response chunk */}
      {isWaitingForResponse && (!streamingContent || streamingContent.trim() === '') && (
        <WaitingMessageBlock isDarkMode={isDarkMode} isSameActor={lastWasSystem} fontSize={fontSize} />
      )}
      {/* Render streaming content as a separate block */}
      {streamingContent && streamingContent.trim() !== '' && (
        <StreamingMessageBlock
          content={streamingContent}
          isDarkMode={isDarkMode}
          isSameActor={lastWasSystem}
          fontSize={fontSize}
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
}

function MessageBlock({ message, isSameActor, isDarkMode = false, fontSize = 14 }: MessageBlockProps) {
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);

  const handleImageClick = useCallback(() => {
    setIsImageModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsImageModalOpen(false);
  }, []);

  if (!message.actor) {
    console.error('No actor found');
    return <div />;
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === 'Showing progress...';

  return (
    <>
      <div
        className={`flex max-w-full gap-3 ${
          !isSameActor
            ? `mt-4 border-t ${isDarkMode ? 'border-sky-800/50' : 'border-sky-200/50'} pt-4 first:mt-0 first:border-t-0 first:pt-0`
            : ''
        }`}>
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
            <div className={`mb-1 text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              {actor.name}
            </div>
          )}

          <div className="space-y-0.5">
            {/* Display attached image thumbnail if present */}
            {message.imageData && (
              <div className="mb-2">
                <button
                  type="button"
                  onClick={handleImageClick}
                  className="group relative block overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors"
                  aria-label={t('chat_imageCapture_viewFull')}>
                  <img
                    src={`data:image/jpeg;base64,${message.imageData}`}
                    alt={t('chat_imageCapture_attached')}
                    className="h-auto max-h-32 w-full max-w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                    <span className="text-white opacity-0 group-hover:opacity-100 text-xs bg-black/50 px-2 py-1 rounded">
                      {t('chat_imageCapture_clickToExpand')}
                    </span>
                  </div>
                </button>
              </div>
            )}
            <div
              className={`break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
              style={{ fontSize: `${fontSize}px` }}>
              {isProgress ? (
                <div className={`h-1 overflow-hidden rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div className="h-full animate-progress bg-blue-500" />
                </div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    code({ node, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const isInline = !match && !className;
                      return isInline ? (
                        <code className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-sm font-mono" {...props}>
                          {children}
                        </code>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre({ children }) {
                      return (
                        <pre className="p-4 overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-800">{children}</pre>
                      );
                    },
                    a({ href, children }) {
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline">
                          {children}
                        </a>
                      );
                    },
                    table({ children }) {
                      return (
                        <div className="overflow-x-auto">
                          <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
                            {children}
                          </table>
                        </div>
                      );
                    },
                    th({ children }) {
                      return (
                        <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-left font-semibold">
                          {children}
                        </th>
                      );
                    },
                    td({ children }) {
                      return <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">{children}</td>;
                    },
                  }}>
                  {message.content}
                </ReactMarkdown>
              )}
            </div>
            {!isProgress && (
              <div className={`text-right text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-300'}`}>
                {formatTimestamp(message.timestamp)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {isImageModalOpen && message.imageData && <ImageModal imageData={message.imageData} onClose={handleCloseModal} />}
    </>
  );
}

// Image Modal Component
interface ImageModalProps {
  imageData: string;
  onClose: () => void;
}

function ImageModal({ imageData, onClose }: ImageModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      onKeyDown={e => e.key === 'Escape' && onClose()}
      role="button"
      tabIndex={0}
      aria-label={t('chat_imageCapture_closeModal')}>
      <div className="relative max-h-[90vh] max-w-[90vw]">
        <img
          src={`data:image/jpeg;base64,${imageData}`}
          alt={t('chat_imageCapture_fullImage')}
          className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
          onClick={e => e.stopPropagation()}
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-800 shadow-lg hover:bg-gray-100 transition-colors"
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
}

function StreamingMessageBlock({
  content,
  isDarkMode = false,
  isSameActor = false,
  fontSize = 14,
}: StreamingMessageBlockProps) {
  const actor = ACTOR_PROFILES['system'];

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameActor
          ? `mt-4 border-t ${isDarkMode ? 'border-sky-800/50' : 'border-sky-200/50'} pt-4 first:mt-0 first:border-t-0 first:pt-0`
          : ''
      }`}>
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
          <div className={`mb-1 text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
            {actor.name}
          </div>
        )}

        <div className="space-y-0.5">
          <div
            className={`break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
            style={{ fontSize: `${fontSize}px` }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                code({ node, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const isInline = !match && !className;
                  return isInline ? (
                    <code className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-sm font-mono" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                pre({ children }) {
                  return <pre className="p-4 overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-800">{children}</pre>;
                },
                a({ href, children }) {
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                      {children}
                    </a>
                  );
                },
                table({ children }) {
                  return (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
                        {children}
                      </table>
                    </div>
                  );
                },
                th({ children }) {
                  return (
                    <th className="border border-gray-300 dark:border-gray-600 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-left font-semibold">
                      {children}
                    </th>
                  );
                },
                td({ children }) {
                  return <td className="border border-gray-300 dark:border-gray-600 px-4 py-2">{children}</td>;
                },
              }}>
              {content}
            </ReactMarkdown>
            <span className="inline-block w-2 h-4 ml-1 bg-blue-500 animate-pulse" />
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
}

function WaitingMessageBlock({ isDarkMode = false, isSameActor = false, fontSize = 14 }: WaitingMessageBlockProps) {
  const actor = ACTOR_PROFILES['system'];

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameActor
          ? `mt-4 border-t ${isDarkMode ? 'border-sky-800/50' : 'border-sky-200/50'} pt-4 first:mt-0 first:border-t-0 first:pt-0`
          : ''
      }`}>
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
          <div className={`mb-1 text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
            {actor.name}
          </div>
        )}

        <div className="space-y-0.5">
          <div className={`flex items-center gap-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            <div className="flex gap-1">
              <span className="size-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="size-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="size-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>Thinking...</span>
          </div>
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
