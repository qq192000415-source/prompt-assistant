const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, screen, shell, Notification } = require('electron');
const { execFile } = require('node:child_process');
const attachmentStore = require('./attachmentStore.cjs');
// 素材库由 electron/materials/*.ts 编译而来（npm run build:electron）。
const materials = require('./materials.cjs');
const { migrateLegacyUserData } = require('./userDataMigration.cjs');
const { parseLatestYml, isNewerVersion } = require('./portableUpdate.cjs');
const { updaterCacheDir, installedUpdateLeftovers } = require('./updateCache.cjs');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const { version: appVersion } = require('../package.json');

const APP_VERSION_LABEL = `灵匣${appVersion}`;

// 数据目录固定为不带版本号的 prompt-assistant，升级不再换目录；首次启动从最近的旧版本目录搬数据。
// PROMPT_ASSISTANT_USER_DATA 只给开发和测试用，避免测试数据写进真实目录。
const userDataDir = process.env.PROMPT_ASSISTANT_USER_DATA || path.join(app.getPath('appData'), 'prompt-assistant');
let userDataMigrationError = null;
try {
  migrateLegacyUserData(app.getPath('appData'), userDataDir);
} catch (error) {
  userDataMigrationError = error;
}
app.setPath('userData', userDataDir);
materials.registerScheme();
app.whenReady().then(() => {
  if (userDataMigrationError) {
    dialog.showErrorBox(
      '旧版本数据没有搬过来',
      `从旧版本目录复制本机数据失败：${userDataMigrationError.message}
旧数据仍在 %APPDATA% 下的“提示词助手X.Y.Z”目录里，没有被删除。`,
    );
  }
});
const APP_USER_MODEL_ID = 'com.promptassistant.desktop';

function readPackagedUpdateUrl() {
  const candidates = ['app-update-source.local.json', 'app-update-source.json'];
  for (const name of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
      if (parsed && typeof parsed.url === 'string' && parsed.url.trim()) {
        return parsed.url.trim().replace(/\/+$/, '');
      }
    } catch {
      // 没有本地更新地址时保持未配置。
    }
  }

  return '';
}

const UPDATE_BASE_URL = (process.env.UPDATE_BASE_URL || readPackagedUpdateUrl()).replace(/\/+$/, '');
const AUTO_UPDATE_CHECK_DELAY_MS = 15 * 1000;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDev = Boolean(devServerUrl);
const appIcon = path.join(__dirname, '..', 'assets', 'icon.ico');
const appIconPng = path.join(__dirname, '..', 'assets', 'icon.png');

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

const defaultDesktopSettings = {
  closeBehavior: 'ask',
  floatingIcon: {
    enabled: true,
    opacity: 0.9,
    x: null,
    y: null,
  },
};

let mainWindow = null;
let tray = null;
let floatingWindow = null;
let forceQuit = false;
let floatingDrag = null;
let updaterInitialized = false;
// materials.register 的返回值，问画布还有几个任务在生成。
let materialsService = null;
let automaticUpdateTimer = null;
let lastPromptedUpdateVersion = '';
const activeUpdateNotifications = new Set();
let updateStatus = {
  status: 'idle',
  currentVersion: appVersion,
  message: '尚未检查更新',
  updateUrl: UPDATE_BASE_URL,
};

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;
autoUpdater.disableWebInstaller = true;

