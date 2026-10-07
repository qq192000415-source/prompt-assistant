import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent as ReactFormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  Copy,
  Download,
  FileJson,
  Folder,
  Heart,
  Import,
  Info,
  LayoutList,
  LogIn,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  getCloudConfig,
  getCloudSettingsForEmail,
  getCloudSettingsForProvider,
  getCurrentCloudSession,
  hasConfiguredCloudEndpoint,
  isAdminCloudUser,
  loadCloudSettings,
  loadCloudSnapshot,
  saveCloudSnapshot,
  saveCloudSettings,
  signInToCloud,
  signOutFromCloud,
  signUpToCloud,
  subscribeToCloudAuth,
  type CloudSettings,
  type CloudSession,
  type CloudSnapshot,
} from './cloudSync';
import {
  loadCategories,
  loadPrompts,
  loadSubcategories,
  parseImportedPrompts,
  saveCategories,
  savePrompts,
  saveSubcategories,
} from './promptStorage';
import { SAMPLE_PROMPTS } from './data';
import {
  copyToClipboard,
  createId,
  fillVariables,
  filterPrompts,
  formatDate,
  getViewLabel,
  makeSubcategoryView,
  parseSubcategoryView,
  parseTags,
  parseVariables,
} from './promptUtils';
import type { DeletedPromptRecord, DisplayMode, PromptDraft, PromptItem, SyncRecord, ViewKey } from './types';
import { APP_VERSION, APP_VERSION_LABEL } from './appMeta';

const emptyDraft: PromptDraft = {
  title: '',
  description: '',
  content: '',
  category: '写作',
  subcategory: '',
  tags: '',
  favorite: false,
};

const SIDEBAR_WIDTH_KEY = 'prompt-library.sidebarWidth.v1';
const DELETED_RECORDS_KEY = 'prompt-library.deletedRecords.v1';
const SYNC_RECORDS_KEY = 'prompt-library.syncRecords.v1';
const EXPORT_SETTINGS_KEY = 'prompt-library.exportSettings.v1';
const CLOUD_REMEMBERED_LOGIN_KEY = 'prompt-library.cloudRememberedLogin.v1';
const SAMPLE_PROMPT_IDS = new Set(SAMPLE_PROMPTS.map((prompt) => prompt.id));
const MAX_SYNC_RECORDS = 80;
const RECORD_RETENTION_DAYS = 30;
const RECORD_RETENTION_MS = RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 420;
const ROW_ACTION_MENU_WIDTH = 132;
const ROW_ACTION_MENU_EDGE_GAP = 8;
const ROW_ACTION_MENU_OFFSET = 5;
const ROW_ACTION_MENU_ITEM_HEIGHT = 30;
const ROW_ACTION_MENU_ITEM_GAP = 2;
const ROW_ACTION_MENU_PADDING_Y = 10;

type FileFormat = 'json' | 'txt' | 'csv';
type ExportMode = 'download' | 'picker';
type MoveDirection = -1 | 1;
type RowActionMenuPosition = {
  top: number;
  left: number;
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

type ExportSettings = {
  mode: ExportMode;
  pathHint: string;
  libraryUpdatedAt?: string;
  deletedRecordsUpdatedAt?: string;
  syncRecordsUpdatedAt?: string;
};

type RememberedCloudLogin = {
  email: string;
  password: string;
};

type BrowserSavePickerOptions = {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
};

type BrowserFileWritable = {
  write: (data: Blob | string) => Promise<void>;
  close: () => Promise<void>;
};

type BrowserFileHandle = {
  createWritable: () => Promise<BrowserFileWritable>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options?: BrowserSavePickerOptions) => Promise<BrowserFileHandle>;
};

type DesktopSettingsInput = Partial<Omit<DesktopRuntimeSettings, 'floatingIcon'>> & {
  floatingIcon?: Partial<DesktopRuntimeSettings['floatingIcon']>;
};

const defaultExportSettings: ExportSettings = {
  mode: 'download',
  pathHint: '',
};

const defaultDesktopSettings: DesktopRuntimeSettings = {
  closeBehavior: 'ask',
  floatingIcon: {
    enabled: true,
    opacity: 0.9,
    x: null,
    y: null,
  },
};

const defaultUpdateStatus: DesktopUpdateStatus = {
  status: 'idle',
  currentVersion: APP_VERSION,
  message: '尚未检查更新',
};

const FILE_FORMAT_LABELS: Record<FileFormat, string> = {
  json: 'JSON',
  txt: '记事本',
  csv: '表格',
};

const FILE_FORMAT_OPTIONS: Array<{ label: string; value: FileFormat }> = [
  { label: 'JSON', value: 'json' },
  { label: '记事本', value: 'txt' },
  { label: '表格', value: 'csv' },
];

const clampSidebarWidth = (width: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));

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

const loadSidebarWidth = () => {
  const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(savedWidth) ? clampSidebarWidth(savedWidth) : 288;
};

const isDesktopCloseBehavior = (value: unknown): value is DesktopCloseBehavior =>
  value === 'ask' || value === 'quit' || value === 'tray';

const clampFloatingOpacity = (opacity: number) => Math.min(1, Math.max(0.25, opacity));

const normalizeDesktopCoordinate = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const normalizeDesktopSettings = (
  value?: DesktopSettingsInput | null,
  fallback: DesktopRuntimeSettings = defaultDesktopSettings,
): DesktopRuntimeSettings => {
  const source = value && typeof value === 'object' ? value : {};
  const sourceFloatingIcon = source.floatingIcon && typeof source.floatingIcon === 'object' ? source.floatingIcon : {};
  const fallbackFloatingIcon = fallback.floatingIcon;
  const opacity = Number(sourceFloatingIcon.opacity);

  return {
    closeBehavior: isDesktopCloseBehavior(source.closeBehavior) ? source.closeBehavior : fallback.closeBehavior,
    floatingIcon: {
      enabled:
        typeof sourceFloatingIcon.enabled === 'boolean'
          ? sourceFloatingIcon.enabled
          : fallbackFloatingIcon.enabled,
      opacity: Number.isFinite(opacity) ? clampFloatingOpacity(opacity) : fallbackFloatingIcon.opacity,
      x:
        sourceFloatingIcon.x === null || sourceFloatingIcon.x === undefined
          ? fallbackFloatingIcon.x ?? null
          : normalizeDesktopCoordinate(sourceFloatingIcon.x),
      y:
        sourceFloatingIcon.y === null || sourceFloatingIcon.y === undefined
          ? fallbackFloatingIcon.y ?? null
          : normalizeDesktopCoordinate(sourceFloatingIcon.y),
    },
  };
};

const isExportMode = (mode: unknown): mode is ExportMode => mode === 'download' || mode === 'picker';

const isValidDateString = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const loadExportSettings = (): ExportSettings => {
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

const saveExportSettings = (settings: ExportSettings) => {
  window.localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify(settings));
};

const normalizeExportSettings = (value: unknown, fallback: ExportSettings = defaultExportSettings): ExportSettings => {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const candidate = value as Partial<ExportSettings>;
  return {
    mode: isExportMode(candidate.mode) ? candidate.mode : fallback.mode,
    pathHint: typeof candidate.pathHint === 'string' ? candidate.pathHint : fallback.pathHint,
    libraryUpdatedAt: isValidDateString(candidate.libraryUpdatedAt) ? candidate.libraryUpdatedAt : fallback.libraryUpdatedAt,
    deletedRecordsUpdatedAt: isValidDateString(candidate.deletedRecordsUpdatedAt)
      ? candidate.deletedRecordsUpdatedAt
      : fallback.deletedRecordsUpdatedAt,
    syncRecordsUpdatedAt: isValidDateString(candidate.syncRecordsUpdatedAt)
      ? candidate.syncRecordsUpdatedAt
      : fallback.syncRecordsUpdatedAt,
  };
};

