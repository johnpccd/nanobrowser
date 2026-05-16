import { useState, useEffect, useRef } from 'react';
import { FaPlus, FaTrash, FaPen, FaGripVertical } from 'react-icons/fa';
import favoritesStorage, { type FavoritePrompt } from '@extension/storage/lib/prompt/favorites';
import { t } from '@extension/i18n';

interface QuickStartPromptsSettingsProps {
  isDarkMode?: boolean;
}

export const QuickStartPromptsSettings = ({ isDarkMode = false }: QuickStartPromptsSettingsProps) => {
  const [prompts, setPrompts] = useState<FavoritePrompt[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Load prompts on mount
  useEffect(() => {
    loadPrompts();
  }, []);

  // Focus input when entering edit/add mode
  useEffect(() => {
    if ((editingId !== null || isAdding) && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [editingId, isAdding]);

  const loadPrompts = async () => {
    try {
      const allPrompts = await favoritesStorage.getAllPrompts();
      setPrompts(allPrompts);
    } catch (error) {
      console.error('Failed to load prompts:', error);
    }
  };

  const handleAdd = () => {
    setIsAdding(true);
    setNewTitle('');
    setNewContent('');
  };

  const handleSaveAdd = async () => {
    if (!newTitle.trim() || !newContent.trim()) {
      return;
    }

    try {
      await favoritesStorage.addPrompt(newTitle.trim(), newContent.trim());
      setIsAdding(false);
      setNewTitle('');
      setNewContent('');
      await loadPrompts();
    } catch (error) {
      console.error('Failed to add prompt:', error);
    }
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewTitle('');
    setNewContent('');
  };

  const handleEdit = (prompt: FavoritePrompt) => {
    setEditingId(prompt.id);
    setEditTitle(prompt.title);
    setEditContent(prompt.content);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editTitle.trim() || !editContent.trim()) {
      return;
    }

    try {
      await favoritesStorage.updatePrompt(id, editTitle.trim(), editContent.trim());
      setEditingId(null);
      setEditTitle('');
      setEditContent('');
      await loadPrompts();
    } catch (error) {
      console.error('Failed to update prompt:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditContent('');
  };

  const handleDelete = async (id: number) => {
    if (window.confirm(t('options_prompts_confirmDelete'))) {
      try {
        await favoritesStorage.removePrompt(id);
        await loadPrompts();
      } catch (error) {
        console.error('Failed to delete prompt:', error);
      }
    }
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    e.currentTarget.classList.add('opacity-25');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-25');
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    try {
      await favoritesStorage.reorderPrompts(draggedId, targetId);
      await loadPrompts();
    } catch (error) {
      console.error('Failed to reorder prompts:', error);
    }
    setDraggedId(null);
  };

  return (
    <div
      className={`rounded-lg border ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-blue-100 bg-gray-50'} p-6 text-left shadow-sm`}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2
            className={`text-xl font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}
            style={{ color: isDarkMode ? '#e2e8f0' : '#1f2937' }}>
            {t('options_prompts_header')}
          </h2>
          <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('options_prompts_description')}
          </p>
        </div>
        {!isAdding && (
          <button
            type="button"
            onClick={handleAdd}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              isDarkMode ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-sky-500 text-white hover:bg-sky-600'
            }`}>
            <FaPlus size={14} />
            {t('options_prompts_add')}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {/* Add new prompt form */}
        {isAdding && (
          <div
            className={`rounded-lg border p-4 ${isDarkMode ? 'border-sky-600 bg-slate-700/50' : 'border-sky-300 bg-white'}`}>
            <div className="mb-3">
              <label
                htmlFor="new-prompt-title"
                className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_prompts_title')}
              </label>
              <input
                id="new-prompt-title"
                ref={titleInputRef}
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder={t('options_prompts_titlePlaceholder')}
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  isDarkMode
                    ? 'border-slate-600 bg-slate-700 text-gray-200 placeholder-gray-500'
                    : 'border-gray-300 bg-white text-gray-700 placeholder-gray-400'
                }`}
              />
            </div>
            <div className="mb-3">
              <label
                htmlFor="new-prompt-content"
                className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('options_prompts_content')}
              </label>
              <textarea
                id="new-prompt-content"
                ref={contentTextareaRef}
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder={t('options_prompts_contentPlaceholder')}
                rows={4}
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  isDarkMode
                    ? 'border-slate-600 bg-slate-700 text-gray-200 placeholder-gray-500'
                    : 'border-gray-300 bg-white text-gray-700 placeholder-gray-400'
                }`}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelAdd}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-slate-600 text-gray-300 hover:bg-slate-500'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}>
                {t('options_prompts_cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveAdd}
                disabled={!newTitle.trim() || !newContent.trim()}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  isDarkMode ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-sky-500 text-white hover:bg-sky-600'
                }`}>
                {t('options_prompts_save')}
              </button>
            </div>
          </div>
        )}

        {/* Existing prompts */}
        {prompts.length === 0 && !isAdding && (
          <div
            className={`rounded-lg border p-4 text-center ${isDarkMode ? 'border-slate-700 bg-slate-700/50 text-gray-400' : 'border-gray-200 bg-white text-gray-500'}`}>
            {t('options_prompts_empty')}
          </div>
        )}

        {prompts.map(prompt => (
          <div
            key={prompt.id}
            draggable={editingId !== prompt.id}
            onDragStart={e => handleDragStart(e, prompt.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, prompt.id)}
            className={`group relative rounded-lg border p-4 ${
              isDarkMode
                ? 'border-slate-700 bg-slate-700/50 hover:border-slate-600'
                : 'border-gray-200 bg-white hover:border-gray-300'
            } transition-colors`}>
            {editingId === prompt.id ? (
              <>
                <div className="mb-3">
                  <label
                    htmlFor={`edit-title-${prompt.id}`}
                    className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('options_prompts_title')}
                  </label>
                  <input
                    id={`edit-title-${prompt.id}`}
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className={`w-full rounded-md border px-3 py-2 text-sm ${
                      isDarkMode
                        ? 'border-slate-600 bg-slate-800 text-gray-200'
                        : 'border-gray-300 bg-white text-gray-700'
                    }`}
                  />
                </div>
                <div className="mb-3">
                  <label
                    htmlFor={`edit-content-${prompt.id}`}
                    className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('options_prompts_content')}
                  </label>
                  <textarea
                    id={`edit-content-${prompt.id}`}
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={4}
                    className={`w-full rounded-md border px-3 py-2 text-sm ${
                      isDarkMode
                        ? 'border-slate-600 bg-slate-800 text-gray-200'
                        : 'border-gray-300 bg-white text-gray-700'
                    }`}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      isDarkMode
                        ? 'bg-slate-600 text-gray-300 hover:bg-slate-500'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}>
                    {t('options_prompts_cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(prompt.id)}
                    disabled={!editTitle.trim() || !editContent.trim()}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                      isDarkMode ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-sky-500 text-white hover:bg-sky-600'
                    }`}>
                    {t('options_prompts_save')}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Drag handle */}
                <div
                  className={`absolute left-2 top-1/2 -translate-y-1/2 cursor-move opacity-0 transition-opacity group-hover:opacity-100 ${
                    isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  <FaGripVertical size={14} />
                </div>

                <div className="pl-6">
                  <h3 className={`mb-2 text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {prompt.title}
                  </h3>
                  <p className={`mb-3 whitespace-pre-wrap text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {prompt.content}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleEdit(prompt)}
                    className={`rounded p-1.5 transition-colors ${
                      isDarkMode ? 'text-sky-400 hover:bg-slate-600' : 'text-sky-600 hover:bg-gray-100'
                    }`}
                    aria-label={t('options_prompts_edit')}>
                    <FaPen size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(prompt.id)}
                    className={`rounded p-1.5 transition-colors ${
                      isDarkMode ? 'text-red-400 hover:bg-slate-600' : 'text-red-600 hover:bg-gray-100'
                    }`}
                    aria-label={t('options_prompts_delete')}>
                    <FaTrash size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
