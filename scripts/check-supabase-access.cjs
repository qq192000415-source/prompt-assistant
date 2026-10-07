const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

const loadEnvFile = () => {
  const values = {};

  try {
    const raw = readFileSync(path.join(rootDir, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
      if (!match) continue;
      values[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // The caller can still provide values through process.env.
  }

  return values;
};

const fileEnv = loadEnvFile();
const supabaseUrl = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY;
const email = process.env.SUPABASE_TEST_EMAIL;
const password = process.env.SUPABASE_TEST_PASSWORD;
const shouldWrite = process.argv.includes('--write');

const fail = (message) => {
  console.error(`[supabase-check] ${message}`);
  process.exitCode = 1;
};

const main = async () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    fail('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
    return;
  }

  const anonymousClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: anonymousError } = await anonymousClient.from('prompt_libraries').select('user_id').limit(1);
  if (!anonymousError) {
    console.log('[supabase-check] Anonymous table probe succeeded. RLS should still return only allowed rows.');
  } else if (anonymousError.code === '42501' || anonymousError.message.toLowerCase().includes('permission')) {
    console.log('[supabase-check] Anonymous table probe is blocked by permissions/RLS. This is acceptable before login.');
  } else {
    console.log(`[supabase-check] Anonymous table probe returned: ${anonymousError.message}`);
  }

  if (!email || !password) {
    console.log('[supabase-check] Set SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD to verify authenticated access.');
    return;
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    fail(`Sign-in failed: ${signInError.message}`);
    return;
  }

  const userId = signInData.user?.id;
  if (!userId) {
    fail('Sign-in returned no user id.');
    return;
  }

  const { error: readError } = await client
    .from('prompt_libraries')
    .select('prompts,categories,subcategories,deleted_records,sync_records,export_settings,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (readError) {
    fail(`Authenticated read failed: ${readError.message}`);
    return;
  }

  console.log('[supabase-check] Authenticated read succeeded.');

  if (!shouldWrite) {
    console.log('[supabase-check] Skipping write check. Pass --write to verify upsert permissions with the test account.');
    return;
  }

  const { data: existingRow, error: existingRowError } = await client
    .from('prompt_libraries')
    .select('prompts,categories,subcategories,deleted_records,sync_records,export_settings,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingRowError) {
    fail(`Authenticated read before upsert failed: ${existingRowError.message}`);
    return;
  }

  const { error: writeError } = await client.from('prompt_libraries').upsert(
    existingRow
      ? { user_id: userId, ...existingRow }
      : {
          user_id: userId,
          prompts: [],
          categories: [],
          subcategories: {},
          deleted_records: [],
          sync_records: [],
          export_settings: {},
          updated_at: new Date().toISOString(),
        },
    { onConflict: 'user_id' },
  );

  if (writeError) {
    fail(`Authenticated upsert failed: ${writeError.message}`);
    return;
  }

  console.log(
    existingRow
      ? '[supabase-check] Authenticated upsert succeeded without changing stored snapshot content.'
      : '[supabase-check] Authenticated upsert succeeded by creating an empty snapshot for this test account.',
  );
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
