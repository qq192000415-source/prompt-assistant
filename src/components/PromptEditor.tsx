import { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import type { PromptDraft } from '../types';

type PromptEditorProps = {
  categories: string[];
  initialDraft: PromptDraft;
  mode: 'new' | 'edit';
  onClose: () => void;
  onSave: (draft: PromptDraft) => void;
};

export function PromptEditor({ categories, initialDraft, mode, onClose, onSave }: PromptEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [showCategoryOptions, setShowCategoryOptions] = useState(false);
  const canSave = draft.title.trim().length > 0 && draft.content.trim().length > 0;
  const categoryOptions = categories;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (canSave) {
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSave, draft, onClose, onSave]);

  const updateDraft = <Key extends keyof PromptDraft>(key: Key, value: PromptDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = () => {
    onSave({
      ...draft,
      title: draft.title.trim(),
      description: '',
      subcategory: '',
      tags: '',
      favorite: false,
    });
  };

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-label={mode === 'new' ? '新建提示词' : '编辑提示词'}>
      <Button className="modal-backdrop" type="button" aria-label="关闭编辑器" onClick={onClose} />
      <form
        className="editor-panel simple-editor-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) handleSave();
        }}
      >
        <div className="editor-header">
          <div>
            <h2>{mode === 'new' ? '新建提示词' : '编辑提示词'}</h2>
          </div>
          <Button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <div className="editor-grid simple-editor-grid">
          <label className="field">
            <span>主文件夹</span>
            <div className="folder-combobox">
              <input
                value={draft.category}
                onBlur={() => window.setTimeout(() => setShowCategoryOptions(false), 120)}
                onChange={(event) => {
                  updateDraft('category', event.target.value);
                  setShowCategoryOptions(true);
                }}
                onClick={() => setShowCategoryOptions(true)}
                onFocus={() => setShowCategoryOptions(true)}
                placeholder="选择或输入主文件夹"
              />
              <Button
                className="combo-toggle"
                type="button"
                aria-label="展开主文件夹列表"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowCategoryOptions((isOpen) => !isOpen)}
              >
                <ChevronDown size={16} />
              </Button>
              {showCategoryOptions && (
                <div className="combo-menu" role="listbox">
                  {categoryOptions.length ? (
                    categoryOptions.map((category) => (
                      <Button
                        key={category}
                        className={category === draft.category ? 'active' : ''}
                        type="button"
                        role="option"
                        aria-selected={category === draft.category}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          updateDraft('category', category);
                          setShowCategoryOptions(false);
                        }}
                      >
                        {category}
                      </Button>
                    ))
                  ) : (
                    <div className="combo-empty">保存后创建新文件夹</div>
                  )}
                </div>
              )}
            </div>
          </label>

          <label className="field">
            <span>子文件名称</span>
            <input
              value={draft.title}
              onChange={(event) => updateDraft('title', event.target.value)}
              placeholder="例如：代码审查助手"
              autoFocus
            />
          </label>
        </div>

        <label className="field content-field">
          <span>提示词内容</span>
          <Textarea
            value={draft.content}
            onChange={(event) => updateDraft('content', event.target.value)}
            placeholder="可以粘贴完整提示词，也可以直接输入"
          />
        </label>

        <div className="editor-footer">
          <Button className="button ghost" type="button" onClick={onClose}>
            取消
          </Button>
          <Button className="button primary" type="submit" disabled={!canSave}>
            {mode === 'new' ? '创建提示词' : '保存修改'}
          </Button>
        </div>
      </form>
    </div>
  );
}
