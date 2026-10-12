import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { DeletedPromptRecord, PromptItem, SyncRecord } from './types';

export type CloudProvider = 'none' | 'supabase';
export type StorageCloudProvider = 'supabase';

export type CloudSettings = {
  provider: CloudProvider;
  supabaseUrl: string;
  supabaseAnonKey: string;
  adminEmails: string[];
};

export type CloudConfig = {
  enabled: boolean;
  provider: CloudProvider;
  url: string;
  label: string;
};

export type CloudSession = {
  accessToken?: string;
  provider: StorageCloudProvider;
  user: {
    id: string;
    email?: string;
  };
};

export type CloudSnapshot = {
  prompts: PromptItem[];
  categories: string[];
  subcategories: Record<string, string[]>;
  documentCategories: string[];
  documentSubcategories: Record<string, string[]>;
  deletedRecords: DeletedPromptRecord[];
  syncRecords: SyncRecord[];
  exportSettings: unknown;
  updatedAt?: string;
};

type PromptLibraryRow = {
  prompts: unknown;
  categories: unknown;
  subcategories: unknown;
  deleted_records: unknown;
  sync_records?: unknown;
  export_settings: unknown;
  updated_at: string | null;
};

type LegacyCloudSettings = Partial<CloudSettings> & {
  provider?: unknown;
  apiBaseUrl?: unknown;
  adminProvider?: unknown;
  defaultUserProvider?: unknown;
  userRoutes?: unknown;
};

const CLOUD_SETTINGS_KEY = 'prompt-library.cloudSettings.v1';
const LEGACY_API_AUTH_KEY = 'prompt-library.apiAuth.v1';

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '') ?? '';
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

const defaultProvider: CloudProvider = envSupabaseUrl && envSupabaseAnonKey ? 'supabase' : 'none';

const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, '');

export const normalizeCloudEmail = (email?: string | null) => (email ?? '').trim().toLowerCase();

const envAdminEmails = Array.from(new Set(
  (import.meta.env.VITE_ADMIN_EMAILS ?? '')
    .split(',')
    .map((item) => normalizeCloudEmail(item))
    .filter(Boolean),
));

const defaultCloudSettings: CloudSettings = {
  provider: defaultProvider,
  supabaseUrl: envSupabaseUrl,
  supabaseAnonKey: envSupabaseAnonKey,
  adminEmails: envAdminEmails,
};

const normalizeProvider = (provider: unknown, settings: LegacyCloudSettings): CloudProvider => {
  if (provider === 'none') return 'none';
  if (provider === 'supabase') return 'supabase';

  if (provider === 'vps' || settings.adminProvider === 'vps' || settings.defaultUserProvider === 'vps') {
    return settings.supabaseUrl || envSupabaseUrl ? 'supabase' : defaultProvider;
  }

  return defaultProvider;
};

const normalizeAdminEmails = (value: unknown) => {
  const source = Array.isArray(value) ? value : [];
  const emails = source
    .map((item) => (typeof item === 'string' ? normalizeCloudEmail(item) : ''))
    .filter(Boolean);
  return Array.from(new Set(emails));
};

const clearLegacyApiAuth = () => {
  try {
    window.localStorage.removeItem(LEGACY_API_AUTH_KEY);
  } catch {
    // Ignore unavailable storage during early browser startup.
  }
};

const normalizeCloudSettings = (value: unknown): CloudSettings => {
  clearLegacyApiAuth();

  if (!value || typeof value !== 'object') {
    return defaultCloudSettings;
  }

  const candidate = value as LegacyCloudSettings;
  return {
    provider: normalizeProvider(candidate.provider, candidate),
    supabaseUrl:
      typeof candidate.supabaseUrl === 'string'
        ? normalizeBaseUrl(candidate.supabaseUrl)
        : defaultCloudSettings.supabaseUrl,
    supabaseAnonKey:
      typeof candidate.supabaseAnonKey === 'string'
        ? candidate.supabaseAnonKey.trim()
        : defaultCloudSettings.supabaseAnonKey,
    adminEmails: normalizeAdminEmails(candidate.adminEmails),
  };
};

export const loadCloudSettings = (): CloudSettings => {
  try {
    const raw = window.localStorage.getItem(CLOUD_SETTINGS_KEY);
    return raw ? normalizeCloudSettings(JSON.parse(raw)) : normalizeCloudSettings(defaultCloudSettings);
  } catch {
    return normalizeCloudSettings(defaultCloudSettings);
  }
};

export const saveCloudSettings = (settings: CloudSettings) => {
  window.localStorage.setItem(CLOUD_SETTINGS_KEY, JSON.stringify(normalizeCloudSettings(settings)));
};

