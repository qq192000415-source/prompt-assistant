/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ADMIN_EMAILS?: string;
  readonly VITE_WEB_URL?: string;
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
  | 'installing'
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
  // 安装包下载目录（%LOCALAPPDATA%\<更新缓存>\pending）和下好的安装包。
  downloadDir?: string;
  downloadedFile?: string;
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

// 皮肤包（electron/materials/skinStore.ts）：主进程只给校验过的 manifest 和图标文件名，资源走 skin://<id>/<文件>。
type DesktopInstalledSkin = { manifest: import('./skins/skinPack').SkinManifest; icons: string[] };
type DesktopSkinInstallResult = { installed: Array<{ id: string; name: string; replaced: boolean }>; errors: Array<{ name: string; message: string }> };
type DesktopSkinsApi = {
  list: () => Promise<{ skins: DesktopInstalledSkin[]; errors: Array<{ id: string; message: string }> }>;
  pickAndInstall: () => Promise<DesktopSkinInstallResult | null>;
  installPaths: (paths: string[]) => Promise<DesktopSkinInstallResult>;
  remove: (id: string) => Promise<void>;
  // 返回导出到的路径，取消是 null。
  exportSkin: (id: string) => Promise<string | null>;
  pathForFile: (file: File) => string;
  // 主题市场：先读更新服务器的镜像，读不到再读 GitHub；base 是读到的那个 themes/ 地址，预览图在 base + preview。
  market: () => Promise<{ source: 'mirror' | 'github'; base: string; themes: DesktopMarketTheme[]; errors: string[] }>;
  marketInstall: (id: string) => Promise<{ id: string; name: string; replaced: boolean }>;
  // 做一套皮肤（1.17.0）：装界面生成的皮肤（manifest + wallpaper.webp、preview.webp），走和皮肤包一样的校验。
  installGenerated: (manifest: import('./skins/skinPack').SkinManifest, files: Record<string, Uint8Array>) => Promise<{ id: string; name: string; replaced: boolean }>;
  // 用 API 配置里的生图模型出两张壁纸，失败的那张在 errors 里说明原因。
  generateWallpaper: (prompt: string, composition: 'scene' | 'character') => Promise<{ images: string[]; errors: string[] }>;
  // Wallhaven 免费壁纸库：缩略图是 data URL；原图按 id 下载。
  wallhavenSearch: (input: { query: string; orientation: 'landscape' | 'portrait'; page: number }) => Promise<{ items: Array<{ id: string; width: number; height: number; page: string; thumb: string }>; failed: number; lastPage: number }>;
  wallhavenImage: (id: string) => Promise<string>;
};
type DesktopMarketTheme = { id: string; name: string; note: string; author: string; version: string; base: 'light' | 'dark'; size: number; sha256: string; preview: string };

type NasConfig = { baseUrl: string; username: string; hasPassword: boolean; source: "manual" | "grant" };

type MaterialLoadResult = { library: import('./materials/library').MaterialLibrary; dropped: number };

type MaterialImportResult = MaterialLoadResult & {
  added: number;
  skipped: number;
  errors: Array<{ name: string; message: string }>;
};

