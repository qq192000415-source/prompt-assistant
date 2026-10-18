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

type DesktopDocumentFile = {
  name: string;
  size: number;
  sha256: string;
  addedAt: string;
};

type DesktopDocumentsApi = {
  pickAndAdd: () => Promise<{ added: DesktopDocumentFile[]; errors: Array<{ name: string; message: string }> }>;
  has: (sha: string) => Promise<boolean>;
  readBytes: (sha: string) => Promise<Uint8Array>;
  writeBytes: (sha: string, bytes: Uint8Array) => Promise<void>;
  readText: (sha: string) => Promise<string>;
  saveText: (text: string) => Promise<{ sha256: string; size: number }>;
  open: (sha: string, name: string) => Promise<void>;
  showInFolder: (sha: string, name: string) => Promise<void>;
  copyFile: (sha: string, name: string) => Promise<void>;
  sharePath: (sha: string, name: string) => Promise<string>;
  saveAs: (sha: string, name: string) => Promise<boolean>;
  startDrag: (sha: string, name: string) => void;
};

type NasConfig = { baseUrl: string; username: string; hasPassword: boolean };

type MaterialLoadResult = { library: import('./materials/library').MaterialLibrary; dropped: number };

type MaterialImportResult = MaterialLoadResult & {
  added: number;
  skipped: number;
  errors: Array<{ name: string; message: string }>;
};

type DesktopMaterialsApi = {
  getConfig: () => Promise<NasConfig>;
  saveConfig: (config: { baseUrl: string; username: string; password?: string }) => Promise<NasConfig>;
  load: () => Promise<MaterialLoadResult>;
  pickAndImport: (category: string) => Promise<MaterialImportResult | null>;
  importPaths: (paths: string[], category: string) => Promise<MaterialImportResult>;
  importClipboard: (category: string) => Promise<MaterialImportResult>;
  update: (id: string, patch: import('./materials/library').MaterialPatch) => Promise<MaterialLoadResult>;
  remove: (ids: string[]) => Promise<MaterialLoadResult & { warnings: string[] }>;
  copyImage: (media: { sha256: string; ext: string }) => Promise<void>;
  pathForFile: (file: File) => string;
  ffmpegStatus: () => Promise<{ installed: boolean; downloadBytes: number }>;
  installFfmpeg: () => Promise<void>;
  compressImages: (ids: string[], options: MaterialImageCompressOptions) => Promise<MaterialCompressResult>;
  compressVideos: (ids: string[], options: MaterialVideoCompressOptions) => Promise<MaterialCompressResult>;
  exportItems: (ids: string[], defaultDir: string) => Promise<MaterialExportResult | null>;
  cancelBatch: () => Promise<void>;
  onProgress: (callback: (progress: MaterialBatchProgress) => void) => () => void;
};

type MaterialBatchProgress = { task: string; done: number; total: number; current: string };
type MaterialImageCompressOptions = { quality: number; maxSide: number; format: 'keep' | 'jpeg' };
type MaterialVideoCompressOptions = { resolution: 'original' | '1080p' | '720p' | '480p'; crf: number; codec: 'h264' | 'h265' };
type MaterialBatchFailure = { name: string; message: string };
type MaterialCompressResult = MaterialLoadResult & {
  processed: number;
  notSmaller: number;
  savedBytes: number;
  canceled: boolean;
  skippedUnsupported: number;
  failures: MaterialBatchFailure[];
};
type MaterialExportResult = { exported: number; failures: MaterialBatchFailure[]; canceled: boolean; dir: string };

interface Window {
  promptAssistantDesktop?: {
    materials?: DesktopMaterialsApi;
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
    documents?: DesktopDocumentsApi;
  };
  promptAssistantFloating?: {
    showMain: () => Promise<void>;
    openMenu: () => Promise<void>;
    startDrag: (point: { x: number; y: number }) => Promise<void>;
    drag: (point: { x: number; y: number }) => Promise<void>;
    endDrag: () => Promise<void>;
  };
}
