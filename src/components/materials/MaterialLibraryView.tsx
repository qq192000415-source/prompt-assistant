import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  FileText,
  Film,
  Image as ImageIcon,
  ImageOff,
  ListChecks,
  Package,
  RefreshCw,
  Search,
  Server,
  Star,
  Upload,
  X,
} from 'lucide-react';
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
import { BatchProgressPanel, CompressImagesDialog, CompressVideosDialog } from './BatchDialogs';
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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [batchDialog, setBatchDialog] = useState<'images' | 'videos' | null>(null);
  const [confirmingBatchDelete, setConfirmingBatchDelete] = useState(false);

  const groups = useMemo(() => groupMaterials(library.items), [library.items]);
  const counts = useMemo(() => categoryCounts(groups), [groups]);
  const activeCategory = counts.some((entry) => entry.name === category) ? category : ALL_CATEGORIES;
  const visibleGroups = useMemo(() => filterGroups(groups, { query, category: activeCategory }), [groups, query, activeCategory]);
  const openGroup = openItemId ? groups.find((group) => group.items.some((item) => item.id === openItemId)) : undefined;
  const ready = status === 'ready';
  // 选中按组算：一组效果图一起压缩、导出、删除。删掉或改动后不存在的组自动不算。
  const selectedGroups = groups.filter((group) => selected.has(group.id));
  const selectedItems = selectedGroups.flatMap((group) => group.items);
  const selectedImageIds = selectedItems.filter((item) => item.media.kind === 'image').map((item) => item.id);
  const selectedVideoIds = selectedItems.filter((item) => item.media.kind === 'video').map((item) => item.id);
  const toggleSelected = (groupId: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    setConfirmingBatchDelete(false);
  };
  const batchBusy = Boolean(busy) || Boolean(controller.progress);
  // 在某个分类下导入的素材直接归到这个分类。
  const importCategory = activeCategory === ALL_CATEGORIES || activeCategory === UNCATEGORIZED ? '' : activeCategory;

  // 在素材库里按 Ctrl+V：复制的是文件就按文件导入；截图、分享链接、提示词文字交给主进程识别。输入框里的粘贴不拦。
  useEffect(() => {
    if (!ready) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') || openItemId || settingsOpen || controller.busy) return;
      const paths = [...(event.clipboardData?.files ?? [])].map(controller.pathForFile).filter(Boolean);
      if (paths.length) {
        event.preventDefault();
        void controller.importPaths(paths, importCategory);
      } else if (event.clipboardData?.types.some((type) => type.startsWith('image/') || type === 'text/plain')) {
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
            {library.items.length > 0 && (
              <Button
                className={`button ghost ${selecting ? 'accent' : ''}`}
                type="button"
                aria-pressed={selecting}
                onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
              >
                <ListChecks size={16} />
                {selecting ? '完成' : '批量管理'}
              </Button>
            )}
            <Button
              className="button ghost"
              type="button"
              disabled={Boolean(busy)}
              title="粘贴截图、复制的文件、分享链接或提示词（也可以直接按 Ctrl+V）"
              onClick={() => void controller.importClipboard(importCategory)}
            >
              <ClipboardPaste size={16} />
              粘贴
            </Button>
            <ImportMenu
              disabled={batchBusy}
              onPickFiles={() => void controller.pickAndImport(importCategory)}
              onPickWord={() => void controller.importWord(importCategory)}
              onPickShare={() => void controller.importShare()}
            />
          </>
        )}
        {status !== 'unavailable' && status !== 'unconfigured' && (
          <Button className="icon-button" type="button" aria-label="NAS 连接设置" title="NAS 连接设置" onClick={() => setSettingsOpen(true)}>
            <Server size={16} />
          </Button>
        )}
      </header>

      {ready && selecting && (
        <div className="materials-batch-bar" role="toolbar" aria-label="批量操作">
          <span className="materials-batch-count">
            已选 {selectedGroups.length} 组 · {selectedItems.length} 个文件
          </span>
          <Button
            className="button ghost compact"
            type="button"
            onClick={() => setSelected(new Set([...selected, ...visibleGroups.map((group) => group.id)]))}
          >
            全选当前 {visibleGroups.length} 组
          </Button>
          {selectedGroups.length > 0 && (
            <Button className="button ghost compact" type="button" onClick={() => setSelected(new Set())}>
              清空
            </Button>
          )}
          <span className="materials-batch-spacer" />
          {confirmingBatchDelete ? (
            <>
              <span className="materials-batch-warning">从 NAS 删除这 {selectedItems.length} 个文件和记录？</span>
              <Button className="button ghost compact" type="button" onClick={() => setConfirmingBatchDelete(false)}>
                取消
              </Button>
              <Button
                className="button solid-danger compact"
                type="button"
                disabled={batchBusy}
                onClick={async () => {
                  if (await controller.remove(selectedItems.map((item) => item.id))) exitSelecting();
                }}
              >
                删除
              </Button>
            </>
          ) : (
            <>
              <Button
                className="button ghost compact"
                type="button"
                disabled={batchBusy || selectedGroups.length === 0}
                title="只给还没有提示词的组看图反推，已有提示词的跳过"
                onClick={() => void controller.aiBatchReverse(selectedItems.map((item) => item.id))}
              >
                AI 反推
              </Button>
              <Button
                className="button ghost compact"
                type="button"
                disabled={batchBusy || selectedGroups.length === 0}
                title="AI 给出的分类覆盖原分类，标签并入原有标签"
                onClick={() => void controller.aiBatchClassify(selectedItems.map((item) => item.id))}
              >
                AI 分类打标签
              </Button>
              <Button className="button ghost compact" type="button" disabled={batchBusy || selectedImageIds.length === 0} onClick={() => setBatchDialog('images')}>
                压缩图片{selectedImageIds.length ? ` ${selectedImageIds.length}` : ''}
              </Button>
              <Button className="button ghost compact" type="button" disabled={batchBusy || selectedVideoIds.length === 0} onClick={() => setBatchDialog('videos')}>
                压缩视频{selectedVideoIds.length ? ` ${selectedVideoIds.length}` : ''}
              </Button>
              <Button
                className="button ghost compact"
                type="button"
                disabled={batchBusy || selectedItems.length === 0}
                onClick={() => void controller.exportItems(selectedItems.map((item) => item.id))}
              >
                导出
              </Button>
              <Button
                className="button ghost compact"
                type="button"
                disabled={batchBusy || selectedItems.length === 0}
                title="打包成 ZIP，带提示词和分类，可以发给别人导入（素言也能导入）"
                onClick={() => void controller.exportShare(selectedItems.map((item) => item.id))}
              >
                导出分享包
              </Button>
              <Button className="button ghost danger compact" type="button" disabled={batchBusy || selectedItems.length === 0} onClick={() => setConfirmingBatchDelete(true)}>
                删除
              </Button>
            </>
          )}
        </div>
      )}

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
          <span>导入图片、视频、Word 图文或分享包；也可以把文件拖进来，或者按 Ctrl+V 粘贴截图和即梦、X 等网站的分享链接。</span>
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
              selected={selecting ? selected.has(group.id) : null}
              onOpen={() => (selecting ? toggleSelected(group.id) : setOpenItemId(group.primary.id))}
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
          getProxy={controller.getProxy}
          saveProxy={controller.saveProxy}
          ai={{
            getSettings: controller.aiGetSettings,
            saveSettings: controller.aiSaveSettings,
            listModels: controller.aiListModels,
            testModel: controller.aiTest,
          }}
          onSubmit={controller.saveConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {batchDialog === 'images' && (
        <CompressImagesDialog
          count={selectedImageIds.length}
          onClose={() => setBatchDialog(null)}
          onConfirm={(options) => {
            setBatchDialog(null);
            void controller.compressImages(selectedImageIds, options);
          }}
        />
      )}

      {batchDialog === 'videos' && (
        <CompressVideosDialog
          count={selectedVideoIds.length}
          ffmpegStatus={controller.ffmpegStatus}
          onInstallFfmpeg={controller.installFfmpeg}
          onClose={() => setBatchDialog(null)}
          onConfirm={(options) => {
            setBatchDialog(null);
            void controller.compressVideos(selectedVideoIds, options);
          }}
        />
      )}

      {controller.progress && <BatchProgressPanel progress={controller.progress} onCancel={controller.cancelBatch} />}
    </main>
  );
}