// 更新过程写日志 <userData>/logs/update.log（超过 1MB 从头写），装不上时看这里。
function updateLog(level, message) {
  try {
    const file = path.join(app.getPath('userData'), 'logs', 'update.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.rmSync(file);
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch {
    // 日志写不进去不影响更新。
  }
}
autoUpdater.logger = {
  info: (message) => updateLog('info', message),
  warn: (message) => updateLog('warn', message),
  error: (message) => updateLog('error', message instanceof Error ? message.stack : message),
  debug: () => undefined,
};

// 安装包下载到哪（%LOCALAPPDATA%\<updaterCacheDirName>，安装包在 pending 里），界面上显示、能打开。
const UPDATE_CACHE_DIR = app.isPackaged ? updaterCacheDir(process.resourcesPath, process.env.LOCALAPPDATA) : '';

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function normalizeSettings(value = {}) {
  const closeBehavior = ['ask', 'quit', 'tray'].includes(value.closeBehavior)
    ? value.closeBehavior
    : defaultDesktopSettings.closeBehavior;
  const floatingIcon = value.floatingIcon && typeof value.floatingIcon === 'object' ? value.floatingIcon : {};
  const opacity = Number(floatingIcon.opacity);
  const normalizeCoordinate = (coordinate) =>
    typeof coordinate === 'number' && Number.isFinite(coordinate) ? coordinate : null;

  return {
    closeBehavior,
    floatingIcon: {
      enabled: typeof floatingIcon.enabled === 'boolean' ? floatingIcon.enabled : defaultDesktopSettings.floatingIcon.enabled,
      opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.25, opacity)) : defaultDesktopSettings.floatingIcon.opacity,
      x: normalizeCoordinate(floatingIcon.x),
      y: normalizeCoordinate(floatingIcon.y),
    },
  };
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')));
  } catch {
    return normalizeSettings(defaultDesktopSettings);
  }
}

function writeSettings(settings) {
  const currentSettings = readSettings();
  const incomingSettings = settings && typeof settings === 'object' ? settings : {};
  const incomingFloatingIcon =
    incomingSettings.floatingIcon && typeof incomingSettings.floatingIcon === 'object'
      ? incomingSettings.floatingIcon
      : {};
  const nextFloatingIcon = {
    ...currentSettings.floatingIcon,
    ...incomingFloatingIcon,
  };

  if (incomingFloatingIcon.x === null || typeof incomingFloatingIcon.x === 'undefined') {
    nextFloatingIcon.x = currentSettings.floatingIcon.x;
  }
  if (incomingFloatingIcon.y === null || typeof incomingFloatingIcon.y === 'undefined') {
    nextFloatingIcon.y = currentSettings.floatingIcon.y;
  }

  const nextSettings = normalizeSettings({
    ...currentSettings,
    ...incomingSettings,
    floatingIcon: nextFloatingIcon,
  });
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(nextSettings, null, 2), 'utf8');
  return nextSettings;
}

// 只放行软件自己的页面（当前已加载的那一页）。以前放行所有 file://，把文件拖进窗口时 Chromium 会直接打开这个文件，整个软件界面就没了。
function isAllowedNavigation(url, currentUrl) {
  if (isDev && devServerUrl && url.startsWith(devServerUrl)) {
    return true;
  }

  const withoutHash = (value) => value.split(/[?#]/)[0];
  return url.startsWith('file://') && withoutHash(url) === withoutHash(currentUrl);
}

// 只把网页链接交给系统浏览器，file:、自定义协议等一律忽略。
function openExternalWebUrl(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

function isUnpackedBuild() {
  try {
    return app.getPath('exe').toLowerCase().includes(`${path.sep}win-unpacked${path.sep}`);
  } catch {
    return false;
  }
}

function getUpdateUnsupportedMessage() {
  if (isDev || !app.isPackaged) {
    return '开发模式不支持自动更新，请使用安装版测试。';
  }

  if (process.platform !== 'win32') {
    return '当前系统不支持此更新方式。';
  }

  if (isPortableBuild() || isUnpackedBuild()) {
    return '自动更新仅支持安装版，便携版和文件夹版请手动替换。';
  }

  if (!UPDATE_BASE_URL) {
    return '未配置更新地址。打包前设置 UPDATE_BASE_URL 后重新打包安装版。';
  }

  return '';
}

function setUpdateStatus(nextStatus) {
  updateStatus = {
    ...updateStatus,
    ...nextStatus,
    currentVersion: appVersion,
    updateUrl: UPDATE_BASE_URL,
    downloadDir: UPDATE_CACHE_DIR ? path.join(UPDATE_CACHE_DIR, 'pending') : '',
    updatedAt: new Date().toISOString(),
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:update-status', updateStatus);
  }

  return updateStatus;
}

function ensureUpdaterReady() {
  const unsupportedMessage = getUpdateUnsupportedMessage();
  if (unsupportedMessage) {
    return setUpdateStatus({ status: 'unsupported', message: unsupportedMessage });
  }

  if (updaterInitialized) {
    return updateStatus;
  }

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: UPDATE_BASE_URL,
  });
  updaterInitialized = true;
  return updateStatus;
}

function normalizeUpdateError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '更新检查失败';
}

function escapeToastXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getUpdatePromptVersion(info = {}) {
  return info?.version || updateStatus.availableVersion || '';
}

function buildUpdateToastXml(version) {
  const title = '提示词小助手已有新版本';
  const body = version ? `发现新版本 ${version}，是否下载最新版本？` : '是否下载最新版本？';

  return [
    '<toast scenario="reminder" launch="prompt-assistant-update">',
    '<visual>',
    '<binding template="ToastGeneric">',
    `<text>${escapeToastXml(title)}</text>`,
    `<text>${escapeToastXml(body)}</text>`,
    '</binding>',
    '</visual>',
    '<actions>',
    '<action content="是，下载" arguments="download-update" activationType="foreground" />',
    '<action content="否，暂不下载" arguments="dismiss-update" activationType="foreground" />',
    '</actions>',
    '</toast>',
  ].join('');
}

async function downloadAvailableUpdate() {
  const status = ensureUpdaterReady();
  if (status.status === 'unsupported') {
    return status;
  }

  if (updateStatus.status === 'downloaded' || updateStatus.status === 'downloading') {
    return updateStatus;
  }

  if (updateStatus.status !== 'available') {
    return setUpdateStatus({ status: 'error', message: '请先检查并发现可用更新', progress: undefined });
  }

  try {
    setUpdateStatus({ status: 'downloading', message: '正在准备下载更新', progress: { percent: 0 } });
    await autoUpdater.downloadUpdate();
    return updateStatus;
  } catch (error) {
    return setUpdateStatus({ status: 'error', message: normalizeUpdateError(error), progress: undefined });
  }
}

// 下载完就装：点了「下载」就是要装。画布还有任务在生成时先问，免得中断。
// 静默安装，沿用上次的安装位置，装完自动重开；装在 Program Files 时安装程序会弹 Windows 权限确认。
async function installDownloadedUpdate() {
  const version = updateStatus.availableVersion || '';
  const busy = materialsService?.activeCanvasTasks?.() ?? 0;
  if (busy && mainWindow && !mainWindow.isDestroyed()) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '新版本已下载',
      message: `新版本 ${version} 已下载，现在安装吗？`,
      detail: `画布还有 ${busy} 个任务在生成，现在安装会关掉软件、中断它们（已经生成好的图都在生成记录里）。也可以等生成完，在「设置 > 关于与更新」里点「重启安装」。`,
      buttons: ['现在安装', '稍后'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) {
      updateLog('info', `画布有 ${busy} 个任务在生成，用户选了稍后安装 ${version}`);
      return setUpdateStatus({ status: 'downloaded', message: '新版本已下载，在「设置 > 关于与更新」里点「重启安装」' });
    }
  }
  updateLog('info', `开始安装 ${version}：${updateStatus.downloadedFile || ''}`);
  setUpdateStatus({
    status: 'installing',
    message: '正在启动安装程序：软件会关闭，装好后自动重新打开。装在 C:\\Program Files 时 Windows 会弹出权限确认，请点「是」。',
  });
  forceQuit = true;
  // 让界面先显示一下「正在启动安装程序」再退出。
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
  return updateStatus;
}

