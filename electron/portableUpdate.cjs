// 便携版不能用 electron-updater 自动更新，启动时自己读更新源的 latest.yml，有新版本就弹窗提醒去下载。
// 不依赖 Electron，Node 测试可直接加载。

// latest.yml 里的 version 和安装包路径（path）；读不出来返回 null。
function parseLatestYml(text) {
  const field = (name) => String(text).match(new RegExp(`^${name}:\\s*['"]?([^'"\\r\\n]+)`, 'm'))?.[1]?.trim() ?? '';
  const version = field('version');
  return version ? { version, path: field('path') } : null;
}

// 只比较 X.Y.Z 的数字部分；candidate 比 current 新返回 true。
function isNewerVersion(candidate, current) {
  const parts = (value) => String(value).split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

module.exports = { parseLatestYml, isNewerVersion };