const loadRememberedCloudLogin = (): RememberedCloudLogin => {
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

const saveRememberedCloudLogin = (email: string, password: string) => {
  window.localStorage.setItem(CLOUD_REMEMBERED_LOGIN_KEY, JSON.stringify({ email, password }));
};

const clearRememberedCloudLogin = () => {
  window.localStorage.removeItem(CLOUD_REMEMBERED_LOGIN_KEY);
};

const getPromptTime = (prompt: PromptItem) => Date.parse(prompt.updatedAt || prompt.createdAt);

const getDeletedPromptTime = (promptId: string, deletedRecords: DeletedPromptRecord[]) =>
  Math.max(
    -Infinity,
    ...deletedRecords
      .filter((record) => record.prompt.id === promptId)
      .map((record) => Date.parse(record.deletedAt))
      .filter(Number.isFinite),
  );

const isPromptDeletedByRecords = (prompt: PromptItem, deletedRecords: DeletedPromptRecord[]) => {
  const deletedAt = getDeletedPromptTime(prompt.id, deletedRecords);
  return Number.isFinite(deletedAt) && deletedAt >= getPromptTime(prompt);
};

const hasDeletedCategoryRecord = (category: string, deletedRecords: DeletedPromptRecord[]) =>
  deletedRecords.some((record) => record.source === 'category' && record.sourceName === category && isFreshRecord(record.deletedAt));

const filterCategoriesByDeletedRecords = (
  categories: string[],
  prompts: PromptItem[],
  deletedRecords: DeletedPromptRecord[],
) =>
  categories.filter((category) => prompts.some((prompt) => prompt.category === category) || !hasDeletedCategoryRecord(category, deletedRecords));

const filterSubcategoriesByPrompts = (subcategories: Record<string, string[]>, prompts: PromptItem[]) =>
  Object.fromEntries(
    Object.entries(subcategories)
      .map(([category, items]) => [
        category,
        items.filter((subcategory) =>
          prompts.some((prompt) => prompt.category === category && prompt.subcategory === subcategory),
        ),
      ])
      .filter(([, items]) => Array.isArray(items) && items.length),
  );

const normalizePromptDuplicatePart = (value?: string) =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const getPromptDuplicateKey = (prompt: Pick<PromptItem, 'category' | 'subcategory' | 'title' | 'content'>) =>
  [
    normalizePromptDuplicatePart(prompt.category),
    normalizePromptDuplicatePart(prompt.subcategory),
    normalizePromptDuplicatePart(prompt.title),
    normalizePromptDuplicatePart(prompt.content),
  ].join('\u001f');

const dedupePrompts = (items: PromptItem[]) => {
  const seen = new Set<string>();
  const deduped: PromptItem[] = [];

  for (const item of items) {
    const key = getPromptDuplicateKey(item);
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
};

const appendPromptsToCategoryEnd = (items: PromptItem[], additions: PromptItem[]) => {
  const additionKeys = new Set(additions.map(getPromptDuplicateKey));
  const ordered = items.filter((item) => !additionKeys.has(getPromptDuplicateKey(item)));

  for (const prompt of additions) {
    let insertIndex = ordered.length;

    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      if (ordered[index].category === prompt.category) {
        insertIndex = index + 1;
        break;
      }
    }

    ordered.splice(insertIndex, 0, prompt);
  }

  return dedupePrompts(ordered);
};

const findDuplicatePrompt = (
  items: PromptItem[],
  prompt: Pick<PromptItem, 'category' | 'subcategory' | 'title' | 'content'>,
  ignoreId?: string,
) => {
  const key = getPromptDuplicateKey(prompt);
  return items.find((item) => item.id !== ignoreId && getPromptDuplicateKey(item) === key);
};

const mergePrompts = (localPrompts: PromptItem[], cloudPrompts: PromptItem[], deletedRecords: DeletedPromptRecord[]) => {
  const merged = new Map<string, PromptItem>();

  for (const prompt of cloudPrompts) {
    merged.set(prompt.id, prompt);
  }

  for (const prompt of localPrompts) {
    const existing = merged.get(prompt.id);
    if (!existing || Date.parse(prompt.updatedAt) >= Date.parse(existing.updatedAt)) {
      merged.set(prompt.id, prompt);
    }
  }

  return dedupePrompts(Array.from(merged.values()).filter((prompt) => !isPromptDeletedByRecords(prompt, deletedRecords)));
};

const mergeDeletedRecords = (localRecords: DeletedPromptRecord[], cloudRecords: DeletedPromptRecord[]) => {
  const merged = new Map<string, DeletedPromptRecord>();

  for (const record of cloudRecords.filter((item) => isFreshRecord(item.deletedAt))) {
    merged.set(record.id, record);
  }

  for (const record of localRecords.filter((item) => isFreshRecord(item.deletedAt))) {
    const existing = merged.get(record.id);
    if (!existing || Date.parse(record.deletedAt) >= Date.parse(existing.deletedAt)) {
      merged.set(record.id, record);
    }
  }

  return Array.from(merged.values()).sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
};

const mergeSyncRecords = (localRecords: SyncRecord[], cloudRecords: SyncRecord[]) => {
  const merged = new Map<string, SyncRecord>();

  for (const record of cloudRecords.filter((item) => isFreshRecord(item.createdAt))) {
    merged.set(record.id, record);
  }

  for (const record of localRecords.filter((item) => isFreshRecord(item.createdAt))) {
    merged.set(record.id, record);
  }

  return cleanSyncRecords(Array.from(merged.values()));
};

const getLatestTime = (dates: string[]) =>
  dates
    .map((date) => Date.parse(date))
    .filter(Number.isFinite)
    .reduce((latest, time) => Math.max(latest, time), 0);

const getLatestDeletedRecordTime = (records: DeletedPromptRecord[]) =>
  getLatestTime(records.filter((record) => isFreshRecord(record.deletedAt)).map((record) => record.deletedAt));

const getLatestSyncRecordTime = (records: SyncRecord[]) =>
  getLatestTime(records.filter((record) => isFreshRecord(record.createdAt)).map((record) => record.createdAt));

const getLatestPromptChangeTime = (prompts: PromptItem[] = []) =>
  getLatestTime(
    prompts.flatMap((prompt) =>
      [prompt.createdAt, prompt.updatedAt, prompt.lastUsedAt].filter((date): date is string => Boolean(date)),
    ),
  );

const timestampFromTime = (time: number) => (time > 0 ? new Date(time).toISOString() : undefined);

const getSnapshotLibraryTime = (snapshot: CloudSnapshot) => {
  const settings = normalizeExportSettings(snapshot.exportSettings);
  const explicitTime = Date.parse(settings.libraryUpdatedAt ?? '');
  return Number.isFinite(explicitTime) ? explicitTime : getLatestPromptChangeTime(snapshot.prompts);
};

const getSnapshotDeletedStateTime = (snapshot: CloudSnapshot) => {
  const settings = normalizeExportSettings(snapshot.exportSettings);
  const explicitTime = Date.parse(settings.deletedRecordsUpdatedAt ?? '');
  return Number.isFinite(explicitTime) ? explicitTime : getLatestDeletedRecordTime(snapshot.deletedRecords);
};

const getSnapshotSyncStateTime = (snapshot: CloudSnapshot) => {
  const settings = normalizeExportSettings(snapshot.exportSettings);
  const explicitTime = Date.parse(settings.syncRecordsUpdatedAt ?? '');
  return Number.isFinite(explicitTime) ? explicitTime : getLatestSyncRecordTime(snapshot.syncRecords ?? []);
};

const chooseDeletedRecords = (localSnapshot: CloudSnapshot, cloudSnapshot: CloudSnapshot) => {
  const localTime = getSnapshotDeletedStateTime(localSnapshot);
  const cloudTime = getSnapshotDeletedStateTime(cloudSnapshot);

  if (localTime > cloudTime) {
    return localSnapshot.deletedRecords.filter((record) => isFreshRecord(record.deletedAt));
  }

  if (cloudTime > localTime) {
    return cloudSnapshot.deletedRecords.filter((record) => isFreshRecord(record.deletedAt));
  }

  return mergeDeletedRecords(localSnapshot.deletedRecords, cloudSnapshot.deletedRecords);
};

const chooseSyncRecords = (localSnapshot: CloudSnapshot, cloudSnapshot: CloudSnapshot) => {
  const localTime = getSnapshotSyncStateTime(localSnapshot);
  const cloudTime = getSnapshotSyncStateTime(cloudSnapshot);

  if (localTime > cloudTime) {
    return cleanSyncRecords(localSnapshot.syncRecords ?? []);
  }

  if (cloudTime > localTime) {
    return cleanSyncRecords(cloudSnapshot.syncRecords ?? []);
  }

  return mergeSyncRecords(localSnapshot.syncRecords ?? [], cloudSnapshot.syncRecords ?? []);
};

const mergeExportSettingsState = (
  localSnapshot: CloudSnapshot,
  cloudSnapshot: CloudSnapshot,
  deletedRecords: DeletedPromptRecord[],
  syncRecords: SyncRecord[],
) => {
  const localSettings = normalizeExportSettings(localSnapshot.exportSettings);
  const cloudSettings = normalizeExportSettings(cloudSnapshot.exportSettings, localSettings);
  const localLibraryTime = getSnapshotLibraryTime(localSnapshot);
  const cloudLibraryTime = getSnapshotLibraryTime(cloudSnapshot);
  const localDeletedTime = getSnapshotDeletedStateTime(localSnapshot);
  const cloudDeletedTime = getSnapshotDeletedStateTime(cloudSnapshot);
  const localSyncTime = getSnapshotSyncStateTime(localSnapshot);
  const cloudSyncTime = getSnapshotSyncStateTime(cloudSnapshot);

  return {
    ...cloudSettings,
    ...localSettings,
    libraryUpdatedAt:
      localLibraryTime >= cloudLibraryTime
        ? localSettings.libraryUpdatedAt ?? timestampFromTime(localLibraryTime)
        : cloudSettings.libraryUpdatedAt ?? timestampFromTime(cloudLibraryTime),
    deletedRecordsUpdatedAt:
      localDeletedTime >= cloudDeletedTime
        ? localSettings.deletedRecordsUpdatedAt ?? deletedRecords[0]?.deletedAt
        : cloudSettings.deletedRecordsUpdatedAt ?? deletedRecords[0]?.deletedAt,
    syncRecordsUpdatedAt:
      localSyncTime >= cloudSyncTime
        ? localSettings.syncRecordsUpdatedAt ?? syncRecords[0]?.createdAt
        : cloudSettings.syncRecordsUpdatedAt ?? syncRecords[0]?.createdAt,
  };
};

const mergeStringList = (cloudItems: string[], localItems: string[]) =>
  Array.from(new Set([...cloudItems, ...localItems].map((item) => item.trim()).filter(Boolean)));

const mergeSubcategoryMap = (localMap: Record<string, string[]>, cloudMap: Record<string, string[]>) => {
  const categories = new Set([...Object.keys(cloudMap), ...Object.keys(localMap)]);

  return Object.fromEntries(
    Array.from(categories)
      .map((category) => [category, mergeStringList(cloudMap[category] ?? [], localMap[category] ?? [])])
      .filter(([, subcategories]) => Array.isArray(subcategories) && subcategories.length),
  );
};

const mergeCloudSnapshot = (localSnapshot: CloudSnapshot, cloudSnapshot: CloudSnapshot): CloudSnapshot => {
  const deletedRecords = chooseDeletedRecords(localSnapshot, cloudSnapshot);
  const syncRecords = chooseSyncRecords(localSnapshot, cloudSnapshot);
  const localPromptIds = new Set(localSnapshot.prompts.map((prompt) => prompt.id));
  const localLibraryTime = getSnapshotLibraryTime(localSnapshot);
  const cloudLibraryTime = getSnapshotLibraryTime(cloudSnapshot);
  const preferLocalLibrary = localLibraryTime >= cloudLibraryTime;
  const localLibraryIsNewerAndEmpty = localLibraryTime > cloudLibraryTime && localSnapshot.prompts.length === 0;
  const localDeletedTime = getSnapshotDeletedStateTime(localSnapshot);
  const cloudDeletedTime = getSnapshotDeletedStateTime(cloudSnapshot);
  let prompts = localLibraryIsNewerAndEmpty
    ? []
    : mergePrompts(localSnapshot.prompts, cloudSnapshot.prompts, deletedRecords);

  if (localDeletedTime > cloudDeletedTime) {
    prompts = prompts.filter((prompt) => localPromptIds.has(prompt.id) || getPromptTime(prompt) > localDeletedTime);
  }
  prompts = dedupePrompts(prompts);

  const categories = filterCategoriesByDeletedRecords(
    preferLocalLibrary
      ? localSnapshot.categories
      : mergeStringList(cloudSnapshot.categories, localSnapshot.categories),
    prompts,
    deletedRecords,
  );
  const subcategories = filterSubcategoriesByPrompts(
    preferLocalLibrary
      ? localSnapshot.subcategories
      : mergeSubcategoryMap(localSnapshot.subcategories, cloudSnapshot.subcategories),
    prompts,
  );
  const exportSettings = mergeExportSettingsState(localSnapshot, cloudSnapshot, deletedRecords, syncRecords);

  return {
    prompts,
    categories,
    subcategories,
    deletedRecords,
    syncRecords,
    exportSettings,
    updatedAt: new Date().toISOString(),
  };
};

const hasCloudSnapshotData = (snapshot: CloudSnapshot | null) =>
  Boolean(snapshot && (snapshot.prompts.length > 0 || snapshot.deletedRecords.length > 0 || snapshot.categories.length > 0));

const isSampleOnlySnapshot = (snapshot: CloudSnapshot) =>
  snapshot.prompts.length > 0 &&
  snapshot.prompts.every((prompt) => SAMPLE_PROMPT_IDS.has(prompt.id)) &&
  snapshot.deletedRecords.length === 0;

const uniqueCategories = (categories: string[]) =>
  Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean)));

const uniqueSubcategories = (subcategories: string[]) =>
  Array.from(new Set(subcategories.map((subcategory) => subcategory.trim()).filter(Boolean)));

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

const isFreshRecord = (date: string) => {
  const time = Date.parse(date);
  return Number.isFinite(time) && Date.now() - time <= RECORD_RETENTION_MS;
};

const loadDeletedRecords = (): DeletedPromptRecord[] => {
  try {
    const raw = window.localStorage.getItem(DELETED_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDeletedPromptRecord).filter((record) => isFreshRecord(record.deletedAt)) : [];
  } catch {
    return [];
  }
};

const saveDeletedRecords = (records: DeletedPromptRecord[]) => {
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

const cleanSyncRecords = (records: SyncRecord[]) =>
  records
    .filter((record) => isFreshRecord(record.createdAt))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_SYNC_RECORDS);

const createSyncRecord = (
  action: SyncRecord['action'],
  status: SyncRecord['status'],
  message: string,
): SyncRecord => ({
  id: createId(),
  action,
  status,
  message,
  createdAt: new Date().toISOString(),
});

const cleanCloudSnapshotRecords = (snapshot: CloudSnapshot): CloudSnapshot => {
  const deletedRecords = snapshot.deletedRecords.filter((record) => isFreshRecord(record.deletedAt));
  const prompts = dedupePrompts(snapshot.prompts.filter((prompt) => !isPromptDeletedByRecords(prompt, deletedRecords)));
  const categories = filterCategoriesByDeletedRecords(snapshot.categories, prompts, deletedRecords);
  const subcategories = filterSubcategoriesByPrompts(snapshot.subcategories, prompts);

  return {
    ...snapshot,
    prompts,
    categories,
    subcategories,
    deletedRecords,
    syncRecords: cleanSyncRecords(snapshot.syncRecords ?? []),
  };
};

