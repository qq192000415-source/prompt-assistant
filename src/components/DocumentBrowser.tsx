import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Copy, FilePlus } from 'lucide-react';
import { Button } from './ui/button';
import { documentKind, documentKindCounts, filterDocumentsByKind, sortDocuments, type DocumentKind, type DocumentSort } from '../documentBrowser';
import { loadDocumentPaneWidth, loadDocumentSort, saveDocumentPaneWidth, saveDocumentSort } from '../localState';
import { formatFileSize } from '../promptUtils';
import type { PromptItem } from '../types';
import { useDetailResize } from '../useDetailResize';

type DocumentBrowserProps = {
  title: string;
  query: string;
  documents: PromptItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onCopyFile: (item: PromptItem) => Promise<void>;
  // 右侧预览栏：App 传入带全部操作的 DocumentView；onReady 在文件下载到本机后调用，这一行就能拖出去了。
  renderPane: (item: PromptItem, onReady: (sha256: string) => void) => ReactNode;
};

const SORTS: Array<{ value: DocumentSort; label: string }> = [
  { value: 'recent', label: '最近添加' },
  { value: 'name', label: '名称' },
  { value: 'size', label: '大小' },
];

const shortDate = (iso: string | undefined) => {
  const date = new Date(iso ?? '');
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()}`;
};

// 文档库的文件夹视图：中间文件列表，右边预览和操作。和提示词库的「整条展开」卡片流区分开：
// 文档要做的是找到文件、复制文件或拖出去，所以一屏放下尽量多的文件，正文只在右边预览。
export function DocumentBrowser({ title, query, documents, selectedId, onSelect, onNew, onCopyFile, renderPane }: DocumentBrowserProps) {
  const api = window.promptAssistantDesktop?.documents;
  const [sort, setSort] = useState<DocumentSort>(loadDocumentSort);
  const [kind, setKind] = useState<DocumentKind | 'all'>('all');
  const { width: paneWidth, resizerProps } = useDetailResize(loadDocumentPaneWidth, saveDocumentPaneWidth);
  // 已经在本机的文件（按 sha256）：只有这些能直接拖出去，云端的要先选中下载。
  const [localShas, setLocalShas] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const kinds = useMemo(() => documentKindCounts(documents), [documents]);
  const activeKind = kind !== 'all' && kinds.some((entry) => entry.kind === kind) ? kind : 'all';
  const shown = useMemo(() => sortDocuments(filterDocumentsByKind(documents, activeKind), sort), [documents, activeKind, sort]);
  const selected = shown.find((item) => item.id === selectedId) ?? shown[0] ?? null;
  const totalSize = documents.reduce((sum, item) => sum + (item.file?.size ?? 0), 0);

  const shaKey = shown.map((item) => item.file?.sha256 ?? '').join(',');
  useEffect(() => {
    if (!api) return;
    let canceled = false;
    const shas = [...new Set(shown.map((item) => item.file?.sha256).filter((sha): sha is string => Boolean(sha)))];
    void Promise.all(shas.map(async (sha) => ((await api.has(sha).catch(() => false)) ? sha : null))).then((found) => {
      if (!canceled) setLocalShas(new Set(found.filter((sha): sha is string => sha !== null)));
    });
    return () => {
      canceled = true;
    };
  }, [shaKey]);

  const markLocal = (sha256: string) => setLocalShas((current) => (current.has(sha256) ? current : new Set(current).add(sha256)));

  const changeSort = (next: DocumentSort) => {
    setSort(next);
    saveDocumentSort(next);
  };

  const focusRow = (index: number) => {
    const row = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[index];
    row?.focus();
  };

  // 方向键换选中的文件，Enter 复制文件；焦点跟着选中的行走。
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selected || (event.target as HTMLElement).closest('button')) return;
    const index = shown.indexOf(selected);
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step) {
      event.preventDefault();
      const next = shown[Math.min(shown.length - 1, Math.max(0, index + step))];
      onSelect(next.id);
      focusRow(shown.indexOf(next));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void onCopyFile(selected);
    }
  };

  return (
    <section className="document-browser">
      <div className="document-browser-head">
        <div className="document-browser-title">
          <h1>{query.trim() ? `全局搜索：${query.trim()}` : title}</h1>
          <span>
            {documents.length} 个文件 · 共 {formatFileSize(totalSize)}
          </span>
        </div>
        <label className="document-sort">
          排序
          <select value={sort} onChange={(event) => changeSort(event.target.value as DocumentSort)}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <Button className="button primary" type="button" onClick={onNew}>
          <FilePlus size={16} />
          添加文档
        </Button>
      </div>

      {kinds.length > 1 && (
        <div className="document-kind-filter" role="radiogroup" aria-label="按类型筛选">
          {[{ kind: 'all' as const, label: '全部', count: documents.length }, ...kinds].map((entry) => (
            <button
              key={entry.kind}
              type="button"
              role="radio"
              aria-checked={activeKind === entry.kind}
              className={activeKind === entry.kind ? 'is-active' : ''}
              onClick={() => setKind(entry.kind)}
            >
              {entry.label}
              <small>{entry.count}</small>
            </button>
          ))}
        </div>
      )}

      <div className="document-browser-body" style={{ '--document-pane-width': `${paneWidth}px` } as CSSProperties}>
        <div className="document-list-scroll">
          <div ref={listRef} className="document-list" role="listbox" aria-label="文档" onKeyDown={onListKeyDown}>
            <div className="document-list-header" aria-hidden="true">
              <span>名称和配套指令</span>
              <span>大小</span>
              <span>添加</span>
              <span />
            </div>
            {shown.map((item) => {
              const file = item.file;
              const type = documentKind(file?.name ?? '');
              const isSelected = item.id === selected?.id;
              const local = Boolean(file && localShas.has(file.sha256));
              const instruction = item.description?.trim();
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  className={`document-row ${isSelected ? 'is-selected' : ''} ${local ? 'is-draggable' : ''}`}
                  draggable={local}
                  title={local ? `${file?.name}：拖到微信、QQ、邮件或文件夹里即可发送` : `${file?.name}：文件还在云端，选中后会自动下载，下载好就能拖出去`}
                  onClick={() => onSelect(item.id)}
                  onDragStart={(event) => {
                    event.preventDefault();
                    if (file) api?.startDrag(file.sha256, file.name);
                  }}
                >
                  <span className={`document-kind is-${type.kind}`} aria-label={type.label}>
                    {type.ext}
                  </span>
                  <span className="document-row-main">
                    <strong>{item.title}</strong>
                    <span className={instruction ? '' : 'is-empty'}>{instruction || '没有配套指令'}</span>
                  </span>
                  <span className="document-row-size">{file ? formatFileSize(file.size) : ''}</span>
                  <span className="document-row-date">{shortDate(file?.addedAt ?? item.createdAt)}</span>
                  <Button
                    className="icon-button document-row-copy"
                    type="button"
                    aria-label={`复制文件 ${item.title}`}
                    title="复制文件"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCopyFile(item);
                    }}
                  >
                    <Copy size={15} />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="document-browser-pane">
          {selected && (
            <>
              <Button
                className="canvas-detail-resizer"
                type="button"
                aria-label="拖动调整预览栏宽度"
                title="拖动调整预览栏宽度（也可以用左右方向键）"
                {...resizerProps}
              />
              {renderPane(selected, markLocal)}
            </>
          )}
        </div>
      </div>
      <p className="document-browser-hint">选中一行后按 ↑↓ 换文件，Enter 复制文件；本机已有的文件整行都能拖出去发送。</p>
    </section>
  );
}
