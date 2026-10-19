import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  Download,
  FilePlus,
  Folder,
  Import,
  LayoutList,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { LibraryMode } from '../localState';
import type { FileFormat } from '../promptStorage';
import { parseSubcategoryView } from '../promptUtils';
import type { PromptItem, ViewKey } from '../types';

const FILE_FORMAT_OPTIONS: Array<{ label: string; value: FileFormat }> = [
  { label: 'JSON', value: 'json' },
  { label: '记事本', value: 'txt' },
  { label: '表格', value: 'csv' },
];

const ROW_ACTION_MENU_WIDTH = 132;
const ROW_ACTION_MENU_EDGE_GAP = 8;
const ROW_ACTION_MENU_OFFSET = 5;
const ROW_ACTION_MENU_ITEM_HEIGHT = 30;
const ROW_ACTION_MENU_ITEM_GAP = 2;
const ROW_ACTION_MENU_PADDING_Y = 10;

export type MoveDirection = -1 | 1;
type RowActionMenuPosition = {
  top: number;
  left: number;
};

const getRowActionMenuPosition = (button: HTMLButtonElement, itemCount: number): RowActionMenuPosition => {
  const rect = button.getBoundingClientRect();
  const menuHeight = ROW_ACTION_MENU_PADDING_Y + itemCount * ROW_ACTION_MENU_ITEM_HEIGHT + Math.max(0, itemCount - 1) * ROW_ACTION_MENU_ITEM_GAP;
  const preferredTop = rect.bottom + ROW_ACTION_MENU_OFFSET;
  const maxTop = window.innerHeight - menuHeight - ROW_ACTION_MENU_EDGE_GAP;
  const preferredLeft = rect.right - ROW_ACTION_MENU_WIDTH;
  const maxLeft = window.innerWidth - ROW_ACTION_MENU_WIDTH - ROW_ACTION_MENU_EDGE_GAP;

  return {
    top: Math.max(ROW_ACTION_MENU_EDGE_GAP, Math.min(preferredTop, maxTop)),
    left: Math.max(ROW_ACTION_MENU_EDGE_GAP, Math.min(preferredLeft, maxLeft)),
  };
};

type SidebarProps = {
  activeView: ViewKey;
  categories: string[];
  cloudEmail: string | null;
  cloudEnabled: boolean;
  cloudStatus: string;
  deletedCount: number;
  exportFormat: FileFormat;
  favoriteCount: number;
  importFormat: FileFormat;
  isGlobalSearchActive: boolean;
  libraryMode: LibraryMode;
  query: string;
  recentCount: number;
  onAddCategory: () => void;
  onAddSubcategory: (category: string) => void;
  onChangeView: (view: ViewKey) => void;
  onClose: () => void;
  onCreatePrompt: () => void;
  onDeleteCategory: (category: string) => void;
  onDeletePrompt: (id: string) => void;
  onExport: (format: FileFormat) => void | Promise<void>;
  onExportFormatChange: (format: FileFormat) => void;
  onImport: () => void;
  onImportFormatChange: (format: FileFormat) => void;
  onManualSync: () => void | Promise<void>;
  onMoveCategory: (category: string, direction: MoveDirection) => void;
  onMovePrompt: (id: string, direction: MoveDirection) => void;
  onOpenAuth: () => void;
  onRenameCategory: (category: string, nextName: string) => boolean;
  onRenamePrompt: (id: string, nextTitle: string) => boolean;
  onSelectPrompt: (prompt: PromptItem) => void;
  onSignOut: () => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  open: boolean;
  prompts: PromptItem[];
  selectedId: string | null;
  setQuery: (query: string) => void;
  width: number;
};

