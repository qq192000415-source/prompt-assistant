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

// 素材库 NAS 授权（表 nas_grants，见 supabase-schema.sql）：管理员给账号开通 NAS 连接，对方登录后自动连上。
export type NasGrant = { email: string; baseUrl: string; username: string; password: string; updatedAt: string };

type NasGrantRow = { email: string; base_url: string; username: string; password: string; updated_at: string };

const rowToGrant = (row: NasGrantRow): NasGrant => ({ email: row.email, baseUrl: row.base_url, username: row.username, password: row.password, updatedAt: row.updated_at });

// 没执行过建表 SQL 时 Supabase 报找不到表，换成能看懂的话。
const grantError = (message: string) =>
  /nas_grants|schema cache|does not exist/i.test(message) ? new Error('Supabase 里还没有 NAS 授权表，请先执行 supabase-schema.sql 末尾的「素材库 NAS 授权」那段') : new Error(message);

export const loadOwnNasGrant = async (email: string, settings: CloudSettings = loadCloudSettings()) => {
  const { data, error } = await getSupabaseClient(settings).from('nas_grants').select('*').eq('email', normalizeCloudEmail(email)).maybeSingle();
  if (error) throw grantError(error.message);
  return data ? rowToGrant(data as NasGrantRow) : null;
};

export const listNasGrants = async (settings: CloudSettings = loadCloudSettings()) => {
  const { data, error } = await getSupabaseClient(settings).from('nas_grants').select('*').order('email');
  if (error) throw grantError(error.message);
  return (data as NasGrantRow[]).map(rowToGrant);
};

export const saveNasGrant = async (grant: Omit<NasGrant, 'updatedAt'>, settings: CloudSettings = loadCloudSettings()) => {
  const row = { email: normalizeCloudEmail(grant.email), base_url: grant.baseUrl, username: grant.username, password: grant.password, updated_at: new Date().toISOString() };
  const { error } = await getSupabaseClient(settings).from('nas_grants').upsert(row);
  if (error) throw grantError(error.message);
};

export const deleteNasGrant = async (email: string, settings: CloudSettings = loadCloudSettings()) => {
  const { error } = await getSupabaseClient(settings).from('nas_grants').delete().eq('email', normalizeCloudEmail(email));
  if (error) throw grantError(error.message);
};

// 授权管理的用户列表（函数 list_app_users，只给管理员）和备注（表 app_user_notes）。apiUrl 是给这个账号推荐的 API 地址（表 api_recommendations），空表示不推荐。
export type AppUser = { email: string; registeredAt: string | null; lastSignInAt: string | null; granted: boolean; grantedAt: string | null; note: string; tags: string[]; apiUrl: string };

type AppUserRow = { email: string; registered_at: string | null; last_sign_in_at: string | null; granted: boolean; granted_at: string | null; note: string; tags: string[] | null; api_base_url?: string | null };

const userListError = (message: string) =>
  /list_app_users|app_user_notes|schema cache|does not exist|Could not find/i.test(message)
    ? new Error('Supabase 里还没有用户列表功能，请先执行 supabase-schema.sql 末尾的「授权管理的用户列表和备注」那段')
    : new Error(message);

export const listAppUsers = async (settings: CloudSettings = loadCloudSettings()) => {
  const { data, error } = await getSupabaseClient(settings).rpc('list_app_users');
  if (error) throw userListError(error.message);
  return ((data ?? []) as AppUserRow[]).map((row) => ({
    email: row.email,
    registeredAt: row.registered_at,
    lastSignInAt: row.last_sign_in_at,
    granted: row.granted,
    grantedAt: row.granted_at,
    note: row.note ?? '',
    tags: row.tags ?? [],
    apiUrl: row.api_base_url ?? '',
  }));
};

export const saveAppUserNote = async (email: string, note: string, tags: string[], settings: CloudSettings = loadCloudSettings()) => {
  const row = { email: normalizeCloudEmail(email), note: note.trim(), tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))], updated_at: new Date().toISOString() };
  const { error } = await getSupabaseClient(settings).from('app_user_notes').upsert(row);
  if (error) throw userListError(error.message);
};

// 推荐 API 地址（1.14.1，表 api_recommendations）：管理员按账号填，本人登录后提示把 API 配置的接口地址换成它。
const recommendationError = (message: string) =>
  /api_recommendations|schema cache|does not exist|Could not find/i.test(message)
    ? new Error('Supabase 里还没有推荐 API 地址的表，请先执行 supabase-schema.sql 里「推荐 API 地址」那段')
    : new Error(message);

// 空地址表示不再推荐，删掉这一行。
export const saveApiRecommendation = async (email: string, apiUrl: string, settings: CloudSettings = loadCloudSettings()) => {
  const client = getSupabaseClient(settings);
  const target = normalizeCloudEmail(email);
  const { error } = apiUrl
    ? await client.from('api_recommendations').upsert({ email: target, api_base_url: apiUrl, updated_at: new Date().toISOString() })
    : await client.from('api_recommendations').delete().eq('email', target);
  if (error) throw recommendationError(error.message);
};

export const loadOwnApiRecommendation = async (email: string, settings: CloudSettings = loadCloudSettings()) => {
  const { data, error } = await getSupabaseClient(settings).from('api_recommendations').select('api_base_url').eq('email', normalizeCloudEmail(email)).maybeSingle();
  if (error) throw recommendationError(error.message);
  return (data as { api_base_url: string } | null)?.api_base_url ?? '';
};

// AI 功能规则的管理员改动（1.17.0，表 ai_rule_overrides，一个功能一行）：登录的账号都能读，只有管理员能改。格式见 electron/materials/aiRules.ts。
const ruleOverrideError = (message: string) =>
  /ai_rule_overrides|schema cache|does not exist|Could not find/i.test(message)
    ? new Error('Supabase 里还没有 AI 规则表，请先执行 supabase-schema.sql 里「AI 功能规则」那段')
    : new Error(message);

export const loadAiRuleOverrides = async (settings: CloudSettings = loadCloudSettings()) => {
  const { data, error } = await getSupabaseClient(settings).from('ai_rule_overrides').select('action, rules');
  if (error) throw ruleOverrideError(error.message);
  return Object.fromEntries(((data ?? []) as Array<{ action: string; rules: MaterialAiRuleEntry[] }>).map((row) => [row.action, row.rules])) as MaterialAiRuleOverrides;
};

// 这个功能没有改动了（全部恢复默认）就删掉这一行。
export const saveAiRuleOverrides = async (action: string, rules: MaterialAiRuleEntry[], settings: CloudSettings = loadCloudSettings()) => {
  const client = getSupabaseClient(settings);
  const { error } = rules.length
    ? await client.from('ai_rule_overrides').upsert({ action, rules, updated_at: new Date().toISOString() })
    : await client.from('ai_rule_overrides').delete().eq('action', action);
  if (error) throw ruleOverrideError(error.message);
};