const loadSyncRecords = (): SyncRecord[] => {
  try {
    const raw = window.localStorage.getItem(SYNC_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? cleanSyncRecords(parsed.filter(isSyncRecord)) : [];
  } catch {
    return [];
  }
};

const saveSyncRecords = (records: SyncRecord[]) => {
  window.localStorage.setItem(SYNC_RECORDS_KEY, JSON.stringify(cleanSyncRecords(records)));
};

const createDeletedRecord = (
  prompt: PromptItem,
  source: DeletedPromptRecord['source'],
  sourceName: string,
): DeletedPromptRecord => ({
  id: createId(),
  prompt,
  source,
  sourceName,
  deletedAt: new Date().toISOString(),
});

const draftFromPrompt = (prompt: PromptItem): PromptDraft => ({
  title: prompt.title,
  description: prompt.description ?? '',
  content: prompt.content,
  category: prompt.category,
  subcategory: prompt.subcategory ?? '',
  tags: prompt.tags.join('，'),
  favorite: prompt.favorite,
});

const getFormatFromFileName = (fileName: string, fallback: FileFormat): FileFormat => {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.txt')) return 'txt';
  if (lowerName.endsWith('.csv')) return 'csv';
  if (lowerName.endsWith('.json')) return 'json';
  return fallback;
};

const escapeCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

const serializePromptsAsText = (items: PromptItem[]) =>
  items
    .map((prompt) =>
      [`主文件名：${prompt.category}`, `子文件名：${prompt.title}`, '提示词内容：', prompt.content.trim()].join('\n'),
    )
    .join('\n\n');

const serializePromptsAsCsv = (items: PromptItem[]) => {
  const rows = [
    ['主文件夹', '子文件名称', '提示词内容'],
    ...items.map((prompt) => [prompt.category, prompt.title, prompt.content]),
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const parseCsvRows = (raw: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((item) => item.trim()));
};

const makeImportedPrompt = (title: string, category: string, content: string): PromptItem => {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: title.trim() || `导入提示词 ${now.slice(11, 19)}`,
    description: '',
    content: content.trim(),
    category: category.trim() || '其他',
    subcategory: undefined,
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
};

const parseTextPrompts = (raw: string): PromptItem[] => {
  const blocks = raw
    .split(/\n\s*---\s*\n|\n{2,}(?=主文件名：)/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const prompts = blocks
    .map((block, index) => {
      const lines = block.split(/\r?\n/);
      if (lines[0]?.startsWith('主文件名：')) {
        const category = lines.shift()?.replace(/^主文件名：/, '').trim() || '其他';
        const titleLine = lines[0]?.startsWith('子文件名：') ? lines.shift() : '';
        const title = titleLine?.replace(/^子文件名：/, '').trim() || `导入提示词 ${index + 1}`;
        if (lines[0]?.startsWith('提示词内容：')) {
          lines.shift();
        }

        const content = lines.join('\n').trim();
        return content ? makeImportedPrompt(title, category, content) : null;
      }

      const firstLine = lines.shift()?.trim() ?? '';
      const title = firstLine.replace(/^#+\s*/, '').trim() || `导入提示词 ${index + 1}`;
      let category = '其他';

      if (lines[0]?.startsWith('主文件夹：') || lines[0]?.startsWith('分类：')) {
        category = lines.shift()?.replace(/^主文件夹：|^分类：/, '').trim() || '其他';
      }

      const content = lines.join('\n').trim() || block;
      return content ? makeImportedPrompt(title, category, content) : null;
    })
    .filter((prompt): prompt is PromptItem => Boolean(prompt));

  if (!prompts.length) {
    throw new Error('没有找到可导入的提示词。');
  }

  return prompts;
};

const parseCsvPrompts = (raw: string): PromptItem[] => {
  const rows = parseCsvRows(raw);
  const header = rows[0]?.map((item) => item.trim()) ?? [];
  const hasHeader = header.some((item) => ['主文件夹', '分类', '子文件名称', '标题', '提示词内容', '正文', 'content'].includes(item));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const getIndex = (names: string[], fallback: number) => {
    const index = header.findIndex((item) => names.includes(item));
    return index === -1 ? fallback : index;
  };

  const categoryIndex = hasHeader ? getIndex(['主文件夹', '分类', 'category'], 0) : 0;
  const titleIndex = hasHeader ? getIndex(['子文件名称', '标题', 'title'], 1) : 1;
  const contentIndex = hasHeader ? getIndex(['提示词内容', '正文', 'content'], 2) : 2;

  const prompts = dataRows
    .map((row, index) => {
      const category = row[categoryIndex] ?? '其他';
      const title = row[titleIndex] ?? row[0] ?? `导入提示词 ${index + 1}`;
      const content = row[contentIndex] ?? row[row.length - 1] ?? '';
      return content.trim() ? makeImportedPrompt(title, category, content) : null;
    })
    .filter((prompt): prompt is PromptItem => Boolean(prompt));

  if (!prompts.length) {
    throw new Error('没有找到可导入的提示词。');
  }

  return prompts;
};

const parseImportedByFormat = (raw: string, format: FileFormat) => {
  const cleanRaw = raw.replace(/^\uFEFF/, '');
  if (format === 'txt') return parseTextPrompts(cleanRaw);
  if (format === 'csv') return parseCsvPrompts(cleanRaw);
  return parseImportedPrompts(cleanRaw);
};

function App() {
  const [prompts, setPrompts] = useState<PromptItem[]>(() => dedupePrompts(loadPrompts()));
  const [deletedRecords, setDeletedRecords] = useState<DeletedPromptRecord[]>(() => loadDeletedRecords());
  const [syncRecords, setSyncRecords] = useState<SyncRecord[]>(() => loadSyncRecords());
  const [storedCategories, setStoredCategories] = useState<string[]>(() => loadCategories());
  const [storedSubcategories, setStoredSubcategories] = useState<Record<string, string[]>>(() => loadSubcategories());
  const [activeView, setActiveView] = useState<ViewKey>('all');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('collection');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'detail'>('list');
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [editorPrompt, setEditorPrompt] = useState<PromptItem | null>(null);
  const [editorInitialCategory, setEditorInitialCategory] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isCategoryCreatorOpen, setIsCategoryCreatorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<FileFormat>('json');
  const [exportFormat, setExportFormat] = useState<FileFormat>('json');
  const [exportSettings, setExportSettings] = useState<ExportSettings>(() => loadExportSettings());
  const [desktopSettings, setDesktopSettings] = useState<DesktopRuntimeSettings>(defaultDesktopSettings);
  const [updateStatus, setUpdateStatus] = useState<DesktopUpdateStatus>(defaultUpdateStatus);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsAboutInitiallyOpen, setSettingsAboutInitiallyOpen] = useState(false);
  const [cloudSettings, setCloudSettings] = useState<CloudSettings>(() => loadCloudSettings());
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const activeCloudSettings = useMemo(() => getCloudSettingsForProvider(cloudSettings.provider, cloudSettings), [cloudSettings]);
  const activeCloudConfig = useMemo(() => getCloudConfig(activeCloudSettings), [activeCloudSettings]);
  const cloudLoginEnabled = useMemo(() => hasConfiguredCloudEndpoint(cloudSettings), [cloudSettings]);
  const [cloudReadyUserId, setCloudReadyUserId] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState(getCloudConfig(loadCloudSettings()).enabled ? '未登录' : '未配置云端');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [closeRequestOpen, setCloseRequestOpen] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);
  const [toast, setToast] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestSnapshotRef = useRef<CloudSnapshot | null>(null);
  const canManageCloudSettings = isAdminCloudUser(cloudSession?.user.email, cloudSettings);
  const showToast = (message: string) => setToast(message);

  const openSettingsPanel = (options?: { about?: boolean }) => {
    setSettingsAboutInitiallyOpen(Boolean(options?.about));
    setIsSettingsOpen(true);

    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi) return;

    void desktopApi
      .getSettings()
      .then((settings) => setDesktopSettings(normalizeDesktopSettings(settings, desktopSettings)))
      .catch(() => undefined);
  };

  useEffect(() => {
    savePrompts(prompts);
  }, [prompts]);

  useEffect(() => {
    saveDeletedRecords(deletedRecords);
  }, [deletedRecords]);

  useEffect(() => {
    saveSyncRecords(syncRecords);
  }, [syncRecords]);

  useEffect(() => {
    saveCategories(storedCategories);
  }, [storedCategories]);

  useEffect(() => {
    saveSubcategories(storedSubcategories);
  }, [storedSubcategories]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    saveExportSettings(exportSettings);
  }, [exportSettings]);

  useEffect(() => {
    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi) return;

    return desktopApi.onCloseRequest(() => {
      setRememberCloseChoice(false);
      setCloseRequestOpen(true);
    });
  }, []);

  useEffect(() => {
    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi?.getUpdateStatus) return;

    let canceled = false;
    void desktopApi
      .getUpdateStatus()
      .then((status) => {
        if (!canceled) {
          setUpdateStatus(status);
        }
      })
      .catch(() => undefined);

    const unsubscribe = desktopApi.onUpdateStatus?.((status) => {
      setUpdateStatus(status);
      if (status.status === 'available' || status.status === 'downloaded' || status.status === 'error') {
        showToast(status.message);
      }
    });

    return () => {
      canceled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const desktopApi = window.promptAssistantDesktop;
    if (!desktopApi) return;

    let canceled = false;
    void desktopApi
      .getSettings()
      .then((settings) => {
        if (!canceled) {
          setDesktopSettings(normalizeDesktopSettings(settings));
        }
      })
      .catch(() => undefined);

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const categories = useMemo(
    () => uniqueCategories([...storedCategories, ...prompts.map((prompt) => prompt.category)]),
    [storedCategories, prompts],
  );

  const subcategoryMap = useMemo(() => {
    const map: Record<string, string[]> = {};

    for (const [category, subcategories] of Object.entries(storedSubcategories)) {
      map[category] = uniqueSubcategories(subcategories);
    }

    for (const prompt of prompts) {
      if (!prompt.subcategory) continue;
      map[prompt.category] = uniqueSubcategories([...(map[prompt.category] ?? []), prompt.subcategory]);
    }

    return map;
  }, [storedSubcategories, prompts]);

  const visiblePrompts = useMemo(() => filterPrompts(prompts, activeView, query), [prompts, activeView, query]);
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedId) ?? null;

  const addSyncRecord = (action: SyncRecord['action'], status: SyncRecord['status'], message: string) => {
    setSyncRecords((records) => cleanSyncRecords([createSyncRecord(action, status, message), ...records]));
  };

  const markLibraryChanged = () => {
    const timestamp = new Date().toISOString();
    setExportSettings((settings) => ({ ...settings, libraryUpdatedAt: timestamp }));
    return timestamp;
  };

  const markDeletedRecordsChanged = () => {
    const timestamp = new Date().toISOString();
    setExportSettings((settings) => ({
      ...settings,
      libraryUpdatedAt: timestamp,
      deletedRecordsUpdatedAt: timestamp,
    }));
    return timestamp;
  };

  const markSyncRecordsChanged = () => {
    const timestamp = new Date().toISOString();
    setExportSettings((settings) => ({ ...settings, syncRecordsUpdatedAt: timestamp }));
    return timestamp;
  };

  const applySnapshot = (snapshot: CloudSnapshot) => {
    const cleanSnapshot = cleanCloudSnapshotRecords(snapshot);
    setPrompts(cleanSnapshot.prompts);
    setStoredCategories(cleanSnapshot.categories);
    setStoredSubcategories(cleanSnapshot.subcategories);
    setDeletedRecords(cleanSnapshot.deletedRecords);
    setSyncRecords(cleanSnapshot.syncRecords);
    setExportSettings(normalizeExportSettings(cleanSnapshot.exportSettings, exportSettings));
    setSelectedId((currentId) =>
      cleanSnapshot.prompts.some((prompt) => prompt.id === currentId) ? currentId : cleanSnapshot.prompts[0]?.id ?? null,
    );
  };

  useEffect(() => {
    latestSnapshotRef.current = {
      prompts: dedupePrompts(prompts),
      categories,
      subcategories: subcategoryMap,
      deletedRecords,
      syncRecords,
      exportSettings,
    };
  }, [categories, deletedRecords, exportSettings, prompts, subcategoryMap, syncRecords]);

  useEffect(() => {
    if (!cloudLoginEnabled) return;

    let canceled = false;

    void getCurrentCloudSession(cloudSettings)
      .then((session) => {
        if (canceled) return;
        setCloudSession(session);
        setCloudStatus(session ? '准备同步' : '未登录');
      })
      .catch((error) => {
        if (canceled) return;
        setCloudStatus('云端连接失败');
        showToast(error instanceof Error ? error.message : '云端连接失败');
      });

    const unsubscribe = subscribeToCloudAuth(
      (session) => {
        setCloudSession(session);
        setCloudStatus(session ? '准备同步' : '未登录');
        if (!session) {
          setCloudReadyUserId(null);
        }
      },
      cloudSettings,
    );

    return () => {
      canceled = true;
      unsubscribe();
    };
  }, [cloudLoginEnabled, cloudSettings]);

  useEffect(() => {
    const userId = cloudSession?.user.id;
    if (!userId) {
      setCloudReadyUserId(null);
      return;
    }

    let canceled = false;
    const sessionCloudSettings = activeCloudSettings;

    const loadAndMergeCloud = async () => {
      setCloudStatus('正在加载云端数据');
      try {
        const localSnapshot = latestSnapshotRef.current ?? {
          prompts,
          categories,
          subcategories: subcategoryMap,
          deletedRecords,
          syncRecords,
          exportSettings,
        };
        const cloudSnapshot = await loadCloudSnapshot(userId, sessionCloudSettings);
        const shouldPullCloudOnly = cloudSnapshot && hasCloudSnapshotData(cloudSnapshot) && isSampleOnlySnapshot(localSnapshot);
        const nextSnapshot =
          shouldPullCloudOnly
            ? { ...cloudSnapshot, updatedAt: new Date().toISOString() }
            : cloudSnapshot
              ? mergeCloudSnapshot(localSnapshot, cloudSnapshot)
              : localSnapshot;

        if (canceled) return;

        const message = shouldPullCloudOnly
          ? '已自动拉取云端数据'
          : cloudSnapshot
            ? '已合并云端数据'
            : '已把本地数据同步到云端';
        const cleanSnapshot = cleanCloudSnapshotRecords({
          ...nextSnapshot,
          syncRecords: [createSyncRecord('login', 'success', message), ...(nextSnapshot.syncRecords ?? [])],
          updatedAt: new Date().toISOString(),
        });

        applySnapshot(cleanSnapshot);

        await saveCloudSnapshot(userId, cleanSnapshot, sessionCloudSettings);
        if (canceled) return;
        setCloudReadyUserId(userId);
        setCloudStatus('云端已同步');
        showToast(message);
      } catch (error) {
        if (canceled) return;
        setCloudStatus('同步失败');
        const message = error instanceof Error ? error.message : '云端同步失败';
        addSyncRecord('login', 'error', message);
        showToast(message);
      }
    };

    void loadAndMergeCloud();

    return () => {
      canceled = true;
    };
  }, [activeCloudSettings, cloudSession?.user.id]);

  useEffect(() => {
    const userId = cloudSession?.user.id;
    const snapshot = latestSnapshotRef.current;

    if (!userId || cloudReadyUserId !== userId || !snapshot) return;

    setCloudStatus('正在同步');
    const sessionCloudSettings = activeCloudSettings;
    const timer = window.setTimeout(() => {
      const syncRecord = createSyncRecord('auto', 'success', '自动同步完成');
      const snapshotToSave = cleanCloudSnapshotRecords({
        ...snapshot,
        syncRecords: [syncRecord, ...(snapshot.syncRecords ?? [])],
        updatedAt: new Date().toISOString(),
      });

      void saveCloudSnapshot(userId, snapshotToSave, sessionCloudSettings)
        .then(() => {
          setCloudStatus('云端已同步');
          setSyncRecords((records) => cleanSyncRecords([syncRecord, ...records]));
        })
        .catch((error) => {
          setCloudStatus('同步失败');
          const message = error instanceof Error ? error.message : '云端同步失败';
          addSyncRecord('auto', 'error', message);
          showToast(message);
        });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeCloudSettings, categories, cloudReadyUserId, cloudSession?.user.id, deletedRecords, exportSettings, prompts, subcategoryMap]);

  useEffect(() => {
    if (mode !== 'list') return;

    if (!visiblePrompts.length) {
      if (selectedId) setSelectedId(null);
      return;
    }

    if (!selectedId || !visiblePrompts.some((prompt) => prompt.id === selectedId)) {
      setSelectedId(visiblePrompts[0].id);
    }
  }, [mode, selectedId, visiblePrompts]);

  const askConfirm = (dialog: ConfirmDialogState) => {
    setConfirmDialog(dialog);
  };

  const closeConfirmDialog = () => {
    setConfirmDialog(null);
  };

  const confirmCurrentDialog = () => {
    const action = confirmDialog?.onConfirm;
    setConfirmDialog(null);
    action?.();
  };

  const performDesktopClose = (action: 'quit' | 'tray') => {
    const desktopApi = window.promptAssistantDesktop;
    setCloseRequestOpen(false);

    if (!desktopApi) return;

    void desktopApi
      .performClose({ action, remember: rememberCloseChoice })
      .then(() => {
        if (rememberCloseChoice) {
          setDesktopSettings((settings) => normalizeDesktopSettings({ ...settings, closeBehavior: action }, settings));
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : '关闭窗口失败';
        showToast(message);
      });
  };

  const runDesktopUpdateAction = async (
    action: 'checkForUpdates' | 'downloadUpdate' | 'installUpdate',
    fallbackMessage: string,
  ) => {
    const desktopApi = window.promptAssistantDesktop;
    const updateAction = desktopApi?.[action];
    if (!updateAction) {
      showToast('请使用桌面安装版检查更新');
      setUpdateStatus({
        ...defaultUpdateStatus,
        status: 'unsupported',
        message: '请使用桌面安装版检查更新',
      });
      return;
    }

    try {
      const status = await updateAction();
      setUpdateStatus(status);
      if (status.status !== 'checking' && status.status !== 'downloading') {
        showToast(status.message || fallbackMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackMessage;
      setUpdateStatus((current) => ({ ...current, status: 'error', message }));
      showToast(message);
    }
  };

  const changeView = (view: ViewKey) => {
    setActiveView(view);
    setDisplayMode('collection');
    setMode('list');
    setSelectedId(null);
    setSidebarOpen(false);
  };

  const selectPromptFromSidebar = (prompt: PromptItem) => {
    setActiveView(`category:${prompt.category}`);
    setSelectedId(prompt.id);
    setDisplayMode('single');
    setMode('list');
    setSidebarOpen(false);
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    document.body.classList.add('resizing-sidebar');

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      document.body.classList.remove('resizing-sidebar');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const openCategoryCreator = () => {
    setIsCategoryCreatorOpen(true);
  };

  const createCategory = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return false;
    if (categories.includes(name)) {
      showToast('这个分类已经存在');
      return false;
    }

    markLibraryChanged();
    setStoredCategories((items) => uniqueCategories([...items, name]));
    setActiveView(`category:${name}`);
    setDisplayMode('collection');
    setSelectedId(null);
    setMode('list');
    setSidebarOpen(false);
    showToast('分类已创建');
    return true;
  };

  const renameCategory = (oldName: string, nextName: string) => {
    const normalizedName = nextName.trim();
    if (!normalizedName || normalizedName === oldName) return true;

    if (categories.includes(normalizedName)) {
      showToast('这个分类已经存在');
      return false;
    }

    const now = new Date().toISOString();
    markLibraryChanged();
    setStoredCategories((items) => {
      const index = items.indexOf(oldName);
      if (index === -1) {
        return uniqueCategories([...items.filter((item) => item !== oldName), normalizedName]);
      }

      const updated = [...items];
      updated[index] = normalizedName;
      return uniqueCategories(updated);
    });
    setPrompts((items) =>
      items.map((item) => (item.category === oldName ? { ...item, category: normalizedName, updatedAt: now } : item)),
    );
    setStoredSubcategories((items) => {
      const updated = { ...items };
      const subcategories = updated[oldName];
      delete updated[oldName];
      updated[normalizedName] = uniqueSubcategories([...(updated[normalizedName] ?? []), ...(subcategories ?? [])]);
      return updated;
    });
    if (activeView === `category:${oldName}`) {
      setActiveView(`category:${normalizedName}`);
    }
    showToast('分类已重命名');
    return true;
  };

  const deleteCategory = (category: string) => {
    const deletedPrompts = prompts.filter((prompt) => prompt.category === category);
    const promptCount = deletedPrompts.length;
    const message = promptCount
      ? `确认删除“${category}”？下面 ${promptCount} 条子文件和提示词内容会一起删除。`
      : `确认删除“${category}”？`;

    askConfirm({
      title: '删除主文件夹',
      message,
      confirmLabel: '确认删除',
      onConfirm: () => {
        markDeletedRecordsChanged();
        if (deletedPrompts.length) {
          setDeletedRecords((records) => [
            ...deletedPrompts.map((prompt) => createDeletedRecord(prompt, 'category', category)),
            ...records,
          ]);
        }
        setStoredCategories((items) => uniqueCategories(items.filter((item) => item !== category)));
        setStoredSubcategories((items) => {
          const updated = { ...items };
          delete updated[category];
          return updated;
        });
        setPrompts((items) => items.filter((item) => item.category !== category));
        if (activeView === `category:${category}`) {
          setActiveView('all');
        }
        if (selectedPrompt?.category === category) {
          setSelectedId(null);
          setMode('list');
        }
        showToast(promptCount ? '主文件夹和提示词已删除' : '分类已删除');
      },
    });
  };

  const renameSubcategory = (category: string, oldName: string, nextName: string) => {
    const normalizedName = nextName.trim();
    if (!normalizedName || normalizedName === oldName) return true;

    if ((subcategoryMap[category] ?? []).includes(normalizedName)) {
      showToast('这个子分类已经存在');
      return false;
    }

    const now = new Date().toISOString();
    markLibraryChanged();
    setStoredSubcategories((items) => {
      const current = items[category] ?? [];
      return {
        ...items,
        [category]: uniqueSubcategories(current.map((item) => (item === oldName ? normalizedName : item))),
      };
    });
    setPrompts((items) =>
      items.map((item) =>
        item.category === category && item.subcategory === oldName
          ? { ...item, subcategory: normalizedName, updatedAt: now }
          : item,
      ),
    );
    if (activeView === makeSubcategoryView(category, oldName)) {
      setActiveView(makeSubcategoryView(category, normalizedName));
    }
    showToast('子分类已重命名');
    return true;
  };

  const deleteSubcategory = (category: string, subcategory: string) => {
    const promptCount = prompts.filter((prompt) => prompt.category === category && prompt.subcategory === subcategory).length;
    const message = promptCount
      ? `确认删除“${subcategory}”？${promptCount} 条提示词会移动到“${category}”。`
      : `确认删除“${subcategory}”？`;

    askConfirm({
      title: '删除子分类',
      message,
      confirmLabel: '确认删除',
      onConfirm: () => {
        const now = new Date().toISOString();
        markLibraryChanged();
        setStoredSubcategories((items) => ({
          ...items,
          [category]: uniqueSubcategories((items[category] ?? []).filter((item) => item !== subcategory)),
        }));
        setPrompts((items) =>
          items.map((item) =>
            item.category === category && item.subcategory === subcategory
              ? { ...item, subcategory: undefined, updatedAt: now }
              : item,
          ),
        );
        if (activeView === makeSubcategoryView(category, subcategory)) {
          setActiveView(`category:${category}`);
        }
        showToast('子分类已删除');
      },
    });
  };

  const openNewEditor = () => {
    setEditorPrompt(null);
    setEditorInitialCategory(null);
    setIsEditorOpen(true);
  };

  const openNewEditorInCategory = (category: string) => {
    setEditorPrompt(null);
    setEditorInitialCategory(category);
    setIsEditorOpen(true);
  };

  const openEditEditor = (prompt: PromptItem) => {
    setEditorPrompt(prompt);
    setIsEditorOpen(true);
  };

  const duplicatePrompt = (prompt: PromptItem) => {
    const now = new Date().toISOString();
    const clone: PromptItem = {
      ...prompt,
      id: createId(),
      title: `${prompt.title}（副本）`,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: undefined,
    };

    markLibraryChanged();
    setPrompts((items) => appendPromptsToCategoryEnd(items, [clone]));
    setSelectedId(clone.id);
    setMode('list');
    showToast('已创建副本');
  };

  const upsertPrompt = (draft: PromptDraft) => {
    const now = new Date().toISOString();
    const normalizedTags = parseTags(draft.tags);
    const title = draft.title.trim();
    const description = draft.description.trim();
    const content = draft.content.trim();
    const category = draft.category.trim() || '其他';
    const subcategory = draft.subcategory.trim() || undefined;
    const duplicateCandidate = {
      title,
      content,
      category,
      subcategory,
    };
    const duplicatePrompt = findDuplicatePrompt(prompts, duplicateCandidate, editorPrompt?.id);

    if (duplicatePrompt) {
      setSelectedId(duplicatePrompt.id);
      setMode('list');
      showToast(editorPrompt ? '已存在相同提示词，未重复保存' : '已存在相同提示词，未重复创建');
      return;
    }

    markLibraryChanged();
    if (subcategory) {
      setStoredSubcategories((items) => ({
        ...items,
        [category]: uniqueSubcategories([...(items[category] ?? []), subcategory]),
      }));
    }

    if (editorPrompt) {
      const updatedPrompt: PromptItem = {
        ...editorPrompt,
        title,
        description,
        content,
        category,
        subcategory,
        tags: normalizedTags,
        favorite: draft.favorite,
        updatedAt: now,
      };

      setPrompts((items) => dedupePrompts(items.map((item) => (item.id === editorPrompt.id ? updatedPrompt : item))));
      setSelectedId(updatedPrompt.id);
      setMode('list');
      showToast('提示词已更新');
      return;
    }

    const newPrompt: PromptItem = {
      id: createId(),
      title,
      description,
      content,
      category,
      subcategory,
      tags: normalizedTags,
      favorite: draft.favorite,
      createdAt: now,
      updatedAt: now,
    };

    setPrompts((items) => appendPromptsToCategoryEnd(items, [newPrompt]));
    setSelectedId(newPrompt.id);
    setMode('list');
    showToast('提示词已创建');
  };

  const deletePrompt = (id: string) => {
    const target = prompts.find((prompt) => prompt.id === id);
    if (!target) return;

    askConfirm({
      title: '删除子文件',
      message: `确认删除“${target.title}”？这个子文件和提示词内容会一起删除。`,
      confirmLabel: '确认删除',
      onConfirm: () => {
        markDeletedRecordsChanged();
        setDeletedRecords((records) => [createDeletedRecord(target, 'prompt', target.title), ...records]);
        setPrompts((items) => items.filter((item) => item.id !== id));
        setSelectedId(null);
        setMode('list');
        showToast('提示词已删除');
      },
    });
  };

  const restoreDeletedRecord = (recordId: string) => {
    const record = deletedRecords.find((item) => item.id === recordId);
    if (!record) return;

    const existingIds = new Set(prompts.map((prompt) => prompt.id));
    const idExists = existingIds.has(record.prompt.id);
    const restoredPrompt: PromptItem = {
      ...record.prompt,
      id: idExists ? createId() : record.prompt.id,
      title: idExists ? `${record.prompt.title}（恢复）` : record.prompt.title,
      updatedAt: new Date().toISOString(),
    };

    setStoredCategories((items) => uniqueCategories([...items, restoredPrompt.category]));
    if (restoredPrompt.subcategory) {
      setStoredSubcategories((items) => ({
        ...items,
        [restoredPrompt.category]: uniqueSubcategories([
          ...(items[restoredPrompt.category] ?? []),
          restoredPrompt.subcategory ?? '',
        ]),
      }));
    }
    markDeletedRecordsChanged();
    setPrompts((items) => appendPromptsToCategoryEnd(items, [restoredPrompt]));
    setDeletedRecords((items) => items.filter((item) => item.id !== recordId));
    setActiveView(`category:${restoredPrompt.category}`);
    setDisplayMode('single');
    setMode('list');
    setSelectedId(restoredPrompt.id);
    showToast('提示词已恢复');
  };

  const removeDeletedRecord = (recordId: string) => {
    const record = deletedRecords.find((item) => item.id === recordId);
    if (!record) return;

    askConfirm({
      title: '移除删除记录',
      message: `确认从删除记录里移除“${record.prompt.title}”？移除后不能恢复。`,
      confirmLabel: '确认移除',
      onConfirm: () => {
        markDeletedRecordsChanged();
        setDeletedRecords((items) => items.filter((item) => item.id !== recordId));
        showToast('删除记录已移除');
      },
    });
  };

  const clearDeletedRecords = () => {
    if (!deletedRecords.length) {
      showToast('暂无删除记录');
      return;
    }

    askConfirm({
      title: '清空删除记录',
      message: `确认清空全部 ${deletedRecords.length} 条删除记录？清空后不能恢复。`,
      confirmLabel: '清空全部',
      onConfirm: () => {
        markDeletedRecordsChanged();
        setDeletedRecords([]);
        showToast('删除记录已清空');
      },
    });
  };

  const renamePrompt = (id: string, nextTitle: string) => {
    const normalizedTitle = nextTitle.trim();
    if (!normalizedTitle) {
      showToast('子文件名称不能为空');
      return false;
    }

    markLibraryChanged();
    setPrompts((items) =>
      items.map((item) => (item.id === id ? { ...item, title: normalizedTitle, updatedAt: new Date().toISOString() } : item)),
    );
    showToast('子文件已重命名');
    return true;
  };

  const moveCategory = (category: string, direction: MoveDirection) => {
    const currentIndex = categories.indexOf(category);
    const nextIndex = currentIndex + direction;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= categories.length) return;

    const updated = [...categories];
    [updated[currentIndex], updated[nextIndex]] = [updated[nextIndex], updated[currentIndex]];
    markLibraryChanged();
    setStoredCategories(uniqueCategories(updated));
    showToast('主文件夹顺序已更新');
  };

  const movePrompt = (id: string, direction: MoveDirection) => {
    const target = prompts.find((prompt) => prompt.id === id);
    if (!target) return;

    const siblings = prompts.filter((prompt) => prompt.category === target.category);
    const currentSiblingIndex = siblings.findIndex((prompt) => prompt.id === id);
    const nextSibling = siblings[currentSiblingIndex + direction];
    if (!nextSibling) return;

    setPrompts((items) => {
      const currentIndex = items.findIndex((prompt) => prompt.id === id);
      const nextIndex = items.findIndex((prompt) => prompt.id === nextSibling.id);
      if (currentIndex === -1 || nextIndex === -1) return items;

      const updated = [...items];
      [updated[currentIndex], updated[nextIndex]] = [updated[nextIndex], updated[currentIndex]];
      return updated;
    });
    markLibraryChanged();
    showToast('子文件顺序已更新');
  };

  const toggleFavorite = (id: string) => {
    markLibraryChanged();
    setPrompts((items) =>
      items.map((item) =>
        item.id === id ? { ...item, favorite: !item.favorite, updatedAt: new Date().toISOString() } : item,
      ),
    );
  };

  const updatePromptContent = (id: string, content: string) => {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      showToast('提示词正文不能为空');
      return false;
    }

    markLibraryChanged();
    setPrompts((items) =>
      items.map((item) =>
        item.id === id ? { ...item, content: normalizedContent, updatedAt: new Date().toISOString() } : item,
      ),
    );
    showToast('正文已保存');
    return true;
  };

  const copyPrompt = async (id: string, content: string) => {
    try {
      await copyToClipboard(content);
      const now = new Date().toISOString();
      markLibraryChanged();
      setPrompts((items) => items.map((item) => (item.id === id ? { ...item, lastUsedAt: now } : item)));
      showToast('已复制到剪贴板');
    } catch {
      showToast('复制失败，请手动选中文本复制');
    }
  };

  const exportPrompts = async (format: FileFormat) => {
    const payload =
      format === 'csv'
        ? { content: `\uFEFF${serializePromptsAsCsv(prompts)}`, extension: 'csv', mime: 'text/csv;charset=utf-8' }
        : format === 'txt'
          ? { content: `\uFEFF${serializePromptsAsText(prompts)}`, extension: 'txt', mime: 'text/plain;charset=utf-8' }
          : { content: JSON.stringify(prompts, null, 2), extension: 'json', mime: 'application/json' };

    const blob = new Blob([payload.content], { type: payload.mime });
    const fileName = `prompt-library-${new Date().toISOString().slice(0, 10)}.${payload.extension}`;

    if (exportSettings.mode === 'picker') {
      const pickerWindow = window as SavePickerWindow;

      if (pickerWindow.showSaveFilePicker) {
        try {
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: FILE_FORMAT_LABELS[format],
                accept: { [payload.mime.split(';')[0]]: [`.${payload.extension}`] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast('已导出到选择的位置');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            showToast('已取消导出');
            return;
          }

          showToast('选择路径失败，已改用默认下载');
        }
      } else {
        showToast('当前浏览器不支持选择位置，已改用默认下载');
      }
    }

    downloadBlob(blob, fileName);
    showToast(`已导出${FILE_FORMAT_LABELS[format]}文件`);
  };

  const importPrompts = async (file: File) => {
    try {
      const raw = await file.text();
      const format = getFormatFromFileName(file.name, importFormat);
      const imported = parseImportedByFormat(raw, format);
      const existingIds = new Set(prompts.map((prompt) => prompt.id));
      const existingKeys = new Set(prompts.map(getPromptDuplicateKey));
      const now = new Date().toISOString();
      const normalized: PromptItem[] = [];
      let skipped = 0;

      for (const prompt of imported) {
        let cleanPrompt: PromptItem = {
          ...prompt,
          title: prompt.title.trim(),
          description: prompt.description?.trim() ?? '',
          content: prompt.content.trim(),
          category: prompt.category.trim() || '其他',
          subcategory: prompt.subcategory?.trim() || undefined,
          tags: Array.isArray(prompt.tags) ? prompt.tags.map((tag) => tag.trim()).filter(Boolean) : [],
        };
        const duplicateKey = getPromptDuplicateKey(cleanPrompt);

        if (existingKeys.has(duplicateKey)) {
          skipped += 1;
          continue;
        }

        if (existingIds.has(cleanPrompt.id)) {
          cleanPrompt = {
            ...cleanPrompt,
            id: createId(),
            createdAt: now,
            updatedAt: now,
          };
        }

        existingIds.add(cleanPrompt.id);
        existingKeys.add(duplicateKey);
        normalized.push(cleanPrompt);
      }

      if (!normalized.length) {
        showToast(skipped ? `没有新增提示词，跳过 ${skipped} 条重复` : '没有可导入的提示词');
        return;
      }

      markLibraryChanged();
      setPrompts((items) => appendPromptsToCategoryEnd(items, normalized));
      setMode('list');
      showToast(
        skipped
          ? `已从${FILE_FORMAT_LABELS[format]}导入 ${normalized.length} 条，跳过 ${skipped} 条重复`
          : `已从${FILE_FORMAT_LABELS[format]}导入 ${normalized.length} 条提示词`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const submitCloudAuth = async (mode: 'signin' | 'signup', email: string, password: string, remember: boolean) => {
    const supabaseSettings = getCloudSettingsForEmail(email, cloudSettings);
    const routeConfig = getCloudConfig(supabaseSettings);

    if (!routeConfig.enabled) {
      throw new Error('还没有配置云端参数');
    }

    setCloudStatus(mode === 'signin' ? '正在登录' : '正在注册');
    if (mode === 'signin') {
      const session = await signInToCloud(email, password, supabaseSettings);
      if (remember) {
        saveRememberedCloudLogin(email, password);
      } else {
        clearRememberedCloudLogin();
      }
      setCloudSession(session);
      setIsAuthOpen(false);
      showToast('已登录云同步');
      return;
    }

    const session = await signUpToCloud(email, password, supabaseSettings);
    if (remember) {
      saveRememberedCloudLogin(email, password);
    } else {
      clearRememberedCloudLogin();
    }
    if (session) {
      setCloudSession(session);
    }
    setIsAuthOpen(false);
    showToast(session ? '已注册并登录云同步' : '注册成功，请按邮箱提示验证后登录');
  };

  const handleCloudSignOut = async () => {
    try {
      await signOutFromCloud(activeCloudSettings);
      setCloudSession(null);
      setCloudReadyUserId(null);
      setCloudStatus('未登录');
      showToast('已退出云同步');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '退出登录失败');
    }
  };

  const manualCloudSync = async () => {
    const userId = cloudSession?.user.id;
    if (!activeCloudConfig.enabled) {
      showToast('请先在设置里配置云端');
      openSettingsPanel();
      return;
    }

    if (!userId) {
      showToast('请先登录云同步');
      setIsAuthOpen(true);
      return;
    }

    setCloudStatus('正在手动同步');
    try {
      const sessionCloudSettings = activeCloudSettings;
      const localSnapshot = latestSnapshotRef.current ?? {
        prompts,
        categories,
        subcategories: subcategoryMap,
        deletedRecords,
        syncRecords,
        exportSettings,
      };
      const cloudSnapshot = await loadCloudSnapshot(userId, sessionCloudSettings);
      const shouldPullCloudOnly = cloudSnapshot && hasCloudSnapshotData(cloudSnapshot) && isSampleOnlySnapshot(localSnapshot);
      const mergedSnapshot = shouldPullCloudOnly
        ? { ...cloudSnapshot, updatedAt: new Date().toISOString() }
        : cloudSnapshot
          ? mergeCloudSnapshot(localSnapshot, cloudSnapshot)
          : localSnapshot;
      const message = cloudSnapshot ? '手动同步完成，已合并云端数据' : '手动同步完成，已上传本地数据';
      const nextSnapshot = cleanCloudSnapshotRecords({
        ...mergedSnapshot,
        syncRecords: [createSyncRecord('manual', 'success', message), ...(mergedSnapshot.syncRecords ?? [])],
        updatedAt: new Date().toISOString(),
      });

      applySnapshot(nextSnapshot);
      await saveCloudSnapshot(userId, nextSnapshot, sessionCloudSettings);
      setCloudReadyUserId(userId);
      setCloudStatus('云端已同步');
      showToast(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : '手动同步失败';
      setCloudStatus('同步失败');
      addSyncRecord('manual', 'error', message);
      showToast(message);
    }
  };

  const clearSyncRecords = async () => {
    const syncRecordsUpdatedAt = markSyncRecordsChanged();
    setSyncRecords([]);
    showToast('同步记录已清空，不会删除提示词');

    const userId = cloudSession?.user.id;
    const snapshot = latestSnapshotRef.current;
    if (!userId || cloudReadyUserId !== userId || !snapshot) return;

    try {
      await saveCloudSnapshot(
        userId,
        cleanCloudSnapshotRecords({
          ...snapshot,
          syncRecords: [],
          exportSettings: {
            ...normalizeExportSettings(snapshot.exportSettings, exportSettings),
            syncRecordsUpdatedAt,
          },
          updatedAt: new Date().toISOString(),
        }),
        activeCloudSettings,
      );
      setCloudStatus('云端已同步');
    } catch (error) {
      const message = error instanceof Error ? error.message : '清空同步记录失败';
      addSyncRecord('manual', 'error', message);
      showToast(message);
    }
  };

  return (
    <div className="app-shell">
      <button className="mobile-menu" type="button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>
        <Menu size={18} />
      </button>

      <TopMenuBar
        activeView={activeView}
        deletedCount={deletedRecords.length}
        exportFormat={exportFormat}
        favoriteCount={prompts.filter((prompt) => prompt.favorite).length}
        importFormat={importFormat}
        promptCount={prompts.length}
        query={query}
        recentCount={prompts.filter((prompt) => prompt.lastUsedAt).length}
        onChangeView={changeView}
        onExport={exportPrompts}
        onExportFormatChange={setExportFormat}
        onImport={() => fileInputRef.current?.click()}
        onImportFormatChange={setImportFormat}
        onOpenSettings={openSettingsPanel}
        setQuery={setQuery}
      />

      <Sidebar
        activeView={activeView}
        categories={categories}
        cloudEmail={cloudSession?.user.email ?? null}
        cloudEnabled={activeCloudConfig.enabled}
        cloudStatus={cloudStatus}
        subcategoryMap={subcategoryMap}
        onAddCategory={openCategoryCreator}
        onAddSubcategory={openNewEditorInCategory}
        onChangeView={changeView}
        onClose={() => setSidebarOpen(false)}
        onCreatePrompt={openNewEditor}
        onDeleteCategory={deleteCategory}
        onDeletePrompt={deletePrompt}
        onDeleteSubcategory={deleteSubcategory}
        onManualSync={manualCloudSync}
        onMoveCategory={moveCategory}
        onMovePrompt={movePrompt}
        onOpenAuth={() => setIsAuthOpen(true)}
        onRenameCategory={renameCategory}
        onRenamePrompt={renamePrompt}
        onRenameSubcategory={renameSubcategory}
        onSelectPrompt={selectPromptFromSidebar}
        onSignOut={handleCloudSignOut}
        onStartResize={startSidebarResize}
        isGlobalSearchActive={query.trim().length > 0}
        open={sidebarOpen}
        prompts={prompts}
        selectedId={selectedId}
        width={sidebarWidth}
      />

      <main className="workspace">
        {mode === 'detail' && (
          <header className="workspace-header compact-workspace-header">
            <div className="header-actions">
              <button className="button ghost" type="button" onClick={() => setMode('list')}>
                <ArrowLeft size={16} />
                返回列表
              </button>
            </div>
          </header>
        )}

        {activeView === 'trash' ? (
          <DeletedRecordsView
            records={deletedRecords}
            onClearAll={clearDeletedRecords}
            onRemove={removeDeletedRecord}
            onRestore={restoreDeletedRecord}
          />
        ) : mode === 'detail' && selectedPrompt ? (
          <PromptDetail
            prompt={selectedPrompt}
            onCopy={copyPrompt}
            onDelete={deletePrompt}
            onDuplicate={duplicatePrompt}
            onEdit={openEditEditor}
            onToggleFavorite={toggleFavorite}
          />
        ) : (
          <PromptList
            activeLabel={getViewLabel(activeView)}
            displayMode={displayMode}
            prompts={visiblePrompts}
            query={query}
            selectedPrompt={selectedPrompt}
            total={prompts.length}
            onNew={openNewEditor}
            onCopy={copyPrompt}
            onDelete={deletePrompt}
            onDuplicate={duplicatePrompt}
            onToggleFavorite={toggleFavorite}
            onUpdateContent={updatePromptContent}
          />
        )}
      </main>

      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept=".json,.txt,.csv,application/json,text/plain,text/csv"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importPrompts(file);
        }}
      />

      {isCategoryCreatorOpen && (
        <CategoryCreatorDialog
          categories={categories}
          onClose={() => setIsCategoryCreatorOpen(false)}
          onCreate={(name) => {
            const created = createCategory(name);
            if (created) {
              setIsCategoryCreatorOpen(false);
            }
            return created;
          }}
        />
      )}

      {isEditorOpen && (
        <PromptEditor
          categories={categories}
          initialDraft={editorPrompt ? draftFromPrompt(editorPrompt) : { ...emptyDraft, category: editorInitialCategory ?? emptyDraft.category }}
          mode={editorPrompt ? 'edit' : 'new'}
          onClose={() => {
            setIsEditorOpen(false);
            setEditorInitialCategory(null);
          }}
          onSave={(draft) => {
            upsertPrompt(draft);
            setIsEditorOpen(false);
            setEditorInitialCategory(null);
          }}
        />
      )}

      {isSettingsOpen && (
        <SettingsPanel
          canManageCloud={canManageCloudSettings}
          cloudSettings={cloudSettings}
          desktopAvailable={Boolean(window.promptAssistantDesktop)}
          desktopSettings={desktopSettings}
          exportSettings={exportSettings}
          initialAboutOpen={settingsAboutInitiallyOpen}
          syncRecords={syncRecords}
          updateStatus={updateStatus}
          onClearSyncRecords={clearSyncRecords}
          onClose={() => {
            setIsSettingsOpen(false);
            setSettingsAboutInitiallyOpen(false);
          }}
          onCheckUpdate={() => runDesktopUpdateAction('checkForUpdates', '更新检查失败')}
          onDownloadUpdate={() => runDesktopUpdateAction('downloadUpdate', '更新下载失败')}
          onInstallUpdate={() => runDesktopUpdateAction('installUpdate', '更新安装失败')}
          onSave={(settings, nextCloudSettings, nextDesktopSettings) => {
            const normalizedCloudSettings = loadCloudSettings();
            if (canManageCloudSettings) {
              saveCloudSettings(nextCloudSettings);
            }
            const savedCloudSettings = loadCloudSettings();
            setCloudSettings(savedCloudSettings);
            const normalizedExportSettings = normalizeExportSettings(settings, exportSettings);
            if (JSON.stringify(normalizedExportSettings) !== JSON.stringify(normalizeExportSettings(exportSettings))) {
              setExportSettings(normalizedExportSettings);
            }
            if (canManageCloudSettings && JSON.stringify(normalizedCloudSettings) !== JSON.stringify(savedCloudSettings)) {
              setCloudSession(null);
              setCloudReadyUserId(null);
              setCloudStatus(getCloudConfig(savedCloudSettings).enabled ? '未登录' : '未配置云端');
            }
            const normalizedDesktopSettings = normalizeDesktopSettings(nextDesktopSettings, desktopSettings);
            const desktopApi = window.promptAssistantDesktop;

            if (!desktopApi) {
              setDesktopSettings(normalizedDesktopSettings);
              setIsSettingsOpen(false);
              setSettingsAboutInitiallyOpen(false);
              showToast('设置已保存');
              return;
            }

            void desktopApi
              .updateSettings(normalizedDesktopSettings)
              .then((savedDesktopSettings) => {
                setDesktopSettings(normalizeDesktopSettings(savedDesktopSettings, normalizedDesktopSettings));
                setIsSettingsOpen(false);
                setSettingsAboutInitiallyOpen(false);
                showToast('设置已保存');
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : '桌面设置保存失败';
                showToast(message);
              });
          }}
        />
      )}

      {isAuthOpen && (
        <CloudAuthPanel
          cloudEnabled={cloudLoginEnabled}
          onClose={() => setIsAuthOpen(false)}
          onSubmit={submitCloudAuth}
        />
      )}

      {closeRequestOpen && (
        <CloseRequestDialog
          remember={rememberCloseChoice}
          onCancel={() => setCloseRequestOpen(false)}
          onRememberChange={setRememberCloseChoice}
          onTray={() => performDesktopClose('tray')}
          onQuit={() => performDesktopClose('quit')}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog dialog={confirmDialog} onCancel={closeConfirmDialog} onConfirm={confirmCurrentDialog} />
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

type SidebarProps = {
  activeView: ViewKey;
  categories: string[];
  cloudEmail: string | null;
  cloudEnabled: boolean;
  cloudStatus: string;
  isGlobalSearchActive: boolean;
  subcategoryMap: Record<string, string[]>;
  onAddCategory: () => void;
  onAddSubcategory: (category: string) => void;
  onChangeView: (view: ViewKey) => void;
  onClose: () => void;
  onCreatePrompt: () => void;
  onDeleteCategory: (category: string) => void;
  onDeletePrompt: (id: string) => void;
  onDeleteSubcategory: (category: string, subcategory: string) => void;
  onManualSync: () => void | Promise<void>;
  onMoveCategory: (category: string, direction: MoveDirection) => void;
  onMovePrompt: (id: string, direction: MoveDirection) => void;
  onOpenAuth: () => void;
  onRenameCategory: (category: string, nextName: string) => boolean;
  onRenamePrompt: (id: string, nextTitle: string) => boolean;
  onRenameSubcategory: (category: string, subcategory: string, nextName: string) => boolean;
  onSelectPrompt: (prompt: PromptItem) => void;
  onSignOut: () => void;
  onStartResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  open: boolean;
  prompts: PromptItem[];
  selectedId: string | null;
  width: number;
};

function Sidebar({
  activeView,
  categories,
  cloudEmail,
  cloudEnabled,
  cloudStatus,
  isGlobalSearchActive,
  subcategoryMap,
  onAddCategory,
  onAddSubcategory,
  onChangeView,
  onClose,
  onCreatePrompt,
  onDeleteCategory,
  onDeletePrompt,
  onDeleteSubcategory,
  onManualSync,
  onMoveCategory,
  onMovePrompt,
  onOpenAuth,
  onRenameCategory,
  onRenamePrompt,
  onRenameSubcategory,
  onSelectPrompt,
  onSignOut,
  onStartResize,
  open,
  prompts,
  selectedId,
  width,
}: SidebarProps) {
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
      {open && <button className="sidebar-scrim" type="button" aria-label="关闭导航" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} style={{ flexBasis: width, width }}>
        <div className="sidebar-primary-actions">
          <button className="button ghost sidebar-action-button" type="button" onClick={onAddCategory}>
            <Plus size={16} />
            添加分类
          </button>
          <button className="button primary sidebar-action-button" type="button" onClick={onCreatePrompt}>
            <Plus size={16} />
            新建提示词
          </button>
        </div>

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
              <button className="sidebar-cloud-action" type="button" onClick={() => void onManualSync()}>
                <Cloud size={15} />
                同步
              </button>
              <button className="sidebar-cloud-action" type="button" onClick={onSignOut}>
                <LogOut size={15} />
                退出
              </button>
            </div>
          ) : (
            <button className="sidebar-login-button" type="button" disabled={!cloudEnabled} onClick={onOpenAuth}>
              <LogIn size={15} />
              登录云端
            </button>
          )}
        </div>

        <button
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
        <button
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
            {isSearchContext && <span className="context-badge">原位置</span>}
          </span>
          <span className="nav-meta">{count}</span>
        </button>
      )}
      <div className="category-actions row-actions">
        <button
          className="mini-action"
          type="button"
          aria-label={`${name}操作`}
          title="操作"
          onClick={toggleActionMenu}
        >
          <MoreHorizontal size={14} />
        </button>
        {isActionMenuOpen && actionMenuPosition && createPortal(
          <div
            className="row-action-menu"
            ref={actionMenuRef}
            style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
          >
            <button
              className="row-action-menu-item"
              type="button"
              onClick={() => {
                onAddSubcategory();
                setIsActionMenuOpen(false);
              }}
            >
              <Plus size={13} />
              新增子文件
            </button>
            <button
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
            </button>
            <button
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
            </button>
            <button
              className="row-action-menu-item"
              type="button"
              onClick={() => {
                setIsEditing(true);
                setIsActionMenuOpen(false);
              }}
            >
              <Pencil size={13} />
              重命名
            </button>
            <button
              className="row-action-menu-item danger-menu-item"
              type="button"
              onClick={() => {
                onDelete();
                setIsActionMenuOpen(false);
              }}
            >
              <Trash2 size={13} />
              删除
            </button>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

type SubcategoryNavItemProps = {
  active: boolean;
  count: number;
  name: string;
  onDelete: () => void;
  onOpen: () => void;
  onRename: (nextName: string) => boolean;
};

function SubcategoryNavItem({ active, count, name, onDelete, onOpen, onRename }: SubcategoryNavItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className={`category-item subcategory-item ${active ? 'active' : ''}`}>
      {isEditing ? (
        <form
          className="category-edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <span className="nav-icon subcategory-dot" />
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
        <button className="category-open" type="button" onClick={onOpen}>
          <span className="nav-icon subcategory-dot" />
          <span className="nav-label">{name}</span>
          <span className="nav-meta">{count}</span>
        </button>
      )}
      <div className="category-actions">
        <button
          className="mini-action"
          type="button"
          aria-label={`重命名${name}`}
          title="重命名"
          onClick={() => setIsEditing(true)}
        >
          <Pencil size={13} />
        </button>
        <button className="mini-action" type="button" aria-label={`删除${name}`} title="删除" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
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
        <button className="prompt-tree-item" type="button" onClick={onOpen}>
          <span className="prompt-tree-dot" />
          <span className="prompt-tree-title">{prompt.title}</span>
        </button>
      )}
      <div className="prompt-tree-actions row-actions">
        <button
          className="mini-action"
          type="button"
          aria-label={`${prompt.title}操作`}
          title="操作"
          onClick={toggleActionMenu}
        >
          <MoreHorizontal size={14} />
        </button>
        {isActionMenuOpen && actionMenuPosition && createPortal(
          <div
            className="row-action-menu"
            ref={actionMenuRef}
            style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
          >
            <button
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
            </button>
            <button
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
            </button>
            <button
              className="row-action-menu-item"
              type="button"
              onClick={() => {
                startRename();
                setIsActionMenuOpen(false);
              }}
            >
              <Pencil size={13} />
              重命名
            </button>
            <button
              className="row-action-menu-item danger-menu-item"
              type="button"
              onClick={() => {
                onDelete();
                setIsActionMenuOpen(false);
              }}
            >
              <Trash2 size={13} />
              删除
            </button>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

type TopMenuBarProps = {
  activeView: ViewKey;
  deletedCount: number;
  exportFormat: FileFormat;
  favoriteCount: number;
  importFormat: FileFormat;
  promptCount: number;
  query: string;
  recentCount: number;
  onChangeView: (view: ViewKey) => void;
  onExport: (format: FileFormat) => void | Promise<void>;
  onExportFormatChange: (format: FileFormat) => void;
  onImport: () => void;
  onImportFormatChange: (format: FileFormat) => void;
  onOpenSettings: () => void;
  setQuery: (query: string) => void;
};

function TopMenuBar({
  activeView,
  deletedCount,
  exportFormat,
  favoriteCount,
  importFormat,
  promptCount,
  query,
  recentCount,
  onChangeView,
  onExport,
  onExportFormatChange,
  onImport,
  onImportFormatChange,
  onOpenSettings,
  setQuery,
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
          <button className="top-menu-button" type="button" aria-expanded={openMenu === 'file'} onClick={() => toggleMenu('file')}>
            文件
          </button>
          {openMenu === 'file' && (
            <div className="top-dropdown-menu" role="menu">
              <button className="top-dropdown-item" type="button" role="menuitem" onClick={() => runMenuAction(onImport)}>
                <Import size={15} />
                导入文件
              </button>
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
              <button
                className="top-dropdown-item"
                type="button"
                role="menuitem"
                onClick={() => runMenuAction(() => onExport(exportFormat))}
              >
                <Download size={15} />
                导出文件
              </button>
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
          <button className="top-menu-button" type="button" aria-expanded={openMenu === 'view'} onClick={() => toggleMenu('view')}>
            视图
          </button>
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
          <button className="top-menu-button" type="button" onClick={() => runMenuAction(onOpenSettings)}>
            设置
          </button>
        </div>

        <label className={`top-search-box ${query.trim() ? 'is-global-search' : ''}`}>
          <Search size={15} />
          <span className="search-scope-chip">全局</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索全部提示词" aria-label="搜索提示词" />
          {query && (
            <button className="mini-clear" type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </label>
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
    <button className={`top-dropdown-item ${active ? 'active' : ''}`} type="button" role="menuitem" onClick={onClick}>
      {icon}
      <span>{label}</span>
      <small>{meta}</small>
    </button>
  );
}

type CloseRequestDialogProps = {
  remember: boolean;
  onCancel: () => void;
  onRememberChange: (remember: boolean) => void;
  onTray: () => void;
  onQuit: () => void;
};

function CloseRequestDialog({ remember, onCancel, onRememberChange, onTray, onQuit }: CloseRequestDialogProps) {
  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="close-request-title">
      <button className="modal-backdrop" type="button" aria-label="取消关闭" onClick={onCancel} />
      <section className="editor-panel close-request-panel">
        <div className="editor-header">
          <div>
            <span className="eyebrow">Close</span>
            <h2 id="close-request-title">关闭软件？</h2>
          </div>
          <button className="icon-button" type="button" aria-label="取消关闭" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        <div className="close-request-options">
          <button className="settings-option close-choice" type="button" onClick={onTray}>
            <span>
              <strong>隐藏到托盘</strong>
              <small>软件继续后台运行，可从托盘或悬浮图标调出。</small>
            </span>
          </button>
          <button className="settings-option close-choice" type="button" onClick={onQuit}>
            <span>
              <strong>直接关闭软件</strong>
              <small>退出主程序，下次需要重新打开。</small>
            </span>
          </button>
        </div>

        <label className="remember-close-option">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => onRememberChange(event.target.checked)}
          />
          <span>记住本次选择</span>
        </label>
      </section>
    </div>
  );
}

type ConfirmDialogProps = {
  dialog: ConfirmDialogState;
  onCancel: () => void;
  onConfirm: () => void;
};

function ConfirmDialog({ dialog, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog-layer" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="confirm-dialog-copy">
          <h2 id="confirm-dialog-title">{dialog.title}</h2>
          <p>{dialog.message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button className="button ghost" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="button danger solid-danger" type="button" onClick={onConfirm} autoFocus>
            {dialog.confirmLabel ?? '确认'}
          </button>
        </div>
      </section>
    </div>
  );
}

type SettingsPanelProps = {
  canManageCloud: boolean;
  cloudSettings: CloudSettings;
  desktopAvailable: boolean;
  desktopSettings: DesktopRuntimeSettings;
  exportSettings: ExportSettings;
  initialAboutOpen: boolean;
  syncRecords: SyncRecord[];
  updateStatus: DesktopUpdateStatus;
  onClearSyncRecords: () => void | Promise<void>;
  onClose: () => void;
  onCheckUpdate: () => void | Promise<void>;
  onDownloadUpdate: () => void | Promise<void>;
  onInstallUpdate: () => void | Promise<void>;
  onSave: (settings: ExportSettings, cloudSettings: CloudSettings, desktopSettings: DesktopRuntimeSettings) => void;
};

function SettingsPanel({
  canManageCloud,
  cloudSettings,
  desktopAvailable,
  desktopSettings,
  exportSettings,
  initialAboutOpen,
  syncRecords,
  updateStatus,
  onClearSyncRecords,
  onClose,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onSave,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(exportSettings);
  const [cloudDraft, setCloudDraft] = useState(cloudSettings);
  const [desktopDraft, setDesktopDraft] = useState(desktopSettings);
  const [aboutOpen, setAboutOpen] = useState(initialAboutOpen);

  useEffect(() => {
    setDesktopDraft(desktopSettings);
  }, [desktopSettings]);

  useEffect(() => {
    setAboutOpen(initialAboutOpen);
  }, [initialAboutOpen]);

  const updateDraft = (next: Partial<ExportSettings>) => {
    setDraft((current) => ({ ...current, ...next }));
  };

  const updateCloudDraft = (next: Partial<CloudSettings>) => {
    setCloudDraft((current) => ({ ...current, ...next }));
  };

  const updateDesktopDraft = (next: DesktopSettingsInput) => {
    setDesktopDraft((current) =>
      normalizeDesktopSettings(
        {
          ...current,
          ...next,
          floatingIcon: {
            ...current.floatingIcon,
            ...(next.floatingIcon ?? {}),
          },
        },
        current,
      ),
    );
  };

  const floatingOpacityPercent = Math.round(desktopDraft.floatingIcon.opacity * 100);
  const updateProgressPercent = Math.round(updateStatus.progress?.percent ?? 0);
  const updateBusy = updateStatus.status === 'checking' || updateStatus.status === 'downloading';
  const canCheckUpdate = desktopAvailable && !updateBusy;
  const canDownloadUpdate = desktopAvailable && updateStatus.status === 'available';
  const canInstallUpdate = desktopAvailable && updateStatus.status === 'downloaded';

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="settings-panel-title">
      <button className="modal-backdrop" type="button" aria-label="关闭设置" onClick={onClose} />
      <form
        className="editor-panel settings-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            { ...draft, pathHint: draft.pathHint.trim() },
            {
              ...cloudDraft,
              provider: cloudDraft.provider === 'none' ? 'none' : 'supabase',
              supabaseUrl: cloudDraft.supabaseUrl.trim().replace(/\/+$/, ''),
              supabaseAnonKey: cloudDraft.supabaseAnonKey.trim(),
              adminEmails: cloudDraft.adminEmails.map((email) => email.trim().toLowerCase()).filter(Boolean),
            },
            normalizeDesktopSettings(desktopDraft),
          );
        }}
      >
        <div className="editor-header">
          <div>
            <span className="eyebrow">Settings</span>
            <h2 id="settings-panel-title">设置</h2>
          </div>
          <div className="settings-header-actions">
            <button
              className={`button ghost small-button ${aboutOpen ? 'accent' : ''}`}
              type="button"
              aria-expanded={aboutOpen}
              aria-controls="software-about-panel"
              onClick={() => setAboutOpen((open) => !open)}
            >
              <Info size={15} />
              软件说明
            </button>
            <button className="icon-button" type="button" aria-label="关闭设置" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {aboutOpen && (
          <section className="settings-section about-section" id="software-about-panel" aria-labelledby="software-about-title">
            <div>
              <h3 id="software-about-title">软件说明</h3>
              <p>提示词助手采用安静、紧凑的双栏工作台设计，让分类管理和正文阅读保持在同一屏。</p>
            </div>

            <div className="about-layout-grid">
              <div>
                <strong>UI 布局</strong>
                <p>顶部菜单栏负责筛选、导入导出、设置和搜索；左侧是分类树、创建入口和云端状态；右侧是提示词正文区，支持查看、编辑、复制、收藏和删除。</p>
              </div>
              <div>
                <strong>视觉风格</strong>
                <p>整体使用浅色背景、低对比边框、8px 圆角和克制的青绿色强调色，目标是长期管理文本时清晰、稳定、不抢内容。</p>
              </div>
              <div>
                <strong>设计思路</strong>
                <p>主文件夹对应一级分类，子标题对应提示词标题，正文直接完整展示，减少列表和详情之间反复切换。</p>
              </div>
              <div>
                <strong>技术组成</strong>
                <p>TypeScript 和 React 负责界面与状态；CSS 负责布局和视觉；Vite 负责开发服务和前端构建；Electron 负责 Windows 桌面窗口、托盘、悬浮图标和打包；Node.js 负责脚本、测试和 Supabase 发布工作流。</p>
              </div>
            </div>
          </section>
        )}

        <section className="settings-section" aria-labelledby="update-settings-title">
          <div className="settings-section-title">
            <div>
              <h3 id="update-settings-title">软件更新</h3>
              <p>自动更新仅支持安装版，便携版和文件夹版仍用于测试和排查。</p>
            </div>
            <button className="button ghost small-button" type="button" disabled={!canCheckUpdate} onClick={() => void onCheckUpdate()}>
              <RotateCcw size={15} />
              检查更新
            </button>
          </div>

          <div className={`update-status-card ${updateStatus.status}`}>
            <div>
              <span>当前版本</span>
              <strong>提示词助手{updateStatus.currentVersion || APP_VERSION}</strong>
            </div>
            <div>
              <span>更新状态</span>
              <strong>{updateStatus.message}</strong>
              {updateStatus.availableVersion && <small>最新版本：{updateStatus.availableVersion}</small>}
            </div>
          </div>

          {updateStatus.status === 'downloading' && (
            <div className="update-progress" aria-label={`更新下载进度 ${updateProgressPercent}%`}>
              <span style={{ width: `${Math.min(100, Math.max(0, updateProgressPercent))}%` }} />
            </div>
          )}

          <div className="update-actions">
            <button className="button ghost" type="button" disabled={!canDownloadUpdate} onClick={() => void onDownloadUpdate()}>
              <Download size={16} />
              下载更新
            </button>
            <button className="button primary" type="button" disabled={!canInstallUpdate} onClick={() => void onInstallUpdate()}>
              <Check size={16} />
              重启安装
            </button>
          </div>
        </section>

        {canManageCloud && (
          <section className="settings-section" aria-labelledby="cloud-settings-title">
            <div>
              <h3 id="cloud-settings-title">云同步设置</h3>
              <p>填写 VITE_ADMIN_EMAILS 后，只有这些账号可以修改 Supabase 配置。未配置管理员时，本机可以直接修改。普通用户登录后只同步自己的数据。</p>
            </div>

            <label className="field">
              <span>云同步总开关</span>
              <select
                value={cloudDraft.provider === 'none' ? 'none' : 'enabled'}
                onChange={(event) => {
                  updateCloudDraft({
                    provider: event.target.value === 'none' ? 'none' : 'supabase',
                  });
                }}
              >
                <option value="none">关闭云同步</option>
                <option value="enabled">开启云同步</option>
              </select>
            </label>
            <p className="settings-note">云同步现在统一使用 Supabase Auth 和 prompt_libraries，每个登录账号只读写自己的数据。</p>

            {cloudDraft.provider !== 'none' && (
              <>
                <div className="cloud-route-summary">
                  <div>
                    <span>管理员账号</span>
                    <strong>{cloudDraft.adminEmails.length > 0 ? cloudDraft.adminEmails.join('、') : '未配置'}</strong>
                    <small>{cloudDraft.adminEmails.length > 0 ? '可修改 Supabase 配置' : '本机可以直接修改云端配置'}</small>
                  </div>
                  <div>
                    <span>数据存储</span>
                    <strong>Supabase</strong>
                    <small>普通用户不能修改云端配置</small>
                  </div>
                </div>

              </>
            )}

            {cloudDraft.provider !== 'none' && (
              <div className="settings-grid">
                <label className="field">
                  <span>Supabase URL</span>
                  <input
                    value={cloudDraft.supabaseUrl}
                    placeholder="https://xxxx.supabase.co"
                    onChange={(event) => updateCloudDraft({ supabaseUrl: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Supabase anon key</span>
                  <input
                    value={cloudDraft.supabaseAnonKey}
                    placeholder="粘贴 publishable / anon key"
                    onChange={(event) => updateCloudDraft({ supabaseAnonKey: event.target.value })}
                  />
                </label>
              </div>
            )}

          </section>
        )}

        <section className="settings-section" aria-labelledby="window-close-settings-title">
          <div>
            <h3 id="window-close-settings-title">关闭窗口</h3>
            {!desktopAvailable && <p>桌面版运行时可用。</p>}
          </div>

          <div className="settings-options">
            {[
              { value: 'ask', title: '每次询问', description: '点击窗口 X 时选择关闭软件或隐藏到托盘。' },
              { value: 'tray', title: '隐藏到托盘', description: '点击窗口 X 后保留后台运行，可从托盘或悬浮图标调出。' },
              { value: 'quit', title: '直接关闭软件', description: '点击窗口 X 后退出主程序。' },
            ].map((option) => (
              <label className={`settings-option ${!desktopAvailable ? 'is-disabled' : ''}`} key={option.value}>
                <input
                  type="radio"
                  name="close-behavior"
                  checked={desktopDraft.closeBehavior === option.value}
                  disabled={!desktopAvailable}
                  onChange={() => updateDesktopDraft({ closeBehavior: option.value as DesktopCloseBehavior })}
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section" aria-labelledby="floating-icon-settings-title">
          <div>
            <h3 id="floating-icon-settings-title">悬浮图标</h3>
            {!desktopAvailable && <p>桌面版运行时可用。</p>}
          </div>

          <div className="desktop-settings-grid">
            <label className={`settings-option toggle-option ${!desktopAvailable ? 'is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={desktopDraft.floatingIcon.enabled}
                disabled={!desktopAvailable}
                onChange={(event) => updateDesktopDraft({ floatingIcon: { enabled: event.target.checked } })}
              />
              <span>
                <strong>显示悬浮图标</strong>
                <small>单击调出主界面，右键可关闭。</small>
              </span>
            </label>

            <label className={`floating-opacity-control ${!desktopDraft.floatingIcon.enabled ? 'is-disabled' : ''}`}>
              <span>
                <strong>透明度</strong>
                <b>{floatingOpacityPercent}%</b>
              </span>
              <input
                type="range"
                min="25"
                max="100"
                step="5"
                value={floatingOpacityPercent}
                disabled={!desktopAvailable || !desktopDraft.floatingIcon.enabled}
                onChange={(event) =>
                  updateDesktopDraft({ floatingIcon: { opacity: Number(event.target.value) / 100 } })
                }
              />
            </label>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="export-settings-title">
          <div>
            <h3 id="export-settings-title">导出设置</h3>
            <p>设置导出文件时的保存方式。</p>
          </div>

          <div className="settings-options">
            <label className="settings-option">
              <input
                type="radio"
                name="export-mode"
                checked={draft.mode === 'download'}
                onChange={() => updateDraft({ mode: 'download' })}
              />
              <span>
                <strong>浏览器默认下载目录</strong>
                <small>点击导出后直接下载到浏览器默认目录。</small>
              </span>
            </label>
            <label className="settings-option">
              <input
                type="radio"
                name="export-mode"
                checked={draft.mode === 'picker'}
                onChange={() => updateDraft({ mode: 'picker' })}
              />
              <span>
                <strong>导出时选择保存位置</strong>
                <small>支持的浏览器会弹出系统保存窗口。</small>
              </span>
            </label>
          </div>

          <label className="field">
            <span>路径备注</span>
            <input
              value={draft.pathHint}
              placeholder={'例如：D:\\提示词备份'}
              onChange={(event) => updateDraft({ pathHint: event.target.value })}
            />
          </label>
          <p className="settings-note">浏览器安全规则不允许网页静默写入固定本地路径；选择保存位置时，会在导出时弹出保存窗口。</p>
        </section>

        <section className="settings-section" aria-labelledby="sync-record-settings-title">
          <div className="settings-section-title">
            <div>
              <h3 id="sync-record-settings-title">同步记录</h3>
              <p>这里只记录同步动作，自动保留最近 30 天。清空记录不会删除本地或云端提示词。</p>
            </div>
            <button className="button ghost small-button" type="button" disabled={!syncRecords.length} onClick={() => void onClearSyncRecords()}>
              清空记录
            </button>
          </div>

          {syncRecords.length ? (
            <div className="sync-record-list">
              {syncRecords.map((record) => (
                <div className={`sync-record-item ${record.status}`} key={record.id}>
                  <span>{record.status === 'success' ? '成功' : '失败'}</span>
                  <strong>{record.message}</strong>
                  <small>
                    {formatDate(record.createdAt)} ·{' '}
                    {record.action === 'manual' ? '手动同步' : record.action === 'login' ? '登录同步' : '自动同步'}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-note">暂无同步记录。</p>
          )}
        </section>

        <div className="editor-footer">
          <button className="button ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit">
            保存设置
          </button>
        </div>
      </form>
    </div>
  );
}

type CloudAuthPanelProps = {
  cloudEnabled: boolean;
  onClose: () => void;
  onSubmit: (mode: 'signin' | 'signup', email: string, password: string, remember: boolean) => Promise<void>;
};

function CloudAuthPanel({ cloudEnabled, onClose, onSubmit }: CloudAuthPanelProps) {
  const rememberedLogin = useMemo(() => loadRememberedCloudLogin(), []);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState(rememberedLogin.email);
  const [password, setPassword] = useState(rememberedLogin.password);
  const [remember, setRemember] = useState(Boolean(rememberedLogin.email || rememberedLogin.password));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = cloudEnabled && email.trim().length > 0 && password.length >= 6 && !busy;

  const submit = async (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError('');
    try {
      await onSubmit(mode, email.trim(), password, remember);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="cloud-auth-title">
      <button className="modal-backdrop" type="button" aria-label="关闭登录" onClick={onClose} />
      <form className="editor-panel auth-panel" onSubmit={submit}>
        <div className="editor-header">
          <div>
            <span className="eyebrow">Cloud Sync</span>
            <h2 id="cloud-auth-title">{mode === 'signin' ? '登录账户' : '注册账户'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭登录" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {!cloudEnabled && (
          <div className="settings-section warning-section">
            <h3>还没有配置云端</h3>
            <p>先到设置里填写 Supabase URL 和 publishable key。</p>
          </div>
        )}

        <div className="auth-mode-switch" role="tablist" aria-label="账户操作">
          <button className={mode === 'signin' ? 'active' : ''} type="button" onClick={() => setMode('signin')}>
            登录
          </button>
          <button className={mode === 'signup' ? 'active' : ''} type="button" onClick={() => setMode('signup')}>
            注册
          </button>
        </div>

        <label className="field">
          <span>邮箱</span>
          <input
            type="email"
            value={email}
            placeholder="输入邮箱"
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            placeholder="至少 6 位"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="remember-login-option">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>保存账号和密码到这台电脑</span>
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="editor-footer">
          <button className="button ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={!canSubmit}>
            {busy ? '处理中...' : mode === 'signin' ? '登录并同步' : '注册并同步'}
          </button>
        </div>
      </form>
    </div>
  );
}

type PromptListProps = {
  activeLabel: string;
  displayMode: DisplayMode;
  prompts: PromptItem[];
  query: string;
  selectedPrompt: PromptItem | null;
  total: number;
  onNew: () => void;
  onCopy: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
  onDuplicate: (prompt: PromptItem) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateContent: (id: string, content: string) => boolean;
};

function PromptList({
  activeLabel,
  displayMode,
  prompts,
  query,
  selectedPrompt,
  total,
  onNew,
  onCopy,
  onDelete,
  onDuplicate,
  onToggleFavorite,
  onUpdateContent,
}: PromptListProps) {
  if (!prompts.length) {
    const emptyMessage =
      activeLabel === '最近使用'
        ? '复制或使用过的提示词会出现在这里。'
        : total
          ? '当前筛选没有匹配结果，可以换个关键词或分类。'
          : '先保存第一条提示词，之后就能搜索、收藏和快速复用。';

    return (
      <section className="empty-state">
        <div className="empty-icon">
          <BookOpen size={22} />
        </div>
        <h2>这里还没有提示词</h2>
        <p>{emptyMessage}</p>
        <button className="button primary" type="button" onClick={onNew}>
          <Plus size={16} />
          新建提示词
        </button>
      </section>
    );
  }

  const normalizedQuery = query.trim();
  const isGlobalSearch = normalizedQuery.length > 0;
  const currentPrompt = selectedPrompt && prompts.some((prompt) => prompt.id === selectedPrompt.id) ? selectedPrompt : prompts[0];
  const promptsToRender = displayMode === 'single' ? [currentPrompt] : prompts;

  return (
    <section className="prompt-list-section prompt-document-section">
      <div className={`document-workbar ${isGlobalSearch ? 'is-searching' : ''}`}>
        <div>
          <p className="eyebrow">{isGlobalSearch ? 'Global Search' : 'Prompt Library'}</p>
          <h1>{isGlobalSearch ? <>全局搜索：{normalizedQuery}</> : activeLabel}</h1>
          <span className="search-context">
            {isGlobalSearch
              ? '搜索全部提示词，按相关度排序。左侧分类只保留位置上下文。'
              : `${promptsToRender.length} 条提示词`}
          </span>
        </div>
        <button className="button primary document-new-button" type="button" onClick={onNew}>
          <Plus size={16} />
          新建提示词
        </button>
      </div>
      <div className="document-flow">
        {promptsToRender.map((prompt) => (
          <FullPromptCard
            key={prompt.id}
            prompt={prompt}
            onCopy={onCopy}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onToggleFavorite={onToggleFavorite}
            onUpdateContent={onUpdateContent}
          />
        ))}
      </div>
    </section>
  );
}

type DeletedRecordsViewProps = {
  records: DeletedPromptRecord[];
  onClearAll: () => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
};

function DeletedRecordsView({ records, onClearAll, onRemove, onRestore }: DeletedRecordsViewProps) {
  if (!records.length) {
    return (
      <section className="empty-state deleted-empty">
        <div className="empty-icon">
          <RotateCcw size={22} />
        </div>
        <h2>暂无删除记录</h2>
        <p>删除过的子文件会先放在这里，后续可以恢复到原来的主文件夹。</p>
      </section>
    );
  }

  return (
    <section className="prompt-list-section deleted-records-section">
      <div className="deleted-records-header">
        <div>
          <p className="eyebrow">Deleted Records</p>
          <h1>删除记录</h1>
          <span>{records.length} 条可恢复记录</span>
        </div>
        <button className="button ghost danger deleted-clear-button" type="button" onClick={onClearAll}>
          <Trash2 size={16} />
          清空全部记录
        </button>
      </div>

      <div className="deleted-record-list">
        {records.map((record) => (
          <article className="deleted-record-row" key={record.id}>
            <div className="deleted-record-main">
              <h2>{record.prompt.title}</h2>
              <p>{record.prompt.content}</p>
              <div className="deleted-record-meta">
                <span>
                  <Folder size={14} />
                  {record.prompt.category}
                </span>
                <span>
                  <Clock3 size={14} />
                  {new Intl.DateTimeFormat('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(record.deletedAt))}
                </span>
              </div>
            </div>
            <div className="deleted-record-actions">
              <button className="button primary" type="button" onClick={() => onRestore(record.id)}>
                <RotateCcw size={16} />
                恢复
              </button>
              <button className="button ghost danger" type="button" onClick={() => onRemove(record.id)}>
                <Trash2 size={16} />
                移除记录
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type FullPromptCardProps = {
  prompt: PromptItem;
  onCopy: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
  onDuplicate: (prompt: PromptItem) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateContent: (id: string, content: string) => boolean;
};

function FullPromptCard({ prompt, onCopy, onDelete, onDuplicate, onToggleFavorite, onUpdateContent }: FullPromptCardProps) {
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [draftContent, setDraftContent] = useState(prompt.content);
  const contentEditorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isEditingContent) {
      setDraftContent(prompt.content);
    }
  }, [prompt.content, prompt.id, isEditingContent]);

  useEffect(() => {
    if (isEditingContent) {
      contentEditorRef.current?.focus();
    }
  }, [isEditingContent]);

  const startContentEdit = () => {
    setDraftContent(prompt.content);
    setIsEditingContent(true);
  };

  const cancelContentEdit = () => {
    setDraftContent(prompt.content);
    setIsEditingContent(false);
  };

  const saveContentEdit = () => {
    const saved = onUpdateContent(prompt.id, draftContent);
    if (saved) {
      setIsEditingContent(false);
    }
  };

  return (
    <article className="full-prompt-card">
      <header className="full-prompt-header">
        <div className="full-prompt-title">
          <h2>{prompt.title}</h2>
        </div>
        <div className="preview-actions">
          <button className="button ghost compact top-edit-button" type="button" onClick={startContentEdit}>
            <Pencil size={16} />
            编辑
          </button>
          <button className="button primary compact top-copy-button" type="button" onClick={() => onCopy(prompt.id, prompt.content)}>
            <Copy size={16} />
            复制提示词
          </button>
          <button
            className={`icon-button ${prompt.favorite ? 'is-active' : ''}`}
            type="button"
            title={prompt.favorite ? '取消收藏' : '收藏'}
            onClick={() => onToggleFavorite(prompt.id)}
          >
            <Heart size={16} />
          </button>
          <button className="icon-button" type="button" title="复制为副本" onClick={() => onDuplicate(prompt)}>
            <Copy size={16} />
          </button>
          <button className="icon-button danger-icon" type="button" title="删除" onClick={() => onDelete(prompt.id)}>
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className={`full-prompt-content ${isEditingContent ? 'is-editing' : ''}`}>
        {isEditingContent ? (
          <>
            <textarea
              ref={contentEditorRef}
              className="inline-content-editor"
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelContentEdit();
                }

                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault();
                  saveContentEdit();
                }
              }}
            />
            <div className="inline-edit-actions">
              <button className="button ghost" type="button" onClick={cancelContentEdit}>
                取消
              </button>
              <button className="button primary" type="button" onClick={saveContentEdit}>
                保存修改
              </button>
            </div>
          </>
        ) : (
          <pre onDoubleClick={startContentEdit} title="双击编辑正文">
            {prompt.content}
          </pre>
        )}
      </div>
    </article>
  );
}

type PromptDetailProps = {
  prompt: PromptItem;
  onCopy: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
  onDuplicate: (prompt: PromptItem) => void;
  onEdit: (prompt: PromptItem) => void;
  onToggleFavorite: (id: string) => void;
};

function PromptDetail({ prompt, onCopy, onDelete, onDuplicate, onEdit, onToggleFavorite }: PromptDetailProps) {
  const variables = useMemo(() => parseVariables(prompt.content), [prompt.content]);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues({});
  }, [prompt.id]);

  const filledContent = fillVariables(prompt.content, values);
  const hasVariables = variables.length > 0;

  return (
    <section className="detail-view">
      <div className="detail-actions">
        <button className="button primary" type="button" onClick={() => onCopy(prompt.id, filledContent)}>
          <Copy size={16} />
          复制提示词
        </button>
        <button
          className={`button ghost ${prompt.favorite ? 'accent' : ''}`}
          type="button"
          onClick={() => onToggleFavorite(prompt.id)}
        >
          <Heart size={16} />
          {prompt.favorite ? '已收藏' : '收藏'}
        </button>
        <button className="button ghost" type="button" onClick={() => onEdit(prompt)}>
          <Pencil size={16} />
          编辑
        </button>
        <button className="button ghost" type="button" onClick={() => onDuplicate(prompt)}>
          <Copy size={16} />
          复制为副本
        </button>
        <button className="button ghost danger" type="button" onClick={() => onDelete(prompt.id)}>
          <Trash2 size={16} />
          删除
        </button>
      </div>

      <div className="detail-meta">
        <span>
          <Folder size={15} />
          {prompt.subcategory ? `${prompt.category} / ${prompt.subcategory}` : prompt.category}
        </span>
        <span>
          <Clock3 size={15} />
          最近使用：{formatDate(prompt.lastUsedAt)}
        </span>
      </div>

      {prompt.description && <p className="detail-description">{prompt.description}</p>}

      <div className="tag-row">
        {prompt.tags.map((tag) => (
          <span key={tag} className="tag-chip large">
            <Tag size={13} />
            {tag}
          </span>
        ))}
      </div>

      {hasVariables && (
        <div className="variable-panel">
          <div className="panel-heading">
            <div className="panel-title">
              <FileJson size={16} />
              变量填充
            </div>
            <button className="button ghost compact" type="button" onClick={() => setValues({})}>
              清空
            </button>
          </div>
          <div className="variable-grid">
            {variables.map((variable) => (
              <label key={variable} className="field">
                <span>{variable}</span>
                <input
                  value={values[variable] ?? ''}
                  onChange={(event) => setValues((current) => ({ ...current, [variable]: event.target.value }))}
                  placeholder={`填写${variable}`}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="content-panel">
        <div className="panel-heading">
          <div className="panel-title">
            <BookOpen size={16} />
            提示词正文
          </div>
          <button className="button ghost compact" type="button" onClick={() => onEdit(prompt)}>
            编辑
          </button>
        </div>
        <pre>{filledContent}</pre>
      </div>

      <div className="copy-bar">
        <button className="button primary" type="button" onClick={() => onCopy(prompt.id, filledContent)}>
          <Copy size={16} />
          复制提示词
        </button>
      </div>
    </section>
  );
}

type CategoryCreatorDialogProps = {
  categories: string[];
  onClose: () => void;
  onCreate: (name: string) => boolean;
};

function CategoryCreatorDialog({ categories, onClose, onCreate }: CategoryCreatorDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const normalizedName = name.trim();
  const canSave = normalizedName.length > 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;

    if (categories.includes(normalizedName)) {
      setError('这个分类已经存在');
      return;
    }

    if (!onCreate(normalizedName)) {
      setError('分类名称无效或已存在');
    }
  };

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="category-create-title">
      <button className="modal-backdrop" type="button" aria-label="关闭新增分类" onClick={onClose} />
      <form className="editor-panel category-editor-panel" onSubmit={handleSubmit}>
        <div className="editor-header">
          <div>
            <h2 id="category-create-title">新增分类</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <label className="field">
          <span>分类名称</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError('');
            }}
            placeholder="例如：运营"
            autoFocus
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="editor-footer">
          <button className="button ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={!canSave}>
            创建分类
          </button>
        </div>
      </form>
    </div>
  );
}

type PromptEditorProps = {
  categories: string[];
  initialDraft: PromptDraft;
  mode: 'new' | 'edit';
  onClose: () => void;
  onSave: (draft: PromptDraft) => void;
};

function PromptEditor({ categories, initialDraft, mode, onClose, onSave }: PromptEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [showCategoryOptions, setShowCategoryOptions] = useState(false);
  const canSave = draft.title.trim().length > 0 && draft.content.trim().length > 0;
  const categoryOptions = categories;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (canSave) {
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSave, draft, onClose, onSave]);

  const updateDraft = <Key extends keyof PromptDraft>(key: Key, value: PromptDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = () => {
    onSave({
      ...draft,
      title: draft.title.trim(),
      description: '',
      subcategory: '',
      tags: '',
      favorite: false,
    });
  };

  return (
    <div className="modal-shell" role="dialog" aria-modal="true" aria-label={mode === 'new' ? '新建提示词' : '编辑提示词'}>
      <button className="modal-backdrop" type="button" aria-label="关闭编辑器" onClick={onClose} />
      <form
        className="editor-panel simple-editor-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) handleSave();
        }}
      >
        <div className="editor-header">
          <div>
            <h2>{mode === 'new' ? '新建提示词' : '编辑提示词'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="editor-grid simple-editor-grid">
          <label className="field">
            <span>主文件夹</span>
            <div className="folder-combobox">
              <input
                value={draft.category}
                onBlur={() => window.setTimeout(() => setShowCategoryOptions(false), 120)}
                onChange={(event) => {
                  updateDraft('category', event.target.value);
                  setShowCategoryOptions(true);
                }}
                onClick={() => setShowCategoryOptions(true)}
                onFocus={() => setShowCategoryOptions(true)}
                placeholder="选择或输入主文件夹"
              />
              <button
                className="combo-toggle"
                type="button"
                aria-label="展开主文件夹列表"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowCategoryOptions((isOpen) => !isOpen)}
              >
                <ChevronDown size={16} />
              </button>
              {showCategoryOptions && (
                <div className="combo-menu" role="listbox">
                  {categoryOptions.length ? (
                    categoryOptions.map((category) => (
                      <button
                        key={category}
                        className={category === draft.category ? 'active' : ''}
                        type="button"
                        role="option"
                        aria-selected={category === draft.category}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          updateDraft('category', category);
                          setShowCategoryOptions(false);
                        }}
                      >
                        {category}
                      </button>
                    ))
                  ) : (
                    <div className="combo-empty">保存后创建新文件夹</div>
                  )}
                </div>
              )}
            </div>
          </label>

          <label className="field">
            <span>子文件名称</span>
            <input
              value={draft.title}
              onChange={(event) => updateDraft('title', event.target.value)}
              placeholder="例如：代码审查助手"
              autoFocus
            />
          </label>
        </div>

        <label className="field content-field">
          <span>提示词内容</span>
          <textarea
            value={draft.content}
            onChange={(event) => updateDraft('content', event.target.value)}
            placeholder="可以粘贴完整提示词，也可以直接输入"
          />
        </label>

        <div className="editor-footer">
          <button className="button ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={!canSave}>
            {mode === 'new' ? '创建提示词' : '保存修改'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