// 新版本启动后删掉已经装上的安装包（pending 里的和根目录那两份），删了什么写进日志。
// 刚装完自动打开时安装程序可能还没退出、占着安装包，删不掉的隔 1 分钟再试，最多 3 次。
function cleanupInstalledUpdate(attempt = 1) {
  let failed = false;
  for (const target of installedUpdateLeftovers(UPDATE_CACHE_DIR, appVersion)) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      updateLog('info', `已删除装好的更新留下的文件：${target}`);
    } catch (error) {
      failed = true;
      updateLog('warn', `删不掉 ${target}（第 ${attempt} 次）：${error instanceof Error ? error.message : error}`);
    }
  }
  if (failed && attempt < 3) setTimeout(() => cleanupInstalledUpdate(attempt + 1), 60_000).unref?.();
}

// 弹窗或通知里已经回答过的版本，切回窗口时不再弹。
let answeredPromptVersion = '';

function handleUpdatePromptChoice(choice, version) {
  answeredPromptVersion = version;
  if (choice === 'download') {
    void downloadAvailableUpdate();
    return;
  }

  setUpdateStatus({
    status: 'available',
    availableVersion: version || updateStatus.availableVersion,
    message: '已暂不下载更新，可在设置中手动下载',
    progress: undefined,
  });
}

function showUpdateTrayBalloonPrompt(version) {
  if (process.platform !== 'win32') return;

  const currentTray = createTray();
  const handleBalloonClick = () => handleUpdatePromptChoice('download', version);
  const handleBalloonClosed = () => {
    currentTray.removeListener('balloon-click', handleBalloonClick);
  };

  currentTray.once('balloon-click', handleBalloonClick);
  currentTray.once('balloon-closed', handleBalloonClosed);
  currentTray.displayBalloon({
    title: '提示词小助手已有新版本',
    content: version
      ? `发现新版本 ${version}，是否下载最新版本？点击此提示下载，关闭则暂不下载。`
      : '是否下载最新版本？点击此提示下载，关闭则暂不下载。',
    icon: appIcon,
    iconType: 'custom',
    largeIcon: true,
    respectQuietTime: true,
  });
}

function showUpdateAvailablePrompt(info) {
  const version = getUpdatePromptVersion(info);
  if (!version || lastPromptedUpdateVersion === version) {
    return;
  }

  lastPromptedUpdateVersion = version;

  const promptInWindow = () =>
    void dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: '提示词小助手已有新版本',
        message: `发现新版本 ${version}`,
        detail: `当前版本 ${appVersion}。点「下载」会在后台下载，下完自动关闭软件安装新版本，装好后自动重新打开；也可以以后在「设置 > 关于与更新」里手动下载。`,
        buttons: ['下载', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => handleUpdatePromptChoice(response === 0 ? 'download' : 'dismiss', version));

  // 主窗口在前台就在窗口上弹对话框（系统通知容易被专注模式藏起来）。
  const windowShown = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  if (windowShown && mainWindow.isFocused()) {
    promptInWindow();
    return;
  }
  // 窗口在别的窗口后面或最小化了：Windows 不让后台程序抢前台，这时弹的对话框会被挡住、根本看不到（1.10.0 实测）。
  // 改成任务栏图标闪烁 + 下面的系统通知，切回窗口时再弹对话框（通知里已经回答过就不弹）。
  if (windowShown) {
    mainWindow.flashFrame(true);
    mainWindow.once('focus', () => {
      mainWindow?.flashFrame(false);
      if (answeredPromptVersion !== version && updateStatus.status === 'available') promptInWindow();
    });
  }

  if (!Notification.isSupported()) {
    showUpdateTrayBalloonPrompt(version);
    return;
  }

  let handled = false;
  const promptTitle = '提示词小助手已有新版本';
  const promptBody = version ? `发现新版本 ${version}，是否下载最新版本？` : '是否下载最新版本？';
  const notification =
    process.platform === 'win32'
      ? new Notification({ toastXml: buildUpdateToastXml(version) })
      : new Notification({
          title: promptTitle,
          body: `${promptBody} 点击此通知下载，关闭则暂不下载。`,
          icon: appIconPng,
          timeoutType: 'never',
          urgency: 'normal',
        });

  const choose = (choice) => {
    if (handled) return;
    handled = true;
    handleUpdatePromptChoice(choice, version);
  };

  activeUpdateNotifications.add(notification);
  notification.once('action', (_event, actionIndex) => {
    choose(actionIndex === 0 ? 'download' : 'dismiss');
  });
  notification.once('click', () => choose('download'));
  notification.once('close', () => {
    activeUpdateNotifications.delete(notification);
  });
  notification.once('failed', () => {
    activeUpdateNotifications.delete(notification);
    if (!handled) {
      showUpdateTrayBalloonPrompt(version);
    }
  });
  try {
    notification.show();
  } catch {
    activeUpdateNotifications.delete(notification);
    showUpdateTrayBalloonPrompt(version);
  }
}

