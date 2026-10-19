import { Moon, Settings, Sun } from 'lucide-react';
import { LibrarySwitch } from './LibrarySwitch';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { ThemeMode } from '../lib/theme';
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
  onToggleTheme: () => void;
};

// 顶部栏是主导航：左边切换提示词、文档、素材、画布，右边是云同步状态、深浅色和设置。
export function TopMenuBar({
  libraryMode,
  settingsActive,
  cloudEmail,
  cloudStatus,
  onChangeLibraryMode,
  onOpenCloudSettings,
  onOpenSettings,
  theme,
  onToggleTheme,
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