type ImportMenuProps = { disabled: boolean; onPickFiles: () => void; onPickWord: () => void; onPickShare: () => void };

function ImportMenu({ disabled, onPickFiles, onPickWord, onPickShare }: ImportMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="top-menu-item" ref={menuRef}>
      <Button className="button primary" type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Upload size={16} />
        导入
        <ChevronDown size={14} aria-hidden="true" />
      </Button>
      {open && (
        <div className="top-dropdown-menu materials-import-menu" role="menu">
          <button className="top-dropdown-item" type="button" role="menuitem" onClick={choose(onPickFiles)}>
            <ImageIcon size={15} />
            <span>图片和视频</span>
          </button>
          <button className="top-dropdown-item" type="button" role="menuitem" onClick={choose(onPickWord)}>
            <FileText size={15} />
            <span>Word 图文（.docx）</span>
          </button>
          <button className="top-dropdown-item" type="button" role="menuitem" onClick={choose(onPickShare)}>
            <Package size={15} />
            <span>分享包（.zip）</span>
          </button>
        </div>
      )}
    </div>
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
  // null 表示不在批量管理里；true/false 是否选中。
  selected: boolean | null;
  onOpen: () => void;
  onCopyPrompt: () => void;
  onToggleFavorite: () => void;
};

function MaterialCard({ group, selected, onOpen, onCopyPrompt, onToggleFavorite }: MaterialCardProps) {
  const item = group.primary;
  const title = item.title || item.media.name;
  const selecting = selected !== null;
  return (
    <article className={`material-card ${selected ? 'is-selected' : ''}`}>
      <button
        className="material-card-open"
        type="button"
        onClick={onOpen}
        aria-label={selecting ? `${selected ? '取消选择' : '选择'} ${title}` : `查看 ${title}`}
        aria-pressed={selecting ? selected : undefined}
      >
        <MaterialPreview media={item.media} className="material-card-media" />
        {selecting && (
          <span className={`material-card-check ${selected ? 'is-on' : ''}`} aria-hidden="true">
            {selected && <Check size={14} strokeWidth={3} />}
          </span>
        )}
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
