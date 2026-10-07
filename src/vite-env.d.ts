/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ADMIN_EMAILS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type DesktopCloseBehavior = 'ask' | 'quit' | 'tray';

type DesktopFloatingIconSettings = {
  enabled: boolean;
  opacity: number;
  x?: number | null;
  y?: number | null;
};

type DesktopRuntimeSettings = {
  closeBehavior: DesktopCloseBehavior;
  floatingIcon: DesktopFloatingIconSettings;
};

type DesktopRuntimeSettingsUpdate = Partial<Omit<DesktopRuntimeSettings, 'floatingIcon'>> & {
  floatingIcon?: Partial<DesktopFloatingIconSettings>;
};

type DesktopUpdateStatusName =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

type DesktopUpdateProgress = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

type DesktopUpdateStatus = {
  status: DesktopUpdateStatusName;
  currentVersion: string;
  availableVersion?: string;
  message: string;
  progress?: DesktopUpdateProgress;
  updateUrl?: string;
  updatedAt?: string;
};

interface Window {
  promptAssistantDesktop?: {
    platform: string;
    getSettings: () => Promise<DesktopRuntimeSettings>;
    updateSettings: (settings: DesktopRuntimeSettingsUpdate) => Promise<DesktopRuntimeSettings>;
    performClose: (payload: { action: 'quit' | 'tray'; remember: boolean }) => Promise<void>;
    showMain: () => Promise<void>;
    getUpdateStatus?: () => Promise<DesktopUpdateStatus>;
    checkForUpdates?: () => Promise<DesktopUpdateStatus>;
    downloadUpdate?: () => Promise<DesktopUpdateStatus>;
    installUpdate?: () => Promise<DesktopUpdateStatus>;
    onCloseRequest: (callback: () => void) => () => void;
    onUpdateStatus?: (callback: (status: DesktopUpdateStatus) => void) => () => void;
  };
  promptAssistantFloating?: {
    showMain: () => Promise<void>;
    openMenu: () => Promise<void>;
    startDrag: (point: { x: number; y: number }) => Promise<void>;
    drag: (point: { x: number; y: number }) => Promise<void>;
    endDrag: () => Promise<void>;
  };
}
