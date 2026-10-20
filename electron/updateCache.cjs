// 安装版更新包的下载目录和清理。electron-updater 把安装包下到 %LOCALAPPDATA%\<updaterCacheDirName>\pending\，
// 根目录还留一份 installer.exe 和 current.blockmap（下次增量下载用）。装好新版本后这些都用不上了，启动时删掉。
// 不依赖 Electron，Node 测试可直接加载。
const fs = require('node:fs');
const path = require('node:path');
const { isNewerVersion } = require('./portableUpdate.cjs');

// 下载目录：打包时写进 resources/app-update.yml 的 updaterCacheDirName（electron-updater 也按它找）。
function updaterCacheDir(resourcesPath, localAppData) {
  try {
    const name = fs.readFileSync(path.join(resourcesPath, 'app-update.yml'), 'utf8').match(/^updaterCacheDirName:\s*['"]?([^'"\r\n]+)/m)?.[1]?.trim();
    return name && localAppData ? path.join(localAppData, name) : '';
  } catch {
    return '';
  }
}

// 已经装上的更新留下的文件：pending 里的安装包版本不比当前新（装好了，或者是更旧的），就连根目录那两份一起删。
// 下好了还没装的（比当前新）不动，留给「重启安装」。pending 里没有能读的 update-info.json 时 electron-updater 也不会用它
// （会重新下载），一起删：新版本刚启动时安装包可能还被安装程序占着，上次只删掉了 update-info.json。
function installedUpdateLeftovers(cacheDir, currentVersion) {
  if (!cacheDir || !fs.existsSync(cacheDir)) return [];
  const pendingDir = path.join(cacheDir, 'pending');
  let pendingVersion = '';
  try {
    const info = JSON.parse(fs.readFileSync(path.join(pendingDir, 'update-info.json'), 'utf8'));
    pendingVersion = String(info.fileName ?? '').match(/(\d+\.\d+\.\d+)/)?.[1] ?? '';
  } catch {
    // 没有 pending 或读不懂：下面一起删。
  }
  if (pendingVersion && isNewerVersion(pendingVersion, currentVersion)) return [];
  return [pendingDir, path.join(cacheDir, 'installer.exe'), path.join(cacheDir, 'current.blockmap')].filter((target) => fs.existsSync(target));
}

module.exports = { updaterCacheDir, installedUpdateLeftovers };
