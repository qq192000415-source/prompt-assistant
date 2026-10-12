const fs = require('node:fs');
const path = require('node:path');

// 旧版本的 productName 带版本号，Electron 默认的 userData 目录是 “提示词助手X.Y.Z”，
// 每次升级都换一个目录，本机提示词和登录状态就“丢”了。现在固定到不带版本的目录，
// 第一次启动时从最近使用过的旧目录搬数据过来。旧目录原样保留，不删除。
const LEGACY_DIR_PATTERN = /^提示词助手\d+(\.\d+)*$/;
const MIGRATED_ENTRIES = ['Local Storage', 'Session Storage', 'IndexedDB', 'desktop-settings.json', 'attachments'];

const latestMtime = (target) => {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(target)
    .reduce((latest, entry) => Math.max(latest, latestMtime(path.join(target, entry))), stat.mtimeMs);
};

// ponytail: 按 Local Storage 最近修改时间选旧目录；如果用户最后打开的是一个刚升级、还没数据的版本，会选到它。
// 旧目录都还在，真遇到了可以手动拷回。
const findLatestLegacyDir = (appDataDir) => {
  const candidates = fs
    .readdirSync(appDataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && LEGACY_DIR_PATTERN.test(entry.name))
    .map((entry) => path.join(appDataDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'Local Storage')))
    .map((dir) => ({ dir, time: latestMtime(path.join(dir, 'Local Storage')) }))
    .sort((a, b) => b.time - a.time);

  return candidates[0]?.dir ?? null;
};

const migrateLegacyUserData = (appDataDir, targetDir) => {
  if (fs.existsSync(path.join(targetDir, 'Local Storage'))) return null;

  const legacyDir = findLatestLegacyDir(appDataDir);
  if (!legacyDir) return null;

  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of MIGRATED_ENTRIES) {
    const source = path.join(legacyDir, entry);
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(targetDir, entry), { recursive: true });
    }
  }
  return legacyDir;
};

module.exports = { findLatestLegacyDir, migrateLegacyUserData };