export function Sidebar({
  activeView,
  categories,
  cloudEmail,
  cloudEnabled,
  cloudStatus,
  deletedCount,
  exportFormat,
  favoriteCount,
  importFormat,
  isGlobalSearchActive,
  libraryMode,
  query,
  recentCount,
  onAddCategory,
  onAddSubcategory,
  onChangeView,
  onClose,
  onCreatePrompt,
  onDeleteCategory,
  onDeletePrompt,
  onExport,
  onExportFormatChange,
  onImport,
  onImportFormatChange,
  onManualSync,
  onMoveCategory,
  onMovePrompt,
  onOpenAuth,
  onRenameCategory,
  onRenamePrompt,
  onSelectPrompt,
  onSignOut,
  onStartResize,
  open,
  prompts,
  selectedId,
  setQuery,
  width,
}: SidebarProps) {
  const libraryLabel = libraryMode === 'documents' ? '文档' : '提示词';
  const categoryCount = (category: string) => prompts.filter((prompt) => prompt.category === category).length;
  const activeSubcategory = parseSubcategoryView(activeView);
  const activeCategory = activeView.startsWith('category:') ? activeView.slice('category:'.length) : activeSubcategory?.category ?? null;
  const [openCategory, setOpenCategory] = useState<string | null>(activeCategory);
  const categoryPrompts = (category: string) => prompts.filter((prompt) => prompt.category === category);
  const cloudLabel = cloudEmail ? '云端在线' : cloudEnabled ? '登录' : '未配置云端';

  useEffect(() => {
    setOpenCategory(activeCategory);
  }, [activeCategory]);

  return (
    <>
      {open && <Button className="sidebar-scrim" type="button" aria-label="关闭导航" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} style={{ flexBasis: width, width }}>
        <div className="sidebar-header">
          <strong>{libraryLabel}</strong>
          <LibraryFileMenu
            exportFormat={exportFormat}
            importFormat={importFormat}
            onExport={onExport}
            onExportFormatChange={onExportFormatChange}
            onImport={onImport}
            onImportFormatChange={onImportFormatChange}
          />
        </div>

        <div className="sidebar-primary-actions">
          <Button className="button ghost sidebar-action-button" type="button" onClick={onAddCategory}>
            <Plus size={16} />
            添加分类
          </Button>
          <Button className="button primary sidebar-action-button" type="button" onClick={onCreatePrompt}>
            {libraryMode === 'documents' ? <FilePlus size={16} /> : <Plus size={16} />}
            {libraryMode === 'documents' ? '添加文档' : '新建提示词'}
          </Button>
        </div>

        <label className={`library-search-box ${query.trim() ? 'is-global-search' : ''}`}>
          <Search size={15} />
          <span className="search-scope-chip">全局</span>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索全部${libraryLabel}`} aria-label={`搜索${libraryLabel}`} />
          {query && (
            <Button className="mini-clear" type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
              <X size={13} />
            </Button>
          )}
        </label>

        <nav className="nav-group view-nav" aria-label="视图">
          <ViewNavItem active={activeView === 'all'} icon={<LayoutList size={15} />} label="全部" meta={prompts.length} onClick={() => onChangeView('all')} />
          <ViewNavItem active={activeView === 'favorites'} icon={<Star size={15} />} label="收藏" meta={favoriteCount} onClick={() => onChangeView('favorites')} />
          <ViewNavItem active={activeView === 'recent'} icon={<Clock3 size={15} />} label="最近使用" meta={recentCount} onClick={() => onChangeView('recent')} />
          <ViewNavItem active={activeView === 'trash'} icon={<RotateCcw size={15} />} label="删除记录" meta={deletedCount} onClick={() => onChangeView('trash')} />
        </nav>

        <div className="sidebar-section-label">分类</div>
        <nav className="nav-group categories" aria-label="分类">
          {categories.map((category, categoryIndex) => {
            const categoryView = `category:${category}` as ViewKey;
            const active = activeView === categoryView;
            const expanded = openCategory === category;
            const directPrompts = categoryPrompts(category);
            const toggleCategory = () => {
              if (expanded && activeCategory === category) {
                setOpenCategory(null);
                return;
              }

              setOpenCategory(category);
              onChangeView(categoryView);
            };

            return (
              <div key={category} className="category-tree">
                <CategoryNavItem
                  active={active}
                  canMoveDown={categoryIndex < categories.length - 1}
                  canMoveUp={categoryIndex > 0}
                  count={categoryCount(category)}
                  expanded={expanded}
                  isSearchContext={isGlobalSearchActive && (active || activeCategory === category)}
                  name={category}
                  onAddSubcategory={() => onAddSubcategory(category)}
                  onDelete={() => onDeleteCategory(category)}
                  onMoveDown={() => onMoveCategory(category, 1)}
                  onMoveUp={() => onMoveCategory(category, -1)}
                  onOpen={toggleCategory}
                  onRename={(nextName) => onRenameCategory(category, nextName)}
                />
                {expanded &&
                  directPrompts.map((prompt, promptIndex) => (
                    <PromptTreeItem
                      key={prompt.id}
                      active={prompt.id === selectedId}
                      canMoveDown={promptIndex < directPrompts.length - 1}
                      canMoveUp={promptIndex > 0}
                      isSearchContext={isGlobalSearchActive && prompt.id === selectedId}
                      nested
                      prompt={prompt}
                      onDelete={() => onDeletePrompt(prompt.id)}
                      onMoveDown={() => onMovePrompt(prompt.id, 1)}
                      onMoveUp={() => onMovePrompt(prompt.id, -1)}
                      onOpen={() => onSelectPrompt(prompt)}
                      onRename={(nextTitle) => onRenamePrompt(prompt.id, nextTitle)}
                    />
                  ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-cloud-panel">
          <div className={`sidebar-cloud-status ${cloudEmail ? 'is-online' : ''}`}>
            <span className="cloud-dot" aria-hidden="true" />
            <span>{cloudLabel}</span>
            {cloudEmail && <small>{cloudEmail}</small>}
            {!cloudEmail && !cloudEnabled && <small>{cloudStatus}</small>}
          </div>
          {cloudEmail ? (
            <div className="sidebar-cloud-actions">
              <Button className="sidebar-cloud-action" type="button" onClick={() => void onManualSync()}>
                <Cloud size={15} />
                同步
              </Button>
              <Button className="sidebar-cloud-action" type="button" onClick={onSignOut}>
                <LogOut size={15} />
                退出
              </Button>
            </div>
          ) : (
            <Button className="sidebar-login-button" type="button" disabled={!cloudEnabled} onClick={onOpenAuth}>
              <LogIn size={15} />
              登录云端
            </Button>
          )}
        </div>

        <Button
          className="sidebar-resizer"
          type="button"
          aria-label="拖动调整侧边栏宽度"
          title="拖动调整侧边栏宽度"
          onPointerDown={onStartResize}
        />
      </aside>
    </>
  );
}

type ViewNavItemProps = {
  active: boolean;
  icon: ReactNode;
  label: string;
  meta: number;
  onClick: () => void;
};

// 四个视图横排一行，只放图标和数字，名称在悬停提示和读屏文字里，分类树不再被挤到下面。
function ViewNavItem({ active, icon, label, meta, onClick }: ViewNavItemProps) {
  return (
    <Button
      className={`view-nav-item ${active ? 'active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={`${label}，${meta} 条`}
      title={label}
      onClick={onClick}
    >
      {icon}
      <small>{meta}</small>
    </Button>
  );
}

type LibraryFileMenuProps = {
  exportFormat: FileFormat;
  importFormat: FileFormat;
  onExport: (format: FileFormat) => void | Promise<void>;
  onExportFormatChange: (format: FileFormat) => void;
  onImport: () => void;
  onImportFormatChange: (format: FileFormat) => void;
};

// 导入导出不常用，收进侧栏标题旁的小菜单。
function LibraryFileMenu({ exportFormat, importFormat, onExport, onExportFormatChange, onImport, onImportFormatChange }: LibraryFileMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const runMenuAction = (action: () => void | Promise<void>) => {
    setOpen(false);
    void action();
  };

  return (
    <div className="library-file-menu" ref={menuRef}>
      <Button className="button ghost compact" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        导入 / 导出
        <ChevronDown size={13} />
      </Button>
      {open && (
        <div className="top-dropdown-menu" role="menu">
          <Button className="top-dropdown-item" type="button" role="menuitem" onClick={() => runMenuAction(onImport)}>
            <Import size={15} />
            导入文件
          </Button>
          <label className="top-format-row">
            <span>导入格式</span>
            <select
              className="format-select"
              aria-label="选择导入格式"
              value={importFormat}
              onChange={(event) => onImportFormatChange(event.target.value as FileFormat)}
            >
              {FILE_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button className="top-dropdown-item" type="button" role="menuitem" onClick={() => runMenuAction(() => onExport(exportFormat))}>
            <Download size={15} />
            导出文件
          </Button>
          <label className="top-format-row">
            <span>导出格式</span>
            <select
              className="format-select"
              aria-label="选择导出格式"
              value={exportFormat}
              onChange={(event) => onExportFormatChange(event.target.value as FileFormat)}
            >
              {FILE_FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

type CategoryNavItemProps = {
  active: boolean;
  canMoveDown: boolean;
  canMoveUp: boolean;
  count: number;
  expanded: boolean;
  isSearchContext: boolean;
  name: string;
  onAddSubcategory: () => void;
  onDelete: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onOpen: () => void;
  onRename: (nextName: string) => boolean;
};

function CategoryNavItem({
  active,
  canMoveDown,
  canMoveUp,
  count,
  expanded,
  isSearchContext,
  name,
  onAddSubcategory,
  onDelete,
  onMoveDown,
  onMoveUp,
  onOpen,
  onRename,
}: CategoryNavItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [actionMenuPosition, setActionMenuPosition] = useState<RowActionMenuPosition | null>(null);
  const [draftName, setDraftName] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftName(name);
    }
  }, [name, isEditing]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isActionMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setIsActionMenuOpen(false);
      }
    };

    const closeActionMenu = () => setIsActionMenuOpen(false);

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', closeActionMenu);
    window.addEventListener('scroll', closeActionMenu, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', closeActionMenu);
      window.removeEventListener('scroll', closeActionMenu, true);
    };
  }, [isActionMenuOpen]);

  const commitRename = () => {
    const success = onRename(draftName);
    if (success) {
      setIsEditing(false);
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const cancelRename = () => {
    setDraftName(name);
    setIsEditing(false);
  };

  const toggleActionMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isActionMenuOpen) {
      setIsActionMenuOpen(false);
      return;
    }

    setActionMenuPosition(getRowActionMenuPosition(event.currentTarget, 5));
    setIsActionMenuOpen(true);
  };

  return (
    <div className={`category-item ${active ? 'active' : ''} ${isSearchContext ? 'search-context' : ''}`}>
      {isEditing ? (
        <form
          className="category-edit-form category-parent-edit"
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <span className={`category-chevron ${expanded ? 'expanded' : ''}`}>
            <ChevronRight size={14} />
          </span>
          <span className="nav-icon">
            <Folder size={16} />
          </span>
          <input
            ref={inputRef}
            value={draftName}
            onBlur={commitRename}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
          <span className="nav-meta">{count}</span>
        </form>
      ) : (
        <Button
          className="category-open category-parent-open"
          type="button"
          aria-expanded={expanded}
          onClick={onOpen}
        >
          <span className={`category-chevron ${expanded ? 'expanded' : ''}`}>
            <ChevronRight size={14} />
          </span>
          <span className="nav-icon">
            <Folder size={16} />
          </span>
          <span className="nav-label">
            {name}
            {isSearchContext && <Badge className="context-badge">原位置</Badge>}
          </span>
          <span className="nav-meta">{count}</span>
        </Button>
      )}
      <div className="category-actions row-actions">
        <Button
          className="mini-action"
          type="button"
          aria-label={`${name}操作`}
          title="操作"
          onClick={toggleActionMenu}
        >
          <MoreHorizontal size={14} />
        </Button>
        {isActionMenuOpen && actionMenuPosition && createPortal(
          <div
            className="row-action-menu"
            ref={actionMenuRef}
            style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
          >
            <Button
              className="row-action-menu-item"
              type="button"
              onClick={() => {
                onAddSubcategory();
                setIsActionMenuOpen(false);
              }}
            >
              <Plus size={13} />
              新增子文件
            </Button>
            <Button
              className="row-action-menu-item"
              type="button"
              disabled={!canMoveUp}
              onClick={() => {
                onMoveUp();
                setIsActionMenuOpen(false);
              }}
            >
              <ArrowUp size={13} />
              上移
            </Button>
            <Button
              className="row-action-menu-item"
              type="button"
              disabled={!canMoveDown}
              onClick={() => {
                onMoveDown();
                setIsActionMenuOpen(false);
              }}
            >
              <ArrowDown size={13} />
              下移
            </Button>
            <Button
              className="row-action-menu-item"
              type="button"
              onClick={() => {
                setIsEditing(true);
                setIsActionMenuOpen(false);
              }}
            >
              <Pencil size={13} />
              重命名
            </Button>
            <Button
              className="row-action-menu-item danger-menu-item"
              type="button"
              onClick={() => {
                onDelete();
                setIsActionMenuOpen(false);
              }}
            >
              <Trash2 size={13} />
              删除
            </Button>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

type PromptTreeItemProps = {
  active: boolean;
  canMoveDown: boolean;
  canMoveUp: boolean;
  isSearchContext: boolean;
  nested?: boolean;
  onDelete: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onOpen: () => void;
  onRename: (nextTitle: string) => boolean;
  prompt: PromptItem;
};

function PromptTreeItem({
  active,
  canMoveDown,
  canMoveUp,
  isSearchContext,
  nested = false,
  onDelete,
  onMoveDown,
  onMoveUp,
  onOpen,
  onRename,
  prompt,
}: PromptTreeItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [actionMenuPosition, setActionMenuPosition] = useState<RowActionMenuPosition | null>(null);
  const [draftTitle, setDraftTitle] = useState(prompt.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftTitle(prompt.title);
    }
  }, [isEditing, prompt.id, prompt.title]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isActionMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setIsActionMenuOpen(false);
      }
    };

    const closeActionMenu = () => setIsActionMenuOpen(false);

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', closeActionMenu);
    window.addEventListener('scroll', closeActionMenu, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', closeActionMenu);
      window.removeEventListener('scroll', closeActionMenu, true);
    };
  }, [isActionMenuOpen]);

  const startRename = () => {
    setDraftTitle(prompt.title);
    setIsEditing(true);
  };

  const cancelRename = () => {
    setDraftTitle(prompt.title);
    setIsEditing(false);
  };

  const commitRename = () => {
    if (!draftTitle.trim()) {
      cancelRename();
      return;
    }

    const saved = onRename(draftTitle);
    if (saved) {
      setIsEditing(false);
    }
  };

  const toggleActionMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (isActionMenuOpen) {
      setIsActionMenuOpen(false);
      return;
    }

    setActionMenuPosition(getRowActionMenuPosition(event.currentTarget, 4));
    setIsActionMenuOpen(true);
  };

  return (
    <div className={`prompt-tree-item-row ${nested ? 'nested' : ''} ${active ? 'active' : ''} ${isSearchContext ? 'search-context' : ''}`}>
      {isEditing ? (
        <form
          className="prompt-tree-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <span className="prompt-tree-dot" />
          <input
            ref={inputRef}
            value={draftTitle}
            onBlur={commitRename}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelRename();
              }
            }}
          />
        </form>
      ) : (
        <Button className="prompt-tree-item" type="button" onClick={onOpen}>
          <span className="prompt-tree-dot" />
          <span className="prompt-tree-title">{prompt.title}</span>
        </Button>
      )}
      <div className="prompt-tree-actions row-actions">
        <Button
          className="mini-action"
          type="button"
          aria-label={`${prompt.title}操作`}
          title="操作"
          onClick={toggleActionMenu}
        >
          <MoreHorizontal size={14} />
        </Button>
        {isActionMenuOpen && actionMenuPosition && createPortal(
          <div
            className="row-action-menu"
            ref={actionMenuRef}
            style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
          >
            <Button
              className="row-action-menu-item"
              type="button"
              disabled={!canMoveUp}
              onClick={() => {
                onMoveUp();
                setIsActionMenuOpen(false);
              }}
            >
              <ArrowUp size={13} />
              上移
            </Button>
            <Button
              className="row-action-menu-item"
              type="button"
              disabled={!canMoveDown}
              onClick={() => {
                onMoveDown();
                setIsActionMenuOpen(false);
              }}
            >
              <ArrowDown size={13} />
              下移
            </Button>
            <Button
              className="row-action-menu-item"
              type="button"
              onClick={() => {
                startRename();
                setIsActionMenuOpen(false);
              }}
            >
              <Pencil size={13} />
              重命名
            </Button>
            <Button
              className="row-action-menu-item danger-menu-item"
              type="button"
              onClick={() => {
                onDelete();
                setIsActionMenuOpen(false);
              }}
            >
              <Trash2 size={13} />
              删除
            </Button>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}
