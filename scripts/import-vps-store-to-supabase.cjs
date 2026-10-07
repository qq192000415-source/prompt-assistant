const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const projectRoot = path.resolve(__dirname, '..');
const storePath = path.resolve(process.argv[2] || process.env.VPS_STORE_PATH || '');

const loadEnvFile = () => {
  const values = {};

  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
      if (!match) continue;
      values[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Environment variables are enough for CI or local secret managers.
  }

  return values;
};

const fileEnv = loadEnvFile();
const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  fileEnv.SUPABASE_URL ||
  fileEnv.VITE_SUPABASE_URL ||
  ''
).replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || '';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const assertJsonObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
};

const loadStore = () => {
  if (!storePath) {
    throw new Error('Usage: node scripts/import-vps-store-to-supabase.cjs <path-to-store.json>');
  }
  if (!fs.existsSync(storePath)) {
    throw new Error(`store.json not found: ${storePath}`);
  }

  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assertJsonObject(store, 'store.json');
  return {
    users: Array.isArray(store.users) ? store.users : [],
    snapshots: store.snapshots && typeof store.snapshots === 'object' ? store.snapshots : {},
  };
};

const listAllAuthUsers = async (client) => {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to list Supabase Auth users: ${error.message}`);

    users.push(...(data.users || []));
    const totalPages = data.lastPage || Math.ceil((data.total || users.length) / 1000);
    if (page >= totalPages || !data.users?.length) break;
    page += 1;
  }

  return users;
};

const findOrCreateUser = async (client, email, existingByEmail) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const existing = existingByEmail.get(normalizedEmail);
  if (existing) return existing;

  const temporaryPassword = `${randomUUID()}-${randomUUID()}`;
  const { data, error } = await client.auth.admin.createUser({
    email: normalizedEmail,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (error) throw new Error(`Unable to create Supabase Auth user ${normalizedEmail}: ${error.message}`);

  const user = data.user;
  existingByEmail.set(normalizedEmail, user);
  console.log(`[import-vps-store] Created Auth user: ${normalizedEmail}`);
  return user;
};

const snapshotToRow = (userId, snapshot) => {
  const value = snapshot && typeof snapshot === 'object' ? snapshot : {};

  return {
    user_id: userId,
    prompts: Array.isArray(value.prompts) ? value.prompts : [],
    categories: Array.isArray(value.categories) ? value.categories : [],
    subcategories: value.subcategories && typeof value.subcategories === 'object' && !Array.isArray(value.subcategories)
      ? value.subcategories
      : {},
    deleted_records: Array.isArray(value.deletedRecords) ? value.deletedRecords : [],
    sync_records: Array.isArray(value.syncRecords) ? value.syncRecords : [],
    export_settings: value.exportSettings && typeof value.exportSettings === 'object' && !Array.isArray(value.exportSettings)
      ? value.exportSettings
      : {},
    updated_at: value.updatedAt || new Date().toISOString(),
  };
};

const main = async () => {
  if (!supabaseUrl) {
    throw new Error('Set VITE_SUPABASE_URL or SUPABASE_URL before importing.');
  }
  if (!serviceRoleKey) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY before importing.');
  }

  const store = loadStore();
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existingUsers = await listAllAuthUsers(client);
  const existingByEmail = new Map(existingUsers.map((user) => [normalizeEmail(user.email), user]));

  let imported = 0;
  let skipped = 0;

  for (const legacyUser of store.users) {
    const email = normalizeEmail(legacyUser?.email);
    const snapshotRecord = store.snapshots?.[legacyUser?.id];
    const snapshot = snapshotRecord?.snapshot;

    if (!email || !snapshot) {
      skipped += 1;
      continue;
    }

    const supabaseUser = await findOrCreateUser(client, email, existingByEmail);
    if (!supabaseUser?.id) {
      skipped += 1;
      continue;
    }

    const { error } = await client
      .from('prompt_libraries')
      .upsert(snapshotToRow(supabaseUser.id, snapshot), { onConflict: 'user_id' });
    if (error) throw new Error(`Unable to import snapshot for ${email}: ${error.message}`);

    imported += 1;
    console.log(`[import-vps-store] Imported snapshot for ${email}`);
  }

  console.log(`[import-vps-store] Done. Imported: ${imported}. Skipped: ${skipped}.`);
  console.log('[import-vps-store] Old bcrypt password hashes were not imported. Use Supabase password reset for migrated accounts.');
};

main().catch((error) => {
  console.error(`[import-vps-store] ${error.message || error}`);
  process.exitCode = 1;
});
