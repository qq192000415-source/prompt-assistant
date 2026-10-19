import { useEffect, useRef, useState } from 'react';
import { Check, Moon, Palette, Settings, Sun } from 'lucide-react';
import { LibrarySwitch } from './LibrarySwitch';
import { Button } from './ui/button';
import { isDarkTheme, THEMES, type ThemeMode } from '../lib/theme';
import type { LibraryMode } from '../localState';

type TopMenuBarProps = {
  // 在设置页时为 null，四个标签都不选中。
  libraryMode: LibraryMode | null;
  settingsActive: boolean;
  cloudEmail: string | null;
  cloudStatus: string;
  onChangeLibraryMode: (mode: LibraryMode) => void;
  onOpenCloudSettings: () => void;
  onOpenSettings: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
};

// 顶部栏是主导航：左边切换提示词、文档、素材、画布，右边是云同步状态、外观主题和设置。
export function TopMenuBar({
  libraryMode,
  settingsActive,
  cloudEmail,
  cloudStatus,
  onChangeLibraryMode,
  onOpenCloudSettings,
  onOpenSettings,
  theme,
  onThemeChange,
}: TopMenuBarProps) {
  return (
    <header className="top-menu-bar">
      <nav className="top-menu-left" aria-label="主导航">
        <LibrarySwitch className="top-tabs" libraryMode={libraryMode} onChange={onChangeLibraryMode} />
      </nav>

      <div className="top-menu-drag-region" aria-hidden="true" />

      <div className="top-menu-right">
        <Button
          className={`top-sync-pill ${cloudEmail ? 'is-online' : ''}`}
          type="button"
          title={cloudEmail ? `${cloudEmail}，点击查看云同步设置` : '点击查看云同步设置'}
          onClick={onOpenCloudSettings}
        >
          <span className="cloud-dot" aria-hidden="true" />
          {cloudStatus}
        </Button>
        <ThemeMenu theme={theme} onChange={onThemeChange} />
        <Button
          className={`top-menu-button top-settings-button ${settingsActive ? 'is-active' : ''}`}
          type="button"
          aria-pressed={settingsActive}
          onClick={onOpenSettings}
        >
          <Settings size={15} />
          设置
        </Button>
      </div>

      <div className="top-window-controls-reserve" aria-hidden="true" />
    </header>
  );
}

// 外观主题菜单：四套主题，带色块预览；点外面或按 Esc 关。
function ThemeMenu({ theme, onChange }: { theme: ThemeMode; onChange: (theme: ThemeMode) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = THEMES.find((entry) => entry.value === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="theme-menu" ref={menuRef}>
      <Button
        className="top-menu-button theme-toggle"
        type="button"
        aria-label={`外观主题：${current.label}`}
        title={`外观主题：${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {theme === 'light' ? <Sun size={15} /> : isDarkTheme(theme) ? <Moon size={15} /> : <Palette size={15} />}
      </Button>
      {open && (
        <div className="top-dropdown-menu theme-menu-list" role="menu" aria-label="外观主题">
          {THEMES.map((entry) => (
            <Button
              key={entry.value}
              className="top-dropdown-item"
              type="button"
              role="menuitemradio"
              aria-checked={entry.value === theme}
              onClick={() => {
                onChange(entry.value);
                setOpen(false);
              }}
            >
              <span className="theme-swatch" style={{ background: entry.swatch[0] }} aria-hidden="true">
                <span style={{ background: entry.swatch[1] }} />
              </span>
              <span className="theme-menu-text">
                <strong>{entry.label}</strong>
                <span>{entry.note}</span>
              </span>
              {entry.value === theme && <Check size={14} className="theme-menu-check" />}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