type DesktopMaterialsApi = {
  getConfig: () => Promise<NasConfig>;
  // 素材库按云同步账号分开：告诉主进程当前账号（空串是没登录），返回从根目录搬进账号文件夹的旧数据。
  setAccount: (email: string, adoptLegacy: boolean) => Promise<{ moved: string[] }>;
  // 明文的 NAS 连接（点眼睛、管理员授权时用）；授权来的连接会报错，不给看密码。
  revealConfig: () => Promise<{ baseUrl: string; username: string; password: string }>;
  // 按授权表同步本机的 NAS 连接；grant 为 null 是没有授权（收回了）。own 是管理员自己的那一行。
  applyGrant: (grant: { baseUrl: string; username: string; password: string } | null, own: boolean) => Promise<{ changed: boolean }>;
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
  // 管理员推荐的 API 地址：只换这几个位置的接口地址（OpenAI 兼容的），Key、模型不变。
  aiSetBaseUrl: (slots: MaterialAiSlotName[], url: string) => Promise<MaterialAiSettings>;
  // 管理员下发的 AI 规则改动（Supabase 表 ai_rule_overrides，按功能分），空对象表示全用内置规则。
  aiSetRuleOverrides: (overrides: MaterialAiRuleOverrides) => Promise<MaterialAiSettings>;
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
  // offline：NAS 连不上，返回的是本机缓存（最近一次读到的 + 还没传上去的）。
  canvasHistory: () => Promise<{ history: MaterialCanvasHistory; dropped: number; offline: boolean; error: string }>;
  // ids 是任务 id（删整个任务）或 `任务 id:图序号`（只删那一张）。
  canvasHistoryDelete: (ids: string[]) => Promise<{ history: MaterialCanvasHistory; dropped: number; warnings: string[] }>;
  canvasTemplates: () => Promise<MaterialCanvasTemplateResult>;
  canvasTemplateSave: (input: { id?: string; title: string; content: string; category: string }) => Promise<MaterialCanvasTemplateResult & { result: { id: string; duplicate: boolean } }>;
  canvasTemplateDelete: (id: string) => Promise<MaterialCanvasTemplateResult>;
  canvasTemplateUse: (id: string) => Promise<MaterialCanvasTemplateResult>;
  canvasSave: (taskId: string, index: number) => Promise<MaterialImportResult>;
  canvasSaveAs: (taskId: string, index: number) => Promise<string | null>;
  canvasCopyImage: (taskId: string, index: number) => Promise<void>;
  onCanvasQueue: (callback: (tasks: MaterialCanvasTask[]) => void) => () => void;
  canvasReference: (id: string) => Promise<{ dataUrl: string; title: string }>;
  canvasClipboardImage: () => Promise<string>;
  canvasHistoryImage: (sha256: string, ext: string) => Promise<string>;
  nasStatus: () => Promise<MaterialNasStatus>;
  nasReconnect: () => Promise<MaterialNasStatus>;
  onNasStatus: (callback: (status: MaterialNasStatus) => void) => () => void;
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
  // 全部规则，含管理员隐藏的（hidden），普通用户界面只显示没隐藏的。builtin 是素言自带的，modified 是管理员改过内容。
  presets: MaterialAiRule[];
  rulePresetIds: string[];
  customInstructions: string;
};
type MaterialAiRule = { id: string; label: string; instructions: string; builtin: boolean; modified: boolean; hidden: boolean };
type MaterialAiRuleEntry = { id: string; label: string; instructions: string; hidden?: boolean };
type MaterialAiRuleOverrides = Record<string, MaterialAiRuleEntry[]>;
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
  // 生成用了多少毫秒（含自动重试），结束后才有；1.14.0 以前的历史没有。
  durationMs?: number | null;
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

// NAS 连接状态（electron/materials/nasMonitor.ts）和当前账号本机待上传的生成记录。
type MaterialNasStatus = {
  state: 'unknown' | 'connected' | 'disconnected';
  error: string;
  nextRetryAt: string | null;
  pending: { count: number; bytes: number; overLimit: boolean };
};
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
// 来图定制（electron/materials/customIpc.ts）：连接来自管理员授权，产品配置和每单的版本都在定制 NAS 上。
type DesktopCustomFile = { name: string; bytes: Uint8Array<ArrayBuffer> };
type DesktopCustomApi = {
  applyGrant: (grant: { baseUrl: string; username: string; password: string } | null) => Promise<{ connected: boolean }>;
  listProducts: () => Promise<{ products: import('./custom/product').CustomProduct[]; dropped: number }>;
  saveProduct: (input: { id?: string; name: string; sizes: number[]; bleedCm: number; watermark: string }) => Promise<import('./custom/product').CustomProduct>;
  importPsd: (productId: string) => Promise<{ product: import('./custom/product').CustomProduct; sampleExt: string | null } | null>;
  savePhotoTemplate: (
    productId: string,
    input: { bytes: Uint8Array<ArrayBuffer>; ext: string; width: number; height: number; mesh: Array<{ x: number; y: number }> },
  ) => Promise<import('./custom/product').CustomProduct>;
  readTemplateFile: (productId: string, file: string) => Promise<Uint8Array<ArrayBuffer>>;
  saveOrderVersion: (input: {
    name: string;
    layout: import('./custom/layout').OrderLayout;
    sources: Array<{ sha256: string; ext: string; bytes: Uint8Array<ArrayBuffer> }>;
    outputs: DesktopCustomFile[];
  }) => Promise<{ version: number; folder: string }>;
  exportFiles: (files: DesktopCustomFile[]) => Promise<{ folder: string; count: number } | null>;
  copyImage: (png: Uint8Array) => Promise<void>;
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
    // 打开安装包下载目录；返回出错原因，空串是打开了。
    openUpdateFolder?: () => Promise<string>;
    onCloseRequest: (callback: () => void) => () => void;
    onUpdateStatus?: (callback: (status: DesktopUpdateStatus) => void) => () => void;
    documents?: DesktopDocumentsApi;
    skins?: DesktopSkinsApi;
    custom?: DesktopCustomApi;
  };
  promptAssistantFloating?: {
    showMain: () => Promise<void>;
    openMenu: () => Promise<void>;
    startDrag: (point: { x: number; y: number }) => Promise<void>;
    drag: (point: { x: number; y: number }) => Promise<void>;
    endDrag: () => Promise<void>;
  };
}