async function runUpdateCheck({ automatic = false } = {}) {
  const status = ensureUpdaterReady();
  if (status.status === 'unsupported') {
    return status;
  }

  if (updateStatus.status === 'checking' || updateStatus.status === 'downloading') {
    return updateStatus;
  }

  try {
    await autoUpdater.checkForUpdates();
    return updateStatus;
  } catch (error) {
    if (automatic) {
      return updateStatus;
    }
    return setUpdateStatus({ status: 'error', message: normalizeUpdateError(error), progress: undefined });
  }
}

// 便携版：启动后读一次 latest.yml，有新版本就弹窗，点「下载」用浏览器打开安装包地址。读不到不提示，手动检查不受影响。
async function checkPortableUpdate() {
  try {
    const response = await fetch(`${UPDATE_BASE_URL}/latest.yml`, { cache: 'no-store' });
    if (!response.ok) return;
    const latest = parseLatestYml(await response.text());
    if (!latest || !isNewerVersion(latest.version, appVersion) || !mainWindow || mainWindow.isDestroyed()) return;
    const { response: choice } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '提示词小助手已有新版本',
      message: `发现新版本 ${latest.version}`,
      detail: `当前版本 ${appVersion}。便携版不能自动更新，点「下载」用浏览器下载新版安装包；想继续用便携版，请向发布者要新的便携版文件。`,
      buttons: latest.path ? ['下载', '稍后'] : ['知道了'],
      defaultId: 0,
      cancelId: latest.path ? 1 : 0,
      noLink: true,
    });
    if (latest.path && choice === 0) void shell.openExternal(`${UPDATE_BASE_URL}/${encodeURIComponent(latest.path)}`);
  } catch (error) {
    console.warn('便携版检查更新失败', error);
  }
}

function startAutomaticUpdateChecks() {
  if (isPortableBuild() && UPDATE_BASE_URL && !isDev && app.isPackaged) {
    setTimeout(() => void checkPortableUpdate(), AUTO_UPDATE_CHECK_DELAY_MS);
    return;
  }
  if (automaticUpdateTimer || getUpdateUnsupportedMessage()) {
    return;
  }

  const check = () => {
    if (['checking', 'downloading', 'downloaded', 'installing'].includes(updateStatus.status)) {
      return;
    }
    void runUpdateCheck({ automatic: true });
  };

  setTimeout(check, AUTO_UPDATE_CHECK_DELAY_MS);
  automaticUpdateTimer = setInterval(check, AUTO_UPDATE_CHECK_INTERVAL_MS);
}

autoUpdater.on('checking-for-update', () => {
  setUpdateStatus({ status: 'checking', message: '正在检查更新', progress: undefined });
});

autoUpdater.on('update-available', (info) => {
  setUpdateStatus({
    status: 'available',
    availableVersion: info?.version,
    message: `发现新版本 ${info?.version || ''}`.trim(),
    progress: undefined,
  });
  showUpdateAvailablePrompt(info);
});

autoUpdater.on('update-not-available', () => {
  setUpdateStatus({ status: 'not-available', message: '当前已是最新版本', progress: undefined });
});

