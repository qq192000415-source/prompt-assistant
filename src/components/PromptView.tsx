import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Clock3, Copy, FileJson, Folder, Heart, Pencil, Tag, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { fillVariables, formatDate, parseVariables } from '../promptUtils';
import type { PromptItem } from '../types';

type FullPromptCardProps = {
  prompt: PromptItem;
  onCopy: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
  onDuplicate: (prompt: PromptItem) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateContent: (id: string, content: string) => boolean;
};

export function FullPromptCard({ prompt, onCopy, onDelete, onDuplicate, onToggleFavorite, onUpdateContent }: FullPromptCardProps) {
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [draftContent, setDraftContent] = useState(prompt.content);
  const contentEditorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditingContent) {
      setDraftContent(prompt.content);
    }
  }, [prompt.content, prompt.id, isEditingContent]);

  useEffect(() => {
    if (isEditingContent) {
      contentEditorRef.current?.focus();
    }
  }, [isEditingContent]);

  const startContentEdit = () => {
    setDraftContent(prompt.content);
    setIsEditingContent(true);
  };

  const cancelContentEdit = () => {
    setDraftContent(prompt.content);
    setIsEditingContent(false);
  };

  const saveContentEdit = () => {
    const saved = onUpdateContent(prompt.id, draftContent);
    if (saved) {
      setIsEditingContent(false);
    }
  };

  return (
    <article className="full-prompt-card">
      <header className="full-prompt-header">
        <div className="full-prompt-title">
          <h2>{prompt.title}</h2>
        </div>
        <div className="preview-actions">
          <Button className="button ghost compact top-edit-button" type="button" onClick={startContentEdit}>
            <Pencil size={16} />
            编辑
          </Button>
          <Button className="button primary compact top-copy-button" type="button" onClick={() => onCopy(prompt.id, prompt.content)}>
            <Copy size={16} />
            复制提示词
          </Button>
          <Button
            className={`icon-button ${prompt.favorite ? 'is-active' : ''}`}
            type="button"
            title={prompt.favorite ? '取消收藏' : '收藏'}
            onClick={() => onToggleFavorite(prompt.id)}
          >
            <Heart size={16} />
          </Button>
          <Button className="icon-button" type="button" title="复制为副本" onClick={() => onDuplicate(prompt)}>
            <Copy size={16} />
          </Button>
          <Button className="icon-button danger-icon" type="button" title="删除" onClick={() => onDelete(prompt.id)}>
            <Trash2 size={16} />
          </Button>
        </div>
      </header>

      <div className={`full-prompt-content ${isEditingContent ? 'is-editing' : ''}`}>
        {isEditingContent ? (
          <>
            <Textarea
              ref={contentEditorRef}
              className="inline-content-editor"
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelContentEdit();
                }

                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  saveContentEdit();
                }
              }}
            />
            <div className="inline-edit-actions">
              <Button className="button ghost" type="button" onClick={cancelContentEdit}>
                取消
              </Button>
              <Button className="button primary" type="button" onClick={saveContentEdit}>
                保存修改
              </Button>
            </div>
          </>
        ) : (
          <pre onDoubleClick={startContentEdit} title="双击编辑正文">
            {prompt.content}
          </pre>
        )}
      </div>
    </article>
  );
}

type PromptDetailProps = {
  prompt: PromptItem;
  onCopy: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
  onDuplicate: (prompt: PromptItem) => void;
  onEdit: (prompt: PromptItem) => void;
  onToggleFavorite: (id: string) => void;
};

export function PromptDetail({ prompt, onCopy, onDelete, onDuplicate, onEdit, onToggleFavorite }: PromptDetailProps) {
  const variables = useMemo(() => parseVariables(prompt.content), [prompt.content]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues({});
  }, [prompt.id]);

  const filledContent = fillVariables(prompt.content, values);
  const hasVariables = variables.length > 0;

  return (
    <section className="detail-view">
      <div className="detail-actions">
        <Button className="button primary" type="button" onClick={() => onCopy(prompt.id, filledContent)}>
          <Copy size={16} />
          复制提示词
        </Button>
        <Button
          className={`button ghost ${prompt.favorite ? 'accent' : ''}`}
          type="button"
          onClick={() => onToggleFavorite(prompt.id)}
        >
          <Heart size={16} />
          {prompt.favorite ? '已收藏' : '收藏'}
        </Button>
        <Button className="button ghost" type="button" onClick={() => onEdit(prompt)}>
          <Pencil size={16} />
          编辑
        </Button>
        <Button className="button ghost" type="button" onClick={() => onDuplicate(prompt)}>
          <Copy size={16} />
          复制为副本
        </Button>
        <Button className="button ghost danger" type="button" onClick={() => onDelete(prompt.id)}>
          <Trash2 size={16} />
          删除
        </Button>
      </div>

      <div className="detail-meta">
        <span>
          <Folder size={15} />
          {prompt.subcategory ? `${prompt.category} / ${prompt.subcategory}` : prompt.category}
        </span>
        <span>
          <Clock3 size={15} />
          最近使用：{formatDate(prompt.lastUsedAt)}
        </span>
      </div>

      {prompt.description && <p className="detail-description">{prompt.description}</p>}

      <div className="tag-row">
        {prompt.tags.map((tag) => (
          <span key={tag} className="tag-chip large">
            <Tag size={13} />
            {tag}
          </span>
        ))}
      </div>

      {hasVariables && (
        <div className="variable-panel">
          <div className="panel-heading">
            <div className="panel-title">
              <FileJson size={16} />
              变量填充
            </div>
            <Button className="button ghost compact" type="button" onClick={() => setValues({})}>
              清空
            </Button>
          </div>
          <div className="variable-grid">
            {variables.map((variable) => (
              <label key={variable} className="field">
                <span>{variable}</span>
                <input
                  value={values[variable] ?? ''}
                  onChange={(event) => setValues((current) => ({ ...current, [variable]: event.target.value }))}
                  placeholder={`填写${variable}`}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="content-panel">
        <div className="panel-heading">
          <div className="panel-title">
            <BookOpen size={16} />
            提示词正文
          </div>
          <Button className="button ghost compact" type="button" onClick={() => onEdit(prompt)}>
            编辑
          </Button>
        </div>
        <pre>{filledContent}</pre>
      </div>

      <div className="copy-bar">
        <Button className="button primary" type="button" onClick={() => onCopy(prompt.id, filledContent)}>
          <Copy size={16} />
          复制提示词
        </Button>
      </div>
    </section>
  );
}