export const isAdminCloudUser = (email?: string | null, settings: CloudSettings = loadCloudSettings()) => {
  if (settings.adminEmails.length === 0) {
    return true;
  }

  return settings.adminEmails.map(normalizeCloudEmail).includes(normalizeCloudEmail(email));
};

export const getCloudSettingsForProvider = (
  provider: CloudProvider,
  settings: CloudSettings = loadCloudSettings(),
): CloudSettings => ({
  ...settings,
  provider,
});

export const getCloudSettingsForEmail = (_email?: string | null, settings: CloudSettings = loadCloudSettings()) =>
  getCloudSettingsForProvider(settings.provider === 'none' ? 'none' : 'supabase', settings);

export const hasConfiguredCloudEndpoint = (settings: CloudSettings = loadCloudSettings()) =>
  getCloudConfig(getCloudSettingsForProvider('supabase', settings)).enabled;

export const getCloudConfig = (settings: CloudSettings = loadCloudSettings()): CloudConfig => {
  if (settings.provider === 'supabase') {
    return {
      enabled: Boolean(settings.supabaseUrl && settings.supabaseAnonKey),
      provider: 'supabase',
      url: settings.supabaseUrl,
      label: 'Supabase',
    };
  }

  return {
    enabled: false,
    provider: 'none',
    url: '',
    label: '未配置',
  };
};

let supabaseClient: SupabaseClient | null = null;
let supabaseClientKey = '';

const makeSupabaseStorageKey = (url: string) => `prompt-library.supabase.${btoa(url).replace(/[=+/]/g, '')}`;

const getSupabaseClient = (settings: CloudSettings = loadCloudSettings()) => {
  if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
    throw new Error('请先在设置里填写 Supabase URL 和 publishable key');
  }

  const key = `${settings.supabaseUrl}|${settings.supabaseAnonKey}`;
  if (!supabaseClient || supabaseClientKey !== key) {
    supabaseClient = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storageKey: makeSupabaseStorageKey(settings.supabaseUrl),
      },
    });
    supabaseClientKey = key;
  }

  return supabaseClient;
};

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const normalizeSubcategories = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([category, items]) => typeof category === 'string' && Array.isArray(items))
      .map(([category, items]) => [category, normalizeStringArray(items)]),
  );
};

// 文档分类放在 export_settings.documentLibrary 里，不给表加列，旧库不用迁移也能同步。
const readDocumentLibrary = (exportSettings: unknown) => {
  const library = (exportSettings as { documentLibrary?: { categories?: unknown; subcategories?: unknown } } | null)
    ?.documentLibrary;
  return { categories: library?.categories, subcategories: library?.subcategories };
};

const rowToSnapshot = (row: PromptLibraryRow): CloudSnapshot => ({
  prompts: Array.isArray(row.prompts) ? (row.prompts as PromptItem[]) : [],
  categories: normalizeStringArray(row.categories),
  subcategories: normalizeSubcategories(row.subcategories),
  documentCategories: normalizeStringArray(readDocumentLibrary(row.export_settings).categories),
  documentSubcategories: normalizeSubcategories(readDocumentLibrary(row.export_settings).subcategories),
  deletedRecords: Array.isArray(row.deleted_records) ? (row.deleted_records as DeletedPromptRecord[]) : [],
  syncRecords: Array.isArray(row.sync_records) ? (row.sync_records as SyncRecord[]) : [],
  exportSettings: row.export_settings ?? {},
  updatedAt: row.updated_at ?? undefined,
});

const normalizeSupabaseSession = (session: Session | null): CloudSession | null =>
  session
    ? {
        accessToken: session.access_token,
        provider: 'supabase',
        user: {
          id: session.user.id,
          email: session.user.email,
        },
      }
    : null;

export const getCurrentCloudSession = async (settings: CloudSettings = loadCloudSettings()): Promise<CloudSession | null> => {
  const config = getCloudConfig(settings);
  if (!config.enabled) return null;

  const client = getSupabaseClient(settings);
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(error.message);
  return normalizeSupabaseSession(data.session);
};

export const subscribeToCloudAuth = (
  onChange: (session: CloudSession | null) => void,
  settings: CloudSettings = loadCloudSettings(),
) => {
  const config = getCloudConfig(settings);
  if (!config.enabled) return () => undefined;

  const client = getSupabaseClient(settings);
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    onChange(normalizeSupabaseSession(session));
  });

  return () => data.subscription.unsubscribe();
};

export const signInToCloud = async (
  email: string,
  password: string,
  settings: CloudSettings = getCloudSettingsForEmail(email),
): Promise<CloudSession> => {
  const config = getCloudConfig(settings);
  if (!config.enabled) throw new Error('还没有配置 Supabase 云同步参数');

  const client = getSupabaseClient(settings);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const session = normalizeSupabaseSession(data.session);
  if (!session) throw new Error('登录失败');
  return session;
};