autoUpdater.on('download-progress', (progress) => {
  setUpdateStatus({
    status: 'downloading',
    message: `正在下载更新 ${Math.round(progress.percent || 0)}%`,
    progress: {
      percent: Number(progress.percent) || 0,
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0,
      bytesPerSecond: Number(progress.bytesPerSecond) || 0,
    },
  });
});

autoUpdater.on('update-downloaded', (info) => {
  setUpdateStatus({
    status: 'downloaded',
    availableVersion: info?.version || updateStatus.availableVersion,
    downloadedFile: info?.downloadedFile || '',
    message: '更新已下载，准备安装',
    progress: { ...(updateStatus.progress ?? {}), percent: 100 },
  });
  void installDownloadedUpdate();
});

autoUpdater.on('error', (error) => {
  // 安装程序没启动起来：软件不退出了，关窗口恢复成平时的行为。
  if (updateStatus.status === 'installing') forceQuit = false;
  setUpdateStatus({ status: 'error', message: normalizeUpdateError(error), progress: undefined });
});

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  if (!tray) {
    createTray();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function quitApp() {
  forceQuit = true;
  app.quit();
}

function createTray() {
  if (tray) return tray;

  tray = new Tray(appIcon);
  tray.setToolTip(APP_VERSION_LABEL);
  tray.on('click', showMainWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { label: '隐藏到托盘', click: hideToTray },
      { type: 'separator' },
      { label: '退出', click: quitApp },
    ]),
  );

  return tray;
}

function getFloatingBounds(settings) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const size = 64;
  const x = Number.isFinite(settings.floatingIcon.x)
    ? Math.round(settings.floatingIcon.x)
    : workArea.x + workArea.width - size - 28;
  const y = Number.isFinite(settings.floatingIcon.y)
    ? Math.round(settings.floatingIcon.y)
    : workArea.y + workArea.height - size - 88;

  return {
    x: Math.min(workArea.x + workArea.width - size, Math.max(workArea.x, x)),
    y: Math.min(workArea.y + workArea.height - size, Math.max(workArea.y, y)),
    width: size,
    height: size,
  };
}

function setFloatingOpacity(opacity) {
  const settings = writeSettings({
    floatingIcon: {
      ...readSettings().floatingIcon,
      opacity,
      enabled: true,
    },
  });
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.setOpacity(settings.floatingIcon.opacity);
  }
}

function showFloatingMenu() {
  const settings = readSettings();
  const menu = Menu.buildFromTemplate([
    { label: '显示主界面', click: showMainWindow },
    { type: 'separator' },
    {
      label: '透明度',
      submenu: [1, 0.9, 0.75, 0.6, 0.45, 0.3].map((opacity) => ({
        label: `${Math.round(opacity * 100)}%`,
        type: 'radio',
        checked: Math.abs(settings.floatingIcon.opacity - opacity) < 0.01,
        click: () => setFloatingOpacity(opacity),
      })),
    },
    { type: 'separator' },
    {
      label: '关闭悬浮图标',
      click: () => {
        writeSettings({ floatingIcon: { ...readSettings().floatingIcon, enabled: false } });
        if (floatingWindow && !floatingWindow.isDestroyed()) {
          floatingWindow.close();
        }
        floatingWindow = null;
      },
    },
  ]);

  menu.popup({ window: floatingWindow ?? mainWindow ?? undefined });
}

function createFloatingWindow() {
  const settings = readSettings();
  if (!settings.floatingIcon.enabled) return;
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.setOpacity(settings.floatingIcon.opacity);
    return;
  }

  floatingWindow = new BrowserWindow({
    ...getFloatingBounds(settings),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
  });

  floatingWindow.setOpacity(settings.floatingIcon.opacity);
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWindow.loadFile(path.join(__dirname, 'floating.html'));
  floatingWindow.once('ready-to-show', () => {
    floatingWindow?.showInactive();
  });
  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: APP_VERSION_LABEL,
    icon: appIcon,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (forceQuit) return;

    const settings = readSettings();
    if (settings.closeBehavior === 'quit') {
      forceQuit = true;
      return;
    }

    event.preventDefault();
    if (settings.closeBehavior === 'tray') {
      hideToTray();
      return;
    }

    mainWindow?.webContents.send('desktop-close-request');
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalWebUrl(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, mainWindow.webContents.getURL())) return;

    event.preventDefault();
    openExternalWebUrl(url);
  });

  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('desktop:get-settings', () => readSettings());

