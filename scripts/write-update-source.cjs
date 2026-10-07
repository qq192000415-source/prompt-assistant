const fs = require('node:fs');
const path = require('node:path');
const { loadEnvFile } = require('./load-env-file.cjs');

const projectRoot = path.resolve(__dirname, '..');
const fileEnv = loadEnvFile(path.join(projectRoot, '.env'));
const url = (process.env.UPDATE_BASE_URL || fileEnv.UPDATE_BASE_URL || '').trim().replace(/\/+$/, '');
const target = path.join(projectRoot, 'electron', 'app-update-source.local.json');

fs.writeFileSync(target, `${JSON.stringify({ url }, null, 2)}\n`);
console.log(url
  ? '[update-source] Wrote the local update URL into the packaged config.'
  : '[update-source] UPDATE_BASE_URL is empty. The installer will not check for updates.');
