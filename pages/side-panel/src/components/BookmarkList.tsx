/* eslint-disable react/prop-types */
import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { FaTrash, FaPen, FaCheck, FaTimes } from 'react-icons/fa';
import { t } from '@extension/i18n';
import type { ResolvedQaUiTheme } from '@extension/storage';

interface Bookmark {
  id: number;
  title: string;
  content: string;
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string) => void;
  onBookmarkUpdateTitle?: (id: number, title: string) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
  isDarkMode?: boolean;
  qaUiTheme?: ResolvedQaUiTheme | null;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onBookmarkUpdateTitle,
  onBookmarkDelete,
  onBookmarkReorder,
  isDarkMode = false,
  qaUiTheme = null,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setEditTitle(bookmark.title);
  };

  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdateTitle && editTitle.trim()) {
      onBookmarkUpdateTitle(id, editTitle);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    // Add more transparent effect
    e.currentTarget.classList.add('opacity-25');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-25');
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    if (onBookmarkReorder) {
      onBookmarkReorder(draggedId, targetId);
    }
  };

  // Focus the input field when entering edit mode
  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  const cardStyle = {
    ...(qaUiTheme?.separatorColor ? { borderColor: qaUiTheme.separatorColor } : {}),
    ...(qaUiTheme?.inputSurface ? { backgroundColor: qaUiTheme.inputSurface } : {}),
  };

  const actionButtonStyle = {
    ...(qaUiTheme?.inputSurface ? { backgroundColor: qaUiTheme.inputSurface } : {}),
    ...(qaUiTheme?.inputText ? { color: qaUiTheme.inputText } : {}),
    ...(qaUiTheme?.inputBorder ? { borderColor: qaUiTheme.inputBorder, borderWidth: '1px' } : {}),
    ...(qaUiTheme?.chromeFontSizePx ? { fontSize: `${Math.max(qaUiTheme.chromeFontSizePx - 1, 11)}px` } : {}),
  } as CSSProperties;

  return (
    <div className="p-2">
      <h3
        className={`mb-3 font-medium ${qaUiTheme?.chromeFontSizePx ? '' : 'text-sm'} ${qaUiTheme?.headingText ? '' : isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}
        style={{
          ...(qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : {}),
          ...(qaUiTheme?.headingText ? { color: qaUiTheme.headingText } : {}),
        }}>
        {t('chat_bookmarks_header')}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {bookmarks.map(bookmark => (
          <div
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className={`group relative rounded-lg border p-3 ${
              isDarkMode
                ? 'border-slate-700 bg-slate-800 hover:bg-slate-700'
                : 'border-sky-100 bg-white hover:bg-sky-50'
            }`}
            style={cardStyle}>
            {editingId === bookmark.id ? (
              <div className="flex items-center">
                <input
                  ref={inputRef}
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className={`mr-2 grow rounded px-2 py-1 text-sm ${
                    isDarkMode ? 'border-slate-600 bg-slate-700 text-gray-200' : 'border-sky-100 bg-white text-gray-700'
                  } border`}
                  style={{
                    ...(qaUiTheme?.inputSurface ? { backgroundColor: qaUiTheme.inputSurface } : {}),
                    ...(qaUiTheme?.inputText ? { color: qaUiTheme.inputText } : {}),
                    ...(qaUiTheme?.inputBorder ? { borderColor: qaUiTheme.inputBorder } : {}),
                  }}
                />
                <button
                  onClick={() => handleSaveEdit(bookmark.id)}
                  className={`rounded p-1 ${
                    isDarkMode
                      ? 'bg-slate-700 text-green-400 hover:bg-slate-600'
                      : 'bg-white text-green-500 hover:bg-gray-100'
                  }`}
                  style={actionButtonStyle}
                  aria-label={t('chat_bookmarks_saveEdit')}
                  type="button">
                  <FaCheck size={14} />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className={`ml-1 rounded p-1 ${
                    isDarkMode
                      ? 'bg-slate-700 text-red-400 hover:bg-slate-600'
                      : 'bg-white text-red-500 hover:bg-gray-100'
                  }`}
                  style={actionButtonStyle}
                  aria-label={t('chat_bookmarks_cancelEdit')}
                  type="button">
                  <FaTimes size={14} />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onBookmarkSelect(bookmark.content)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onBookmarkSelect(bookmark.content);
                    }
                  }}
                  className="absolute inset-0 z-0 w-full cursor-pointer rounded-lg text-left"
                  aria-label={bookmark.title}>
                  <div className="flex h-full items-center p-3">
                    <div
                      className={`truncate pr-10 font-medium ${qaUiTheme?.chromeFontSizePx ? '' : 'text-sm'} ${qaUiTheme?.messageText ? '' : isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}
                      style={{
                        ...(qaUiTheme?.chromeFontSizePx ? { fontSize: `${qaUiTheme.chromeFontSizePx}px` } : {}),
                        ...(qaUiTheme?.messageText ? { color: qaUiTheme.messageText } : {}),
                      }}>
                      {bookmark.title}
                    </div>
                  </div>
                </button>
              </>
            )}

            {editingId !== bookmark.id && (
              <>
                {/* Edit button - top right */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleEditClick(bookmark);
                  }}
                  className={`absolute right-[28px] top-1/2 z-20 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                    isDarkMode
                      ? 'bg-slate-700 text-sky-400 hover:bg-slate-600'
                      : 'bg-white text-sky-500 hover:bg-gray-100'
                  }`}
                  style={actionButtonStyle}
                  aria-label={t('chat_bookmarks_edit')}
                  type="button">
                  <FaPen size={14} />
                </button>

                {/* Delete button - bottom right */}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (onBookmarkDelete) {
                      onBookmarkDelete(bookmark.id);
                    }
                  }}
                  className={`absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
                    isDarkMode
                      ? 'bg-slate-700 text-gray-400 hover:bg-slate-600'
                      : 'bg-white text-gray-500 hover:bg-gray-100'
                  }`}
                  style={actionButtonStyle}
                  aria-label={t('chat_bookmarks_delete')}
                  type="button">
                  <FaTrash size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookmarkList;