const documentsDir = () => path.join(app.getPath('userData'), 'attachments');

// 把文件放进 Windows 剪贴板，粘贴到微信、QQ、邮件或资源管理器就是这个文件。
// 路径走环境变量传给 PowerShell，不拼进命令字符串。
function copyFileToClipboard(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath $env:PA_CLIPBOARD_FILE'],
      { env: { ...process.env, PA_CLIPBOARD_FILE: filePath }, windowsHide: true },
      (error) => (error ? reject(new Error('复制文件到剪贴板失败')) : resolve()),
    );
  });
}

ipcMain.handle('documents:pick-and-add', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: '添加文档', properties: ['openFile', 'multiSelections'] });
  const added = [];
  const errors = [];
  for (const filePath of result.canceled ? [] : result.filePaths) {
    try {
      added.push(attachmentStore.addFile(documentsDir(), filePath));
    } catch (error) {
      errors.push({ name: path.basename(filePath), message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { added, errors };
});

ipcMain.handle('documents:has', (_event, sha) => attachmentStore.has(documentsDir(), sha));
ipcMain.handle('documents:read-bytes', (_event, sha) => new Uint8Array(attachmentStore.readBytes(documentsDir(), sha)));
ipcMain.handle('documents:write-bytes', (_event, sha, bytes) => attachmentStore.writeBytes(documentsDir(), sha, bytes));
ipcMain.handle('documents:read-text', (_event, sha) => attachmentStore.readText(documentsDir(), sha));
ipcMain.handle('documents:save-text', (_event, text) => attachmentStore.addText(documentsDir(), text));

ipcMain.handle('documents:open', async (_event, sha, name) => {
  const message = await shell.openPath(attachmentStore.materialize(documentsDir(), sha, name, { readOnly: true }));
  if (message) throw new Error(message);
});

ipcMain.handle('documents:show-in-folder', (_event, sha, name) => {
  shell.showItemInFolder(attachmentStore.materialize(documentsDir(), sha, name));
});

ipcMain.handle('documents:copy-file', (_event, sha, name) =>
  copyFileToClipboard(attachmentStore.materialize(documentsDir(), sha, name)),
);

// 给“指令 + 文件路径”用：终端里的 AI 可以按这个路径直接读文件。
ipcMain.handle('documents:share-path', (_event, sha, name) =>
  fs.realpathSync.native(attachmentStore.materialize(documentsDir(), sha, name)),
);

ipcMain.handle('documents:save-as', async (_event, sha, name) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: attachmentStore.safeFileName(name) });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, attachmentStore.readBytes(documentsDir(), sha));
  return true;
});

// 拖拽必须在 dragstart 里同步发起，所以用 send 而不是 invoke。
ipcMain.on('documents:start-drag', (event, sha, name) => {
  try {
    event.sender.startDrag({
      file: attachmentStore.materialize(documentsDir(), sha, name),
      icon: nativeImage.createFromPath(appIconPng).resize({ width: 32, height: 32 }),
    });
  } catch {
    // 文件不在本机时无法拖出；界面在文件就绪前不允许拖动。
  }
});

ipcMain.handle('desktop:update-settings', (_event, settings) => {
  const nextSettings = writeSettings(settings);
  if (nextSettings.floatingIcon.enabled) {
    createFloatingWindow();
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.setOpacity(nextSettings.floatingIcon.opacity);
      floatingWindow.setBounds(getFloatingBounds(nextSettings));
    }
  } else if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.close();
  }

  return nextSettings;
});

