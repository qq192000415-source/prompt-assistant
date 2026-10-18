import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Clock3, Download, FilePlus, Import, LayoutList, Moon, RotateCcw, Search, Star, Sun, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { ThemeMode } from '../lib/theme';
import type { FileFormat } from '../promptStorage';
import type { ViewKey } from '../types';

const FILE_FORMAT_OPTIONS: Array<{ label: string; value: FileFormat }> = [
  { label: 'JSON', value: 'json' },
  { label: '记事本', value: 'txt' },
  { label: '表格', value: 'csv' },
];

type TopMenuBarProps = {
  activeView: ViewKey;
  deletedCount: number;
  exportFormat: FileFormat;
  favoriteCount: number;
  importFormat: FileFormat;
  promptCount: number;
  query: string;
  showSearch: boolean;
  searchLabel: string;
  recentCount: number;
  onChangeView: (view: ViewKey) => void;
  onExport: (format: FileFormat) => void | Promise<void>;
  onExportFormatChange: (format: FileFormat) => void;
  onImport: () => void;
  onAddDocuments: () => void;
  onImportFormatChange: (format: FileFormat) => void;
  onOpenSettings: () => void;
  setQuery: (query: string) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
};

export function TopMenuBar({
  activeView,
  deletedCount,
  exportFormat,
  favoriteCount,
  importFormat,
  promptCount,
  query,
  showSearch,
  searchLabel,
  recentCount,
  onChangeView,
  onExport,
  onExportFormatChange,
  onImport,
  onAddDocuments,
  onImportFormatChange,
  onOpenSettings,
  setQuery,
  theme,
  onToggleTheme,
}: TopMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<'file' | 'view' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  const toggleMenu = (menu: NonNullable<typeof openMenu>) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const runMenuAction = (action: () => void | Promise<void>) => {
    setOpenMenu(null);
    void action();
  };

  return (
    <header className="top-menu-bar" ref={menuRef}>
      <nav className="top-menu-left" aria-label="顶部菜单">
        <div className="top-menu-item">
          <Button className="top-menu-button" type="button" aria-expanded={openMenu === 'file'} onClick={() => toggleMenu('file')}>
            文件
          </Button>
          {openMenu === 'file' && (
            <div className="top-dropdown-menu" role="menu">
              <Button className="top-dropdown-item" type="button" role="menuitem" onClick={() => runMenuAction(onImport)}>
                <Import size={15} />
                导入文件
              </Button>
              <Button className="top-dropdown-item" type="button" role="menuitem" onClick={() => runMenuAction(onAddDocuments)}>
                <FilePlus size={15} />
                添加文档
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
              <Button
                className="top-dropdown-item"
                type="button"
                role="menuitem"
                onClick={() => runMenuAction(() => onExport(exportFormat))}
              >
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

        <div className="top-menu-item">
          <Button className="top-menu-button" type="button" aria-expanded={openMenu === 'view'} onClick={() => toggleMenu('view')}>
            视图
          </Button>
          {openMenu === 'view' && (
            <div className="top-dropdown-menu" role="menu">
              <TopViewMenuItem active={activeView === 'all'} icon={<LayoutList size={15} />} label="全部" meta={promptCount} onClick={() => runMenuAction(() => onChangeView('all'))} />
              <TopViewMenuItem active={activeView === 'favorites'} icon={<Star size={15} />} label="收藏" meta={favoriteCount} onClick={() => runMenuAction(() => onChangeView('favorites'))} />
              <TopViewMenuItem active={activeView === 'recent'} icon={<Clock3 size={15} />} label="最近使用" meta={recentCount} onClick={() => runMenuAction(() => onChangeView('recent'))} />
              <TopViewMenuItem active={activeView === 'trash'} icon={<RotateCcw size={15} />} label="删除记录" meta={deletedCount} onClick={() => runMenuAction(() => onChangeView('trash'))} />
            </div>
          )}
        </div>

        <div className="top-menu-item">
          <Button className="top-menu-button" type="button" onClick={() => runMenuAction(onOpenSettings)}>
            设置
          </Button>
        </div>

        {showSearch && (
        <label className={`top-search-box ${query.trim() ? 'is-global-search' : ''}`}>
          <Search size={15} />
          <span className="search-scope-chip">全局</span>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索全部${searchLabel}`} aria-label={`搜索${searchLabel}`} />
          {query && (
            <Button className="mini-clear" type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
              <X size={13} />
            </Button>
          )}
        </label>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="top-menu-button theme-toggle"
              type="button"
              aria-label={theme === 'dark' ? '切换到浅色外观' : '切换到深色外观'}
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{theme === 'dark' ? '浅色外观' : '深色外观'}</TooltipContent>
        </Tooltip>
      </nav>

      <div className="top-menu-drag-region" aria-hidden="true" />

      <div className="top-window-controls-reserve" aria-hidden="true" />
    </header>
  );
}

type TopViewMenuItemProps = {
  active: boolean;
  icon: ReactNode;
  label: string;
  meta: number;
  onClick: () => void;
};

function TopViewMenuItem({ active, icon, label, meta, onClick }: TopViewMenuItemProps) {
  return (
    <Button className={`top-dropdown-item ${active ? 'active' : ''}`} type="button" role="menuitem" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <small>{meta}</small>
    </Button>
  );
}
