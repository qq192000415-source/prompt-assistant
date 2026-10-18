import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { ClipboardPaste, Copy, Film, ImageOff, RefreshCw, Search, Server, Star, Upload, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LibrarySwitch } from '../LibrarySwitch';
import type { LibraryMode } from '../../localState';
import {
  ALL_CATEGORIES,
  UNCATEGORIZED,
  categoryCounts,
  categoryOf,
  filterGroups,
  groupMaterials,
  type MaterialGroup,
  type MaterialMedia,
} from '../../materials/library';
import { useMaterialLibrary } from '../../materials/useMaterialLibrary';
import { MaterialDetailDialog } from './MaterialDetailDialog';
import { NasSettingsDialog, NasSettingsForm } from './NasSettings';

export const mediaSrc = (media: MaterialMedia) => `nas-media://media/${media.sha256}${media.ext}`;
export const previewSrc = (media: MaterialMedia) => (media.hasThumb ? `nas-media://thumbs/${media.sha256}.jpg` : mediaSrc(media));

type MaterialLibraryViewProps = {
  libraryMode: LibraryMode;
  onChangeLibraryMode: (mode: LibraryMode) => void;
  notify: (message: string) => void;
};

export function MaterialLibraryView({ libraryMode, onChangeLibraryMode, notify }: MaterialLibraryViewProps) {
  const controller = useMaterialLibrary(notify);
  const { status, library, busy } = controller;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const groups = useMemo(() => groupMaterials(library.items), [library.items]);
  const counts = useMemo(() => categoryCounts(groups), [groups]);
  const activeCategory = counts.some((entry) => entry.name === category) ? category : ALL_CATEGORIES;
  const visibleGroups = useMemo(() => filterGroups(groups, { query, category: activeCategory }), [groups, query, activeCategory]);
  const openGroup = openItemId ? groups.find((group) => group.items.some((item) => item.id === openItemId)) : undefined;
  const ready = status === 'ready';
  // 在某个分类下导入的素材直接归到这个分类。
  const importCategory = activeCategory === ALL_CATEGORIES || activeCategory === UNCATEGORIZED ? '' : activeCategory;

  // 在素材库里按 Ctrl+V：复制的是文件就按文件导入，是截图就导入剪贴板图片。输入框里的粘贴不拦。
  useEffect(() => {
    if (!ready) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') || openItemId || settingsOpen) return;
      const paths = [...(event.clipboardData?.files ?? [])].map(controller.pathForFile).filter(Boolean);
      if (paths.length) {
        event.preventDefault();
        void controller.importPaths(paths, importCategory);
      } else if (event.clipboardData?.types.some((type) => type.startsWith('image/'))) {
        event.preventDefault();
        void controller.importClipboard(importCategory);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [ready, openItemId, settingsOpen, importCategory, controller]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!ready || busy) return;
    const paths = [...event.dataTransfer.files].map(controller.pathForFile).filter(Boolean);
    if (paths.length) void controller.importPaths(paths, importCategory);
  };

  const copyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('提示词已复制');
    } catch {
      notify('复制失败，剪贴板被占用，请重试');
    }
  };

  const summary = ready
    ? `${groups.length} 组 · ${library.items.length} 个文件，存放在 NAS`
    : status === 'unconfigured'
      ? '还没有连接 NAS'
      : status === 'unavailable'
        ? '需要桌面版'
        : 'NAS';

  return (
    <main
      className={`materials-view ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        if (!ready || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="materials-header">
        <LibrarySwitch className="materials-switch" libraryMode={libraryMode} onChange={onChangeLibraryMode} />
        <div className="materials-title">
          <h1>素材库</h1>
          <span>{busy || summary}</span>
        </div>
        {ready && (
          <>
            <label className="materials-search">
              <Search size={16} aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、提示词、标签" aria-label="搜索素材" />
              {query && (
                <Button className="mini-clear" type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
                  <X size={13} />
                </Button>
              )}
            </label>
            <Button className="button ghost" type="button" disabled={Boolean(busy)} onClick={() => void controller.importClipboard(importCategory)}>
              <ClipboardPaste size={16} />
              粘贴
            </Button>
            <Button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => void controller.pickAndImport(importCategory)}>
              <Upload size={16} />
              导入
            </Button>
          </>
        )}
        {status !== 'unavailable' && status !== 'unconfigured' && (
          <Button className="icon-button" type="button" aria-label="NAS 连接设置" title="NAS 连接设置" onClick={() => setSettingsOpen(true)}>
            <Server size={16} />
          </Button>
        )}
      </header>

      {ready && library.items.length > 0 && (
        <div className="materials-tabs" role="tablist" aria-label="分类">
          {counts.map((entry) => (
            <button
              key={entry.name}
              className={`materials-tab ${entry.name === activeCategory ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={entry.name === activeCategory}
              onClick={() => setCategory(entry.name)}
            >
              {entry.name}
              <span>{entry.count}</span>
            </button>
          ))}
        </div>
      )}

      {status === 'unavailable' && (
        <div className="materials-state">
          <strong>素材库需要在桌面版里使用</strong>
          <span>素材存放在你的 NAS 上，由桌面版负责连接和读写。</span>
        </div>
      )}

      {status === 'loading' && (
        <div className="materials-state" aria-live="polite">
          <strong>正在读取 NAS 上的素材…</strong>
        </div>
      )}

      {status === 'unconfigured' && (
        <div className="materials-connect">
          <div>
            <strong>连接 NAS</strong>
            <span>素材只存放在你的 NAS 上，不会保存到这台电脑。填写 NAS 上专用文件夹的 WebDAV 地址和账户。</span>
          </div>
          <NasSettingsForm config={controller.config} busy={Boolean(busy)} onSubmit={controller.saveConfig} />
        </div>
      )}

      {status === 'error' && (
        <div className="materials-state is-error" role="alert">
          <strong>读取素材库失败</strong>
          <span>{controller.error}</span>
          <div className="materials-state-actions">
            <Button className="button primary compact" type="button" onClick={() => void controller.reload()}>
              <RefreshCw size={14} />
              重试
            </Button>
            <Button className="button ghost compact" type="button" onClick={() => setSettingsOpen(true)}>
              修改 NAS 连接
            </Button>
          </div>
        </div>
      )}

      {ready && library.items.length === 0 && (
        <div className="materials-state">
          <strong>还没有素材</strong>
          <span>导入图片或视频，也可以直接把文件拖进来，或者按 Ctrl+V 粘贴截图。</span>
          <div className="materials-state-actions">
            <Button className="button primary compact" type="button" disabled={Boolean(busy)} onClick={() => void controller.pickAndImport(importCategory)}>
              <Upload size={14} />
              导入素材
            </Button>
          </div>
        </div>
      )}

      {ready && library.items.length > 0 && visibleGroups.length === 0 && (
        <div className="materials-state">
          <strong>没有匹配的素材</strong>
          <span>换个关键词，或者查看全部分类。</span>
          <div className="materials-state-actions">
            <Button
              className="button ghost compact"
              type="button"
              onClick={() => {
                setQuery('');
                setCategory(ALL_CATEGORIES);
              }}
            >
              查看全部
            </Button>
          </div>
        </div>
      )}

      {ready && visibleGroups.length > 0 && (
        <div className="materials-grid">
          {visibleGroups.map((group) => (
            <MaterialCard
              key={group.id}
              group={group}
              onOpen={() => setOpenItemId(group.primary.id)}
              onCopyPrompt={() => void copyPrompt(group.primary.prompt)}
              onToggleFavorite={() => void controller.update(group.primary.id, { favorite: !group.primary.favorite })}
            />
          ))}
        </div>
      )}

      {dragging && (
        <div className="materials-drop-hint" aria-hidden="true">
          松开即可导入{importCategory ? `到「${importCategory}」` : ''}
        </div>
      )}

      {openGroup && openItemId && (
        <MaterialDetailDialog
          group={openGroup}
          itemId={openItemId}
          onSelectItem={setOpenItemId}
          categories={counts.map((entry) => entry.name).filter((name) => name !== ALL_CATEGORIES && name !== UNCATEGORIZED)}
          controller={controller}
          onCopyPrompt={(text) => void copyPrompt(text)}
          onClose={() => setOpenItemId(null)}
        />
      )}

      {settingsOpen && (
        <NasSettingsDialog
          config={controller.config}
          busy={Boolean(busy)}
          onSubmit={controller.saveConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function MaterialPreview({ media, className }: { media: MaterialMedia; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`${className} is-missing`}>
        <ImageOff size={20} aria-hidden="true" />
        读不到这个文件
      </span>
    );
  }
  if (media.kind === 'video') {
    // #t=0.1 让浏览器只取开头一小段当封面，不下载整个视频。
    return <video className={className} src={`${mediaSrc(media)}#t=0.1`} preload="metadata" muted playsInline onError={() => setFailed(true)} />;
  }
  return <img className={className} src={previewSrc(media)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

type MaterialCardProps = {
  group: MaterialGroup;
  onOpen: () => void;
  onCopyPrompt: () => void;
  onToggleFavorite: () => void;
};

function MaterialCard({ group, onOpen, onCopyPrompt, onToggleFavorite }: MaterialCardProps) {
  const item = group.primary;
  const title = item.title || item.media.name;
  return (
    <article className="material-card">
      <button className="material-card-open" type="button" onClick={onOpen} aria-label={`查看 ${title}`}>
        <MaterialPreview media={item.media} className="material-card-media" />
        {item.media.kind === 'video' && (
          <span className="material-card-badge is-left">
            <Film size={12} aria-hidden="true" />
            视频
          </span>
        )}
        {group.items.length > 1 && <span className="material-card-badge">{group.items.length} 张</span>}
      </button>
      <div className="material-card-body">
        <div className="material-card-title">
          <strong title={title}>{title}</strong>
          <span className={`material-chip ${item.category ? 'is-category' : ''}`}>{categoryOf(item)}</span>
        </div>
        <p className={item.prompt ? '' : 'is-empty'}>{item.prompt || '还没有提示词，点图片补上'}</p>
        {item.tags.length > 0 && (
          <div className="material-card-tags">
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="material-chip">
                {tag}
              </span>
            ))}
            {item.tags.length > 3 && <span className="material-chip">+{item.tags.length - 3}</span>}
          </div>
        )}
        <div className="material-card-actions">
          <Button className="button ghost compact" type="button" disabled={!item.prompt} onClick={onCopyPrompt}>
            <Copy size={14} />
            复制提示词
          </Button>
          <Button
            className={`icon-button material-favorite ${item.favorite ? 'is-on' : ''}`}
            type="button"
            aria-label={item.favorite ? '取消精选' : '设为精选'}
            aria-pressed={item.favorite}
            title={item.favorite ? '取消精选' : '设为精选'}
            onClick={onToggleFavorite}
          >
            <Star size={15} fill={item.favorite ? 'currentColor' : 'none'} />
          </Button>
        </div>
      </div>
    </article>
  );
}
