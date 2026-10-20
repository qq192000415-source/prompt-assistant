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
  importWord: (category: string) => Promise<MaterialImportResult | null>;
  importShare: () => Promise<MaterialImportResult | null>;
  exportShare: (ids: string[], defaultDir: string) => Promise<MaterialExportResult | null>;
  getProxy: () => Promise<MaterialProxySettings>;
  saveProxy: (settings: MaterialProxySettings) => Promise<{ settings: MaterialProxySettings; results: Array<{ name: string; ok: boolean; detail: string }> }>;
  aiGetSettings: () => Promise<MaterialAiSettings>;
  aiSaveSettings: (settings: MaterialAiSettingsInput) => Promise<MaterialAiSettings>;
  aiListModels: (slot: MaterialAiSlotName, input: MaterialAiSlotInput) => Promise<Array<{ id: string; vision: boolean; generation: boolean }>>;
  aiSetImageModel: (model: string) => Promise<MaterialAiSettings>;
  aiTest: (slot: MaterialAiSlotName, input: MaterialAiSlotInput) => Promise<void>;
  aiReverse: (id: string) => Promise<string>;
  aiOptimize: (prompt: string, kind: 'positive' | 'negative') => Promise<string>;
  aiTranslate: (prompt: string, negativePrompt: string) => Promise<{ prompt: string; negativePrompt: string; targetLanguage: 'zh' | 'en' }>;
  aiClassify: (id: string, prompt: string) => Promise<{ category: string; tags: string[]; warnings: string[] }>;
  aiBatchReverse: (ids: string[]) => Promise<MaterialAiBatchResult>;
  aiBatchClassify: (ids: string[]) => Promise<MaterialAiBatchResult>;
  canvasSubmit: (input: { payload: import('./materials/suyan/canvasAiTypes').AiImageGenerationPayload; count: number; origin: MaterialCanvasOrigin | null }) => Promise<string>;
  canvasQueue: () => Promise<MaterialCanvasTask[]>;
  canvasCancel: (taskId: string) => Promise<void>;
  canvasRetry: (taskId: string, index: number) => Promise<void>;
  canvasDismiss: (taskId: string) => Promise<void>;
  canvasHistory: () => Promise<{ history: MaterialCanvasHistory; dropped: number }>;
  canvasHistoryDelete: (ids: string[]) => Promise<{ history: MaterialCanvasHistory; dropped: number; warnings: string[] }>;
  canvasTemplates: () => Promise<MaterialCanvasTemplateResult>;
  canvasTemplateSave: (input: { id?: string; title: string; content: string; category: string }) => Promise<MaterialCanvasTemplateResult & { result: { id: string; duplicate: boolean } }>;
  canvasTemplateDelete: (id: string) => Promise<MaterialCanvasTemplateResult>;
  canvasTemplateUse: (id: string) => Promise<MaterialCanvasTemplateResult>;
  canvasSave: (taskId: string, index: number) => Promise<MaterialImportResult>;
  canvasSaveAs: (taskId: string, index: number) => Promise<string | null>;
  onCanvasQueue: (callback: (tasks: MaterialCanvasTask[]) => void) => () => void;
  canvasReference: (id: string) => Promise<{ dataUrl: string; title: string }>;
  canvasClipboardImage: () => Promise<string>;
  canvasHistoryImage: (sha256: string, ext: string) => Promise<string>;
  onProgress: (callback: (progress: MaterialBatchProgress) => void) => () => void;
};

type MaterialAiSlotName = 'text' | 'vision' | 'image';
type MaterialAiProvider = 'openai-compatible' | 'ollama';
type MaterialAiSlotInput = { provider: MaterialAiProvider; baseUrl: string; model: string; apiKey?: string };
type MaterialAiSlot = { provider: MaterialAiProvider; baseUrl: string; model: string; hasApiKey: boolean; usable: boolean };
type MaterialAiAction = {
  action: string;
  label: string;
  description: string;
  placeholder: string;
  capability: string;
  presets: Array<{ id: string; label: string }>;
  rulePresetIds: string[];
  customInstructions: string;
};
type MaterialCanvasOptions = { concurrency: number; retries: number };
type MaterialAiSettings = { text: MaterialAiSlot | null; vision: MaterialAiSlot | null; image: MaterialAiSlot | null; canvas: MaterialCanvasOptions; actions: MaterialAiAction[] };
type MaterialAiSettingsInput = {
  text: MaterialAiSlotInput | null;
  vision: MaterialAiSlotInput | null;
  image: MaterialAiSlotInput | null;
  canvas: MaterialCanvasOptions;
  actions: Record<string, { rulePresetIds: string[]; customInstructions: string }>;
};
// 创作画布：队列里的任务（主进程内存里，能取消、重试）和 NAS 上的生成历史，字段对应 electron/materials/canvasQueue.ts、canvasHistory.ts。
type MaterialCanvasMedia = { sha256: string; ext: string; kind: 'image' | 'video'; size: number; width: number | null; height: number | null; hasThumb: boolean };
type MaterialCanvasParams = { size: string; ratio: string; quality: string; outputFormat: string; background: string; mediaType: 'image' | 'video' };
type MaterialCanvasSlot = {
  index: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  attempts: number;
  error: string;
  media: MaterialCanvasMedia | null;
  revisedPrompt: string | null;
  dataUrl?: string | null;
  savedToLibrary?: boolean;
  // 队列里正在生成的槽位才有：开始生成的时间。
  startedAt?: string | null;
};
type MaterialCanvasTask = {
  id: string;
  createdAt: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  params: MaterialCanvasParams;
  origin: MaterialCanvasOrigin | null;
  referenceCount: number;
  // 生成历史里存的参考图（1.8.6 起）；队列快照和更早的任务没有。
  references?: MaterialCanvasMedia[];
  total: number;
  slots: MaterialCanvasSlot[];
};
type MaterialCanvasHistory = { schemaVersion: 1; updatedAt: string; tasks: MaterialCanvasTask[] };
// 画布模板（NAS 的 canvas-templates.json），字段对应 electron/materials/canvasTemplates.ts。
type MaterialCanvasTemplate = { id: string; title: string; content: string; category: string; useCount: number; createdAt: string; updatedAt: string };
type MaterialCanvasTemplateResult = { templates: { schemaVersion: 1; updatedAt: string; templates: MaterialCanvasTemplate[] }; dropped: number };
type MaterialCanvasOrigin = { prompt: string; negativePrompt: string; title: string; category: string; tags: string[] };
type MaterialAiBatchResult = MaterialLoadResult & { processed: number; skipped: number; failures: MaterialBatchFailure[]; canceled: boolean };

type MaterialProxySettings = { mode: 'system' | 'direct' | 'custom'; url: string };
type MaterialBatchProgress ={ task: string; done: number; total: number; current: string };
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
