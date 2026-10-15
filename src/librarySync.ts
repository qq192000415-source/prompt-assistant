import type { CloudSnapshot } from './cloudSync';
import { SAMPLE_PROMPTS } from './data.ts';
import { createId } from './promptUtils.ts';
import type { DeletedPromptRecord, PromptItem, SyncRecord } from './types';

const MAX_SYNC_RECORDS = 80;
const RECORD_RETENTION_DAYS = 30;
const RECORD_RETENTION_MS = RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type ExportMode = 'download' | 'picker';

export type ExportSettings = {
  mode: ExportMode;
  pathHint: string;
  libraryUpdatedAt?: string;
  deletedRecordsUpdatedAt?: string;
  syncRecordsUpdatedAt?: string;
};

export const defaultExportSettings: ExportSettings = {
  mode: 'download',
  pathHint: '',
};

export const isExportMode = (mode: unknown): mode is ExportMode => mode === 'download' || mode === 'picker';

export const isValidDateString = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export const normalizeExportSettings = (value: unknown, fallback: ExportSettings = defaultExportSettings): ExportSettings => {
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

export const isDocumentItem = (prompt: Pick<PromptItem, 'kind'>) => prompt.kind === 'document';

// 提示词和文档各有一套分类：分类、子分类、删除记录都按条目类型分开过滤。
const filterLibraryCategories = (
  snapshot: Pick<CloudSnapshot, 'categories' | 'subcategories' | 'documentCategories' | 'documentSubcategories'>,
  prompts: PromptItem[],
  deletedRecords: DeletedPromptRecord[],
) => {
  const documents = prompts.filter(isDocumentItem);
  const promptItems = prompts.filter((prompt) => !isDocumentItem(prompt));
  const recordsFor = (forDocuments: boolean) => deletedRecords.filter((record) => isDocumentItem(record.prompt) === forDocuments);

  return {
    categories: filterCategoriesByDeletedRecords(snapshot.categories, promptItems, recordsFor(false)),
    subcategories: filterSubcategoriesByPrompts(snapshot.subcategories, promptItems),
    documentCategories: filterCategoriesByDeletedRecords(snapshot.documentCategories, documents, recordsFor(true)),
    documentSubcategories: filterSubcategoriesByPrompts(snapshot.documentSubcategories, documents),
  };
};

const normalizePromptDuplicatePart = (value?: string) =>
  (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export const getPromptDuplicateKey = (prompt: Pick<PromptItem, 'category' | 'subcategory' | 'title' | 'content'>) =>
  [
    normalizePromptDuplicatePart(prompt.category),
    normalizePromptDuplicatePart(prompt.subcategory),
    normalizePromptDuplicatePart(prompt.title),
    normalizePromptDuplicatePart(prompt.content),
  ].join('\u001f');

export const dedupePrompts = (items: PromptItem[]) => {
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

export const appendPromptsToCategoryEnd = (items: PromptItem[], additions: PromptItem[]) => {
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

export const findDuplicatePrompt = (
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

export const mergeCloudSnapshot = (localSnapshot: CloudSnapshot, cloudSnapshot: CloudSnapshot): CloudSnapshot => {
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

  const pickList = (local: string[], cloud: string[]) => (preferLocalLibrary ? local : mergeStringList(cloud, local));
  const pickMap = (local: Record<string, string[]>, cloud: Record<string, string[]>) =>
    preferLocalLibrary ? local : mergeSubcategoryMap(local, cloud);
  const libraryCategories = filterLibraryCategories(
    {
      categories: pickList(localSnapshot.categories, cloudSnapshot.categories),
      subcategories: pickMap(localSnapshot.subcategories, cloudSnapshot.subcategories),
      documentCategories: pickList(localSnapshot.documentCategories, cloudSnapshot.documentCategories),
      documentSubcategories: pickMap(localSnapshot.documentSubcategories, cloudSnapshot.documentSubcategories),
    },
    prompts,
    deletedRecords,
  );
  const exportSettings = mergeExportSettingsState(localSnapshot, cloudSnapshot, deletedRecords, syncRecords);

  return {
    prompts,
    ...libraryCategories,
    deletedRecords,
    syncRecords,
    exportSettings,
    updatedAt: new Date().toISOString(),
  };
};

export const hasCloudSnapshotData = (snapshot: CloudSnapshot | null) =>
  Boolean(
    snapshot &&
      (snapshot.prompts.length > 0 ||
        snapshot.deletedRecords.length > 0 ||
        snapshot.categories.length > 0 ||
        snapshot.documentCategories.length > 0),
  );

export const isFreshRecord = (date: string) => {
  const time = Date.parse(date);
  return Number.isFinite(time) && Date.now() - time <= RECORD_RETENTION_MS;
};

export const cleanSyncRecords = (records: SyncRecord[]) =>
  records
    .filter((record) => isFreshRecord(record.createdAt))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_SYNC_RECORDS);

export const cleanCloudSnapshotRecords = (snapshot: CloudSnapshot): CloudSnapshot => {
  const deletedRecords = snapshot.deletedRecords.filter((record) => isFreshRecord(record.deletedAt));
  const prompts = dedupePrompts(snapshot.prompts.filter((prompt) => !isPromptDeletedByRecords(prompt, deletedRecords)));

  return {
    ...snapshot,
    prompts,
    ...filterLibraryCategories(snapshot, prompts, deletedRecords),
    deletedRecords,
    syncRecords: cleanSyncRecords(snapshot.syncRecords ?? []),
  };
};

const SAMPLE_PROMPT_IDS = new Set(SAMPLE_PROMPTS.map((prompt) => prompt.id));

// 本机只有示例数据、也没删过东西时，登录后直接用云端数据，不把示例合并上去。
export const isSampleOnlySnapshot = (snapshot: CloudSnapshot) =>
  snapshot.prompts.length > 0 &&
  snapshot.prompts.every((prompt) => SAMPLE_PROMPT_IDS.has(prompt.id)) &&
  snapshot.deletedRecords.length === 0;

// 登录或手动同步时把本机和云端合成一份：本机只有示例数据就直接用云端，云端还没有这一行就用本机。
export const reconcileWithCloud = (localSnapshot: CloudSnapshot, cloudSnapshot: CloudSnapshot | null) => {
  const pullCloudOnly = Boolean(cloudSnapshot && hasCloudSnapshotData(cloudSnapshot) && isSampleOnlySnapshot(localSnapshot));
  const snapshot = cloudSnapshot ? (pullCloudOnly ? cloudSnapshot : mergeCloudSnapshot(localSnapshot, cloudSnapshot)) : localSnapshot;
  return { snapshot, pullCloudOnly };
};

// 写回云端前：记一条同步记录、刷新 updatedAt、清掉过期记录和已删除的条目。
export const stampSnapshot = (snapshot: CloudSnapshot, record: SyncRecord): CloudSnapshot =>
  cleanCloudSnapshotRecords({
    ...snapshot,
    syncRecords: [record, ...(snapshot.syncRecords ?? [])],
    updatedAt: new Date().toISOString(),
  });

export const createSyncRecord = (
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

export const createDeletedRecord = (
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

export const uniqueCategories = (categories: string[]) =>
  Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean)));

export const uniqueSubcategories = (subcategories: string[]) =>
  Array.from(new Set(subcategories.map((subcategory) => subcategory.trim()).filter(Boolean)));

export const deriveCategories = (storedCategories: string[], items: PromptItem[]) =>
  uniqueCategories([...storedCategories, ...items.map((item) => item.category)]);

export const deriveSubcategoryMap = (storedSubcategories: Record<string, string[]>, items: PromptItem[]) => {
  const map: Record<string, string[]> = {};

  for (const [category, subcategories] of Object.entries(storedSubcategories)) {
    map[category] = uniqueSubcategories(subcategories);
  }

  for (const item of items) {
    if (!item.subcategory) continue;
    map[item.category] = uniqueSubcategories([...(map[item.category] ?? []), item.subcategory]);
  }

  return map;
};