export const signUpToCloud = async (
  email: string,
  password: string,
  settings: CloudSettings = getCloudSettingsForEmail(email),
): Promise<CloudSession | null> => {
  const config = getCloudConfig(settings);
  if (!config.enabled) throw new Error('还没有配置 Supabase 云同步参数');

  const client = getSupabaseClient(settings);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return normalizeSupabaseSession(data.session);
};

export const signOutFromCloud = async (settings: CloudSettings = loadCloudSettings()) => {
  const config = getCloudConfig(settings);

  if (config.provider === 'supabase' && config.enabled) {
    const client = getSupabaseClient(settings);
    const { error } = await client.auth.signOut();
    if (error) throw new Error(error.message);
  }
};

export const loadCloudSnapshot = async (
  userId: string,
  settings: CloudSettings = loadCloudSettings(),
): Promise<CloudSnapshot | null> => {
  const config = getCloudConfig(settings);
  if (!config.enabled) throw new Error('请先配置 Supabase 云同步');

  const client = getSupabaseClient(settings);
  const { data, error } = await client
    .from('prompt_libraries')
    .select('prompts,categories,subcategories,deleted_records,sync_records,export_settings,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? rowToSnapshot(data as PromptLibraryRow) : null;
};

export const loadCloudUpdatedAt = async (userId: string, settings: CloudSettings = loadCloudSettings()) => {
  const client = getSupabaseClient(settings);
  const { data, error } = await client.from('prompt_libraries').select('updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.updated_at as string | null | undefined) ?? null;
};

export class CloudConflictError extends Error {}

// expectedUpdatedAt 是本机上次读到或写入的云端 updated_at；null 表示云端还没有这一行。
// 云端已被其他设备改过时抛 CloudConflictError，调用方先合并再写。返回新的 updated_at。
export const saveCloudSnapshot = async (
  userId: string,
  snapshot: CloudSnapshot,
  expectedUpdatedAt: string | null,
  settings: CloudSettings = loadCloudSettings(),
): Promise<string> => {
  const config = getCloudConfig(settings);
  if (!config.enabled) throw new Error('请先配置 Supabase 云同步');

  const client = getSupabaseClient(settings);
  const row = {
    user_id: userId,
    prompts: snapshot.prompts,
    categories: snapshot.categories,
    subcategories: snapshot.subcategories,
    deleted_records: snapshot.deletedRecords,
    sync_records: snapshot.syncRecords,
    export_settings: {
      ...(snapshot.exportSettings as object),
      documentLibrary: { categories: snapshot.documentCategories, subcategories: snapshot.documentSubcategories },
    },
    updated_at: new Date().toISOString(),
  };
  const table = client.from('prompt_libraries');
  const { data, error } = await (expectedUpdatedAt === null
    ? table.insert(row)
    : table.update(row).eq('user_id', userId).eq('updated_at', expectedUpdatedAt)
  ).select('updated_at');

  if (error?.code === '23505' || (!error && !data?.length)) {
    throw new CloudConflictError('云端数据已被其他设备更新');
  }
  if (error) throw new Error(error.message);
  return data[0].updated_at as string;
};

const DOCUMENT_BUCKET = 'prompt-attachments';

const describeStorageError = (error: { message: string }) =>
  /bucket not found/i.test(error.message)
    ? '云端文件存储还没开启：请在 Supabase SQL Editor 执行最新的 supabase-schema.sql'
    : error.message;

// 文档文件按 <user_id>/<sha256> 存在私有 bucket 里，同内容只传一次。
export const listCloudFileShas = async (userId: string, settings: CloudSettings = loadCloudSettings()) => {
  const bucket = getSupabaseClient(settings).storage.from(DOCUMENT_BUCKET);
  const shas = new Set<string>();
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(userId, { limit: pageSize, offset });
    if (error) throw new Error(describeStorageError(error));
    data.forEach((item) => shas.add(item.name));
    if (data.length < pageSize) return shas;
  }
};

export const uploadCloudFile = async (
  userId: string,
  sha256: string,
  bytes: Uint8Array,
  settings: CloudSettings = loadCloudSettings(),
) => {
  const { error } = await getSupabaseClient(settings)
    .storage.from(DOCUMENT_BUCKET)
    .upload(`${userId}/${sha256}`, bytes, { contentType: 'application/octet-stream', upsert: false });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(describeStorageError(error));
};

export const downloadCloudFile = async (userId: string, sha256: string, settings: CloudSettings = loadCloudSettings()) => {
  const { data, error } = await getSupabaseClient(settings).storage.from(DOCUMENT_BUCKET).download(`${userId}/${sha256}`);
  if (error) throw new Error(/not found|object/i.test(error.message) ? '云端也没有这个文件' : describeStorageError(error));
  return new Uint8Array(await data.arrayBuffer());
};
