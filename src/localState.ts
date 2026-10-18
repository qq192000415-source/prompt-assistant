import { cleanSyncRecords, defaultExportSettings, isExportMode, isFreshRecord, isValidDateString, type ExportSettings } from './librarySync.ts';
import type { DeletedPromptRecord, SyncRecord } from './types';

// 本机界面状态和记录在 localStorage 里的读写。条目和分类的读写在 promptStorage.ts。
const SIDEBAR_WIDTH_KEY = 'prompt-library.sidebarWidth.v1';
const DELETED_RECORDS_KEY = 'prompt-library.deletedRecords.v1';
const SYNC_RECORDS_KEY = 'prompt-library.syncRecords.v1';
const EXPORT_SETTINGS_KEY = 'prompt-library.exportSettings.v1';
const CLOUD_REMEMBERED_LOGIN_KEY = 'prompt-library.cloudRememberedLogin.v1';
const LIBRARY_MODE_KEY = 'prompt-library.libraryMode.v1';
const MATERIALS_EXPORT_DIR_KEY = 'prompt-library.materialsExportDir.v1';
const MATERIALS_CANVAS_DRAFT_KEY = 'prompt-library.materialsCanvasDraft.v1';
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 420;

export type LibraryMode = 'prompts' | 'documents' | 'materials' | 'canvas';

export type RememberedCloudLogin = {
  email: string;
  password: string;
};

export const clampSidebarWidth = (width: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));

export const loadSidebarWidth = () => {
  const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(savedWidth) ? clampSidebarWidth(savedWidth) : 288;
};

export const saveSidebarWidth = (width: number) => {
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
};

export const loadExportSettings = (): ExportSettings => {
  try {
    const raw = window.localStorage.getItem(EXPORT_SETTINGS_KEY);
    if (!raw) return defaultExportSettings;
    const parsed = JSON.parse(raw) as Partial<ExportSettings>;

    return {
      mode: isExportMode(parsed.mode) ? parsed.mode : defaultExportSettings.mode,
      pathHint: typeof parsed.pathHint === 'string' ? parsed.pathHint : defaultExportSettings.pathHint,
      libraryUpdatedAt: isValidDateString(parsed.libraryUpdatedAt) ? parsed.libraryUpdatedAt : undefined,
      deletedRecordsUpdatedAt: isValidDateString(parsed.deletedRecordsUpdatedAt) ? parsed.deletedRecordsUpdatedAt : undefined,
      syncRecordsUpdatedAt: isValidDateString(parsed.syncRecordsUpdatedAt) ? parsed.syncRecordsUpdatedAt : undefined,
    };
  } catch {
    return defaultExportSettings;
  }
};

export const saveExportSettings = (settings: ExportSettings) => {
  window.localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(settings));
};

export const loadRememberedCloudLogin = (): RememberedCloudLogin => {
  try {
    const raw = window.localStorage.getItem(CLOUD_REMEMBERED_LOGIN_KEY);
    if (!raw) return { email: '', password: '' };
    const parsed = JSON.parse(raw) as Partial<RememberedCloudLogin>;
    return {
      email: typeof parsed.email === 'string' ? parsed.email : '',
      password: typeof parsed.password === 'string' ? parsed.password : '',
    };
  } catch {
    return { email: '', password: '' };
  }
};

export const saveRememberedCloudLogin = (email: string, password: string) => {
  window.localStorage.setItem(CLOUD_REMEMBERED_LOGIN_KEY, JSON.stringify({ email, password }));
};

export const clearRememberedCloudLogin = () => {
  window.localStorage.removeItem(CLOUD_REMEMBERED_LOGIN_KEY);
};

const isDeletedPromptRecord = (item: unknown): item is DeletedPromptRecord => {
  if (!item || typeof item !== 'object') return false;
  const record = item as Partial<DeletedPromptRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.deletedAt === 'string' &&
    typeof record.sourceName === 'string' &&
    Boolean(record.prompt) &&
    typeof record.prompt?.id === 'string' &&
    typeof record.prompt?.title === 'string' &&
    typeof record.prompt?.content === 'string'
  );
};

export const loadDeletedRecords = (): DeletedPromptRecord[] => {
  try {
    const raw = window.localStorage.getItem(DELETED_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDeletedPromptRecord).filter((record) => isFreshRecord(record.deletedAt)) : [];
  } catch {
    return [];
  }
};

export const saveDeletedRecords = (records: DeletedPromptRecord[]) => {
  window.localStorage.setItem(DELETED_RECORDS_KEY, JSON.stringify(records.filter((record) => isFreshRecord(record.deletedAt))));
};

const isSyncRecord = (item: unknown): item is SyncRecord => {
  if (!item || typeof item !== 'object') return false;
  const record = item as Partial<SyncRecord>;
  return (
    typeof record.id === 'string' &&
    typeof record.message === 'string' &&
    typeof record.createdAt === 'string' &&
    (record.action === 'auto' || record.action === 'manual' || record.action === 'login') &&
    (record.status === 'success' || record.status === 'error')
  );
};

export const loadSyncRecords = (): SyncRecord[] => {
  try {
    const raw = window.localStorage.getItem(SYNC_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? cleanSyncRecords(parsed.filter(isSyncRecord)) : [];
  } catch {
    return [];
  }
};

export const saveSyncRecords = (records: SyncRecord[]) => {
  window.localStorage.setItem(SYNC_RECORDS_KEY, JSON.stringify(cleanSyncRecords(records)));
};

export const loadLibraryMode = (): LibraryMode => {
  try {
    const saved = window.localStorage.getItem(LIBRARY_MODE_KEY);
    return saved === 'documents' || saved === 'materials' || saved === 'canvas' ? saved : 'prompts';
  } catch {
    return 'prompts';
  }
};

// 素材库上次导出到的文件夹，下次打开选择框时从这里开始。
export const loadMaterialsExportDir = () => {
  try {
    return window.localStorage.getItem(MATERIALS_EXPORT_DIR_KEY) ?? '';
  } catch {
    return '';
  }
};

export const saveMaterialsExportDir = (dir: string) => {
  try {
    window.localStorage.setItem(MATERIALS_EXPORT_DIR_KEY, dir);
  } catch {
    // 记不住导出目录不影响导出。
  }
};

// 画布草稿（提示词、尺寸等参数）原样存取，归一由 SuYan 的 normalizeCanvasDraftSettings 负责。
export const loadMaterialsCanvasDraft = (): unknown => {
  try {
    return JSON.parse(window.localStorage.getItem(MATERIALS_CANVAS_DRAFT_KEY) ?? 'null');
  } catch {
    return null;
  }
};

export const saveMaterialsCanvasDraft = (draft: unknown) => {
  try {
    window.localStorage.setItem(MATERIALS_CANVAS_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 记不住草稿不影响生图。
  }
};

export const saveLibraryMode = (mode: LibraryMode) => {
  try {
    window.localStorage.setItem(LIBRARY_MODE_KEY, mode);
  } catch {
    // 记不住上次的库不影响使用。
  }
};
