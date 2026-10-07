const fs = require('node:fs');
const path = require('node:path');
const { version: appVersion } = require('../package.json');

const releaseDir = path.join(__dirname, '..', 'release');
const keepLatest = process.argv.includes('--keep');
const latestArtifacts = new Set([
  `提示词助手安装版${appVersion}.exe`,
  `提示词助手安装版${appVersion}.exe.blockmap`,
  `提示词助手便携版${appVersion}.exe`,
  'latest.yml',
]);
const latestDirectories = new Set(['win-unpacked']);

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

for (const entry of fs.readdirSync(releaseDir)) {
  if (keepLatest && latestArtifacts.has(entry)) continue;
  if (keepLatest && latestDirectories.has(entry)) continue;
  fs.rmSync(path.join(releaseDir, entry), { recursive: true, force: true });
}
