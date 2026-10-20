import { useEffect, useRef, useState } from 'react';
import { Check, Moon, Palette, Settings, Sun } from 'lucide-react';
import { LibrarySwitch } from './LibrarySwitch';
import { Button } from './ui/button';
import { useSecondsUntil } from './materials/NasStatusBadge';
import { isDarkTheme, themeOptions, type SkinEntry, type ThemeMode } from '../lib/theme';
import type { LibraryMode } from '../localState';
import type { NasStatusController } from '../materials/useNasStatus';

type TopMenuBarProps = {
  // 在设置页时为 null，四个标签都不选中。
  libraryMode: LibraryMode | null;
  settingsActive: boolean;
  cloudEmail: string | null;
  cloudStatus: string;
  onChangeLibraryMode: (mode: LibraryMode) => void;
  onOpenCloudSettings: () => void;
  onOpenSettings: () => void;
  // NAS 连接状态：只在素材、画布标签时显示。
  nas: NasStatusController;
  onOpenNasSettings: () => void;
  theme: ThemeMode;
  skins: ReadonlyArray<SkinEntry>;
  onThemeChange: (theme: ThemeMode) => void;
};

// 顶部栏是主导航：左边切换提示词、文档、素材、画布，右边是 NAS 状态（素材、画布时）、云同步状态、外观主题和设置。
export function TopMenuBar({
  libraryMode,
  settingsActive,
  cloudEmail,
  cloudStatus,
  onChangeLibraryMode,
  onOpenCloudSettings,
  onOpenSettings,
  nas,
  onOpenNasSettings,
  theme,
  skins,
  onThemeChange,
}: TopMenuBarProps) {
  return (
    <header className="top-menu-bar">
      <nav className="top-menu-left" aria-label="主导航">
        <LibrarySwitch className="top-tabs" libraryMode={libraryMode} onChange={onChangeLibraryMode} />
      </nav>

      <div className="top-menu-drag-region" aria-hidden="true" />

      <div className="top-menu-right">
        {(libraryMode === 'materials' || libraryMode === 'canvas') && <NasPill nas={nas} onOpenSettings={onOpenNasSettings} />}
        <Button
          className={`top-sync-pill ${cloudEmail ? 'is-online' : ''}`}
          type="button"
          title={cloudEmail ? `${cloudEmail}，点击查看云同步设置` : '点击查看云同步设置'}
          onClick={onOpenCloudSettings}
        >
          <span className="cloud-dot" aria-hidden="true" />
          {cloudStatus}
        </Button>
        <ThemeMenu theme={theme} skins={skins} onChange={onThemeChange} />
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

// NAS 胶囊：已连接是绿点，点了去 NAS 设置；断开是红色带倒计时，点了立刻重连。还没连上过（没配置、没登录）不显示。
function NasPill({ nas, onOpenSettings }: { nas: NasStatusController; onOpenSettings: () => void }) {
  const { status, reconnecting, reconnect } = nas;
  const seconds = useSecondsUntil(status?.state === 'disconnected' ? status.nextRetryAt : null);
  if (!status || status.state === 'unknown') return null;
  const pending = status.pending.count ? ` · ${status.pending.count} 条待上传` : '';
  if (status.state === 'connected') {
    return (
      <Button
        className="top-sync-pill top-nas-pill is-online"
        type="button"
        title={`NAS 已连接${status.pending.count ? `，本机有 ${status.pending.count} 条生成记录正在传上 NAS` : ''}，点击查看 NAS 设置`}
        onClick={onOpenSettings}
      >
        <span className="cloud-dot" aria-hidden="true" />
        NAS 已连接{pending}
      </Button>
    );
  }
  const retry = reconnecting ? ' · 正在连接…' : seconds !== null ? ` · ${seconds} 秒后重连` : '';
  return (
    <Button
      className="top-sync-pill top-nas-pill is-down"
      type="button"
      disabled={reconnecting}
      title={`${status.error || 'NAS 连不上'}。点击立刻重新连接`}
      onClick={() => void reconnect()}
    >
      <span className="cloud-dot" aria-hidden="true" />
      NAS 已断开{retry}
      {pending}
    </Button>
  );
}

// 外观主题菜单：四套主题带色块预览，皮肤带预览图；点外面或按 Esc 关。
function ThemeMenu({ theme, skins, onChange }: { theme: ThemeMode; skins: ReadonlyArray<SkinEntry>; onChange: (theme: ThemeMode) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const options = themeOptions(skins);
  const current = options.find((entry) => entry.value === theme) ?? options[0];

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
        {theme === 'light' ? <Sun size={15} /> : isDarkTheme(theme, skins) ? <Moon size={15} /> : <Palette size={15} />}
      </Button>
      {open && (
        <div className="top-dropdown-menu theme-menu-list" role="menu" aria-label="外观主题">
          {options.map((entry) => (
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
              <span className="theme-swatch" style={entry.swatch ? { background: entry.swatch[0] } : { background: `center / cover url("${entry.preview}")` }} aria-hidden="true">
                {entry.swatch && <span style={{ background: entry.swatch[1] }} />}
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
