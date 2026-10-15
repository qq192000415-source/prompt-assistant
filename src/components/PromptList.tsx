import type { ReactNode } from 'react';
import { BookOpen, FilePlus, FileText, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { isDocumentItem } from '../librarySync';
import type { LibraryMode } from '../localState';
import type { DisplayMode, PromptItem } from '../types';
import { FullPromptCard } from './PromptView';

type PromptListProps = {
  activeLabel: string;
  displayMode: DisplayMode;
  prompts: PromptItem[];
  query: string;
  selectedPrompt: PromptItem | null;
  total: number;
  libraryMode: LibraryMode;
  renderDocument: (item: PromptItem) => ReactNode;
  onNew: () => void;
  onCopy: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
  onDuplicate: (prompt: PromptItem) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateContent: (id: string, content: string) => boolean;
};

export function PromptList({
  activeLabel,
  displayMode,
  prompts,
  query,
  selectedPrompt,
  total,
  libraryMode,
  renderDocument,
  onNew,
  onCopy,
  onDelete,
  onDuplicate,
  onToggleFavorite,
  onUpdateContent,
}: PromptListProps) {
  const isDocuments = libraryMode === 'documents';
  const itemLabel = isDocuments ? '文档' : '提示词';
  const newLabel = isDocuments ? '添加文档' : '新建提示词';
  const NewIcon = isDocuments ? FilePlus : Plus;

  if (!prompts.length) {
    const emptyMessage =
      activeLabel === '最近使用'
        ? `复制或使用过的${itemLabel}会出现在这里。`
        : total
          ? '当前筛选没有匹配结果，可以换个关键词或分类。'
          : isDocuments
            ? 'Word、PDF、记事本、Markdown 都能放进来，之后一键复制文件发给别人。'
            : '先保存第一条提示词，之后就能搜索、收藏和快速复用。';

    return (
      <section className="empty-state">
        <div className="empty-icon">{isDocuments ? <FileText size={22} /> : <BookOpen size={22} />}</div>
        <h2>这里还没有{itemLabel}</h2>
        <p>{emptyMessage}</p>
        <Button className="button primary" type="button" onClick={onNew}>
          <NewIcon size={16} />
          {newLabel}
        </Button>
      </section>
    );
  }

  const normalizedQuery = query.trim();
  const isGlobalSearch = normalizedQuery.length > 0;
  const currentPrompt = selectedPrompt && prompts.some((prompt) => prompt.id === selectedPrompt.id) ? selectedPrompt : prompts[0];
  const promptsToRender = displayMode === 'single' ? [currentPrompt] : prompts;

  return (
    <section className="prompt-list-section prompt-document-section">
      <div className={`document-workbar ${isGlobalSearch ? 'is-searching' : ''}`}>
        <div>
          <p className="eyebrow">{isGlobalSearch ? 'Global Search' : isDocuments ? 'Document Library' : 'Prompt Library'}</p>
          <h1>{isGlobalSearch ? <>全局搜索：{normalizedQuery}</> : activeLabel}</h1>
          <span className="search-context">
            {isGlobalSearch
              ? `搜索全部${itemLabel}，按相关度排序。左侧分类只保留位置上下文。`
              : `${promptsToRender.length} 条${itemLabel}`}
          </span>
        </div>
        <Button className="button primary document-new-button" type="button" onClick={onNew}>
          <NewIcon size={16} />
          {newLabel}
        </Button>
      </div>
      <div className="document-flow">
        {promptsToRender.map((prompt) =>
          isDocumentItem(prompt) ? (
            renderDocument(prompt)
          ) : (
          <FullPromptCard
            key={prompt.id}
            prompt={prompt}
            onCopy={onCopy}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onToggleFavorite={onToggleFavorite}
            onUpdateContent={onUpdateContent}
          />
          ),
        )}
      </div>
    </section>
  );
}