ipcMain.handle('desktop:perform-close', (_event, payload = {}) => {
  const action = payload.action === 'quit' ? 'quit' : 'tray';
  if (payload.remember) {
    writeSettings({ closeBehavior: action });
  }

  if (action === 'quit') {
    quitApp();
  } else {
    hideToTray();
  }
});

ipcMain.handle('desktop:show-main', () => showMainWindow());
ipcMain.handle('desktop:update-get-status', () => ensureUpdaterReady());
ipcMain.handle('desktop:update-check', () => runUpdateCheck());
ipcMain.handle('desktop:update-download', () => downloadAvailableUpdate());

ipcMain.handle('desktop:update-install', () => {
  const status = ensureUpdaterReady();
  if (status.status === 'unsupported') {
    return status;
  }

  if (updateStatus.status !== 'downloaded') {
    return setUpdateStatus({ status: 'error', message: '更新尚未下载完成', progress: undefined });
  }

  return installDownloadedUpdate();
});
ipcMain.handle('desktop:update-open-folder', async () => {
  const target = [updateStatus.downloadDir, UPDATE_CACHE_DIR].find((dir) => dir && fs.existsSync(dir));
  if (!target) return '还没有下载过安装包';
  const error = await shell.openPath(target);
  return error || '';
});
ipcMain.handle('floating:show-main', () => showMainWindow());
ipcMain.handle('floating:open-menu', () => showFloatingMenu());

ipcMain.handle('floating:start-drag', (_event, point) => {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  const bounds = floatingWindow.getBounds();
  floatingDrag = {
    originX: bounds.x,
    originY: bounds.y,
    startX: Number(point?.x) || 0,
    startY: Number(point?.y) || 0,
  };
});

ipcMain.handle('floating:drag', (_event, point) => {
  if (!floatingWindow || floatingWindow.isDestroyed() || !floatingDrag) return;
  const currentX = Number(point?.x) || 0;
  const currentY = Number(point?.y) || 0;
  floatingWindow.setBounds({
    x: Math.round(floatingDrag.originX + currentX - floatingDrag.startX),
    y: Math.round(floatingDrag.originY + currentY - floatingDrag.startY),
    width: 64,
    height: 64,
  });
});

ipcMain.handle('floating:end-drag', () => {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  const bounds = floatingWindow.getBounds();
  writeSettings({
    floatingIcon: {
      ...readSettings().floatingIcon,
      enabled: true,
      x: bounds.x,
      y: bounds.y,
    },
  });
  floatingDrag = null;
});

// 旧版本的快捷方式名带版本号，升级后可能留下指向已删除 exe 的快捷方式。
// Windows 会拿它给任务栏按钮找图标，找不到 exe 就显示白色空图标，所以启动时清掉这些失效的。
function removeDeadStartMenuShortcuts() {
  const folders = [
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  for (const folder of folders) {
    let names = [];
    try {
      names = fs.readdirSync(folder).filter((name) => /^(提示词助手|灵匣).*\.lnk$/i.test(name));
    } catch {
      continue;
    }
    for (const name of names) {
      const link = path.join(folder, name);
      try {
        if (!fs.existsSync(shell.readShortcutLink(link).target)) {
          fs.unlinkSync(link);
        }
      } catch (error) {
        console.warn(`清理失效快捷方式失败：${link}`, error);
      }
    }
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32' && app.isPackaged) {
    removeDeadStartMenuShortcuts();
  }
  materialsService = materials.register({ ipcMain, userDataDir: app.getPath('userData'), updateBaseUrl: UPDATE_BASE_URL, getWindow: () => mainWindow });
  if (!getUpdateUnsupportedMessage()) cleanupInstalledUpdate();
  createTray();
  createWindow();
  createFloatingWindow();
  startAutomaticUpdateChecks();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter((window) => window !== floatingWindow).length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (forceQuit || process.platform === 'darwin') {
    return;
  }
});
