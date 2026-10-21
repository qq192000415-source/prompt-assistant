// 安装版更新从哪下载（1.16.0）。更新清单 latest.yml 只从自己的服务器（UPDATE_BASE_URL）读，里面的版本号和 SHA512 是可信基准；
// 发版脚本在清单里写 downloadMirrors：GitHub Releases 上同一个安装包经国内镜像站的完整地址，按速度排好序。
// 软件按顺序试，出错或太慢就换下一个，最后用自己的服务器兜底；不管从哪下载，electron-updater 都按清单里的 SHA512 校验，
// 镜像站换了包也装不上。2026-10-21 在 NAS（国内电信宽带）实测：自己的服务器 72KB/s，ghfast.top 1.7MB/s。
// 除了 createMirrorProvider（要 electron-updater）都不依赖 Electron，Node 测试可直接加载。
const MAX_MIRRORS = 6;

// 清单里的镜像地址：只认 https，最多 6 个；末尾的 null 表示自己的服务器。
function downloadSources(updateInfo) {
  const mirrors = Array.isArray(updateInfo?.downloadMirrors) ? updateInfo.downloadMirrors : [];
  const valid = mirrors.filter((url) => {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  });
  return [...valid.slice(0, MAX_MIRRORS), null];
}

// 太慢就换下一个源：开始 20 秒还不到 2MB（约 100KB/s，比自己的服务器还慢），或者 15 秒没有任何进度。
const STALL = { warmupMs: 20_000, minBytes: 2 * 1024 * 1024, idleMs: 15_000 };
function isStalled({ elapsedMs, transferred, idleMs }, limits = STALL) {
  return idleMs >= limits.idleMs || (elapsedMs >= limits.warmupMs && transferred < limits.minBytes);
}

// 按顺序试下载来源，成功返回这次的来源；镜像出错或太慢就取消、换下一个，最后一个（自己的服务器）不限速，它也失败才抛错。
// onAttempt 告诉调用方正在试哪个（界面显示来源、非最后一个源的错误不报给用户），结束时给 null。
async function downloadWithFallback({ updater, sources, useSource, CancellationToken, log, onAttempt = () => {}, limits = STALL, checkMs = 2000 }) {
  let lastError = null;
  for (const [index, source] of sources.entries()) {
    const attempt = { host: source ? new URL(source).host : '更新服务器', last: index === sources.length - 1, startedAt: Date.now(), lastProgressAt: Date.now(), transferred: 0 };
    const token = new CancellationToken();
    const onProgress = (progress) => Object.assign(attempt, { lastProgressAt: Date.now(), transferred: Number(progress?.transferred) || 0 });
    const timer = attempt.last
      ? null
      : setInterval(() => {
          const now = Date.now();
          if (isStalled({ elapsedMs: now - attempt.startedAt, transferred: attempt.transferred, idleMs: now - attempt.lastProgressAt }, limits)) token.cancel();
        }, checkMs);
    updater.on('download-progress', onProgress);
    useSource(source);
    onAttempt(attempt);
    log('info', `下载更新：${source || attempt.host}`);
    try {
      await updater.downloadUpdate(token);
      return attempt;
    } catch (error) {
      lastError = error;
      log('warn', `${attempt.host} 下载失败：${token.cancelled ? '太慢，换下一个' : error?.message || error}`);
    } finally {
      if (timer) clearInterval(timer);
      updater.removeListener('download-progress', onProgress);
      onAttempt(null);
    }
  }
  throw lastError;
}

// electron-updater 的自定义来源：清单照常从 UPDATE_BASE_URL 读，只把安装包地址换成当前在试的镜像。
function createMirrorProvider() {
  const { GenericProvider } = require('electron-updater/out/providers/GenericProvider');
  let sourceUrl = null;
  class MirrorProvider extends GenericProvider {
    resolveFiles(updateInfo) {
      const files = super.resolveFiles(updateInfo);
      return sourceUrl ? files.map((file) => (file.url.pathname.toLowerCase().endsWith('.exe') ? { ...file, url: new URL(sourceUrl) } : file)) : files;
    }
  }
  return { MirrorProvider, useSource: (url) => (sourceUrl = url) };
}

module.exports = { downloadSources, isStalled, downloadWithFallback, createMirrorProvider };
