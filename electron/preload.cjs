const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('promptAssistantDesktop', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('desktop:update-settings', settings),
  performClose: (payload) => ipcRenderer.invoke('desktop:perform-close', payload),
  showMain: () => ipcRenderer.invoke('desktop:show-main'),
  getUpdateStatus: () => ipcRenderer.invoke('desktop:update-get-status'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update-download'),
  installUpdate: () => ipcRenderer.invoke('desktop:update-install'),
  openUpdateFolder: () => ipcRenderer.invoke('desktop:update-open-folder'),
  onCloseRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('desktop-close-request', listener);
    return () => ipcRenderer.removeListener('desktop-close-request', listener);
  },
  documents: {
    pickAndAdd: () => ipcRenderer.invoke('documents:pick-and-add'),
    has: (sha) => ipcRenderer.invoke('documents:has', sha),
    readBytes: (sha) => ipcRenderer.invoke('documents:read-bytes', sha),
    writeBytes: (sha, bytes) => ipcRenderer.invoke('documents:write-bytes', sha, bytes),
    readText: (sha) => ipcRenderer.invoke('documents:read-text', sha),
    saveText: (text) => ipcRenderer.invoke('documents:save-text', text),
    open: (sha, name) => ipcRenderer.invoke('documents:open', sha, name),
    showInFolder: (sha, name) => ipcRenderer.invoke('documents:show-in-folder', sha, name),
    copyFile: (sha, name) => ipcRenderer.invoke('documents:copy-file', sha, name),
    sharePath: (sha, name) => ipcRenderer.invoke('documents:share-path', sha, name),
    saveAs: (sha, name) => ipcRenderer.invoke('documents:save-as', sha, name),
    startDrag: (sha, name) => ipcRenderer.send('documents:start-drag', sha, name),
  },
  skins: {
    list: () => ipcRenderer.invoke('skins:list'),
    pickAndInstall: () => ipcRenderer.invoke('skins:pick-install'),
    installPaths: (paths) => ipcRenderer.invoke('skins:install-paths', paths),
    remove: (id) => ipcRenderer.invoke('skins:remove', id),
    exportSkin: (id) => ipcRenderer.invoke('skins:export', id),
    market: () => ipcRenderer.invoke('skins:market'),
    marketInstall: (id) => ipcRenderer.invoke('skins:market-install', id),
    installGenerated: (manifest, files) => ipcRenderer.invoke('skins:install-generated', manifest, files),
    generateWallpaper: (prompt, composition) => ipcRenderer.invoke('skins:generate-wallpaper', prompt, composition),
    wallhavenSearch: (input) => ipcRenderer.invoke('skins:wallhaven-search', input),
    wallhavenImage: (id) => ipcRenderer.invoke('skins:wallhaven-image', id),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  materials: {
    getConfig: () => ipcRenderer.invoke('materials:get-config'),
    saveConfig: (config) => ipcRenderer.invoke('materials:save-config', config),
    setAccount: (email, adoptLegacy) => ipcRenderer.invoke('materials:set-account', email, adoptLegacy),
    revealConfig: () => ipcRenderer.invoke('materials:reveal-config'),
    applyGrant: (grant, own) => ipcRenderer.invoke('materials:apply-grant', grant, own),
    load: () => ipcRenderer.invoke('materials:load'),
    pickAndImport: (category) => ipcRenderer.invoke('materials:pick-and-import', category),
    importPaths: (paths, category) => ipcRenderer.invoke('materials:import-paths', paths, category),
    importClipboard: (category) => ipcRenderer.invoke('materials:import-clipboard', category),
    update: (id, patch) => ipcRenderer.invoke('materials:update', id, patch),
    remove: (ids) => ipcRenderer.invoke('materials:delete', ids),
    copyImage: (media) => ipcRenderer.invoke('materials:copy-image', media),
    pathForFile: (file) => webUtils.getPathForFile(file),
    ffmpegStatus: () => ipcRenderer.invoke('materials:ffmpeg-status'),
    installFfmpeg: () => ipcRenderer.invoke('materials:install-ffmpeg'),
    compressImages: (ids, options) => ipcRenderer.invoke('materials:compress-images', ids, options),
    compressVideos: (ids, options) => ipcRenderer.invoke('materials:compress-videos', ids, options),
    exportItems: (ids, defaultDir) => ipcRenderer.invoke('materials:export', ids, defaultDir),
    cancelBatch: () => ipcRenderer.invoke('materials:cancel-batch'),
    importWord: (category) => ipcRenderer.invoke('materials:import-word', category),
    importShare: () => ipcRenderer.invoke('materials:import-share'),
    exportShare: (ids, defaultDir) => ipcRenderer.invoke('materials:export-share', ids, defaultDir),
    getProxy: () => ipcRenderer.invoke('materials:get-proxy'),
    saveProxy: (settings) => ipcRenderer.invoke('materials:save-proxy', settings),
    aiGetSettings: () => ipcRenderer.invoke('materials:ai-get-settings'),
    aiSaveSettings: (settings) => ipcRenderer.invoke('materials:ai-save-settings', settings),
    aiListModels: (slot, input) => ipcRenderer.invoke('materials:ai-list-models', slot, input),
    aiSetImageModel: (model) => ipcRenderer.invoke('materials:ai-set-image-model', model),
    aiSetBaseUrl: (slots, url) => ipcRenderer.invoke('materials:ai-set-base-url', slots, url),
    aiSetRuleOverrides: (overrides) => ipcRenderer.invoke('materials:ai-set-rule-overrides', overrides),
    aiTest: (slot, input) => ipcRenderer.invoke('materials:ai-test', slot, input),
    aiReverse: (id) => ipcRenderer.invoke('materials:ai-reverse', id),
    aiOptimize: (prompt, kind) => ipcRenderer.invoke('materials:ai-optimize', prompt, kind),
    aiTranslate: (prompt, negativePrompt) => ipcRenderer.invoke('materials:ai-translate', prompt, negativePrompt),
    aiClassify: (id, prompt) => ipcRenderer.invoke('materials:ai-classify', id, prompt),
    aiBatchReverse: (ids) => ipcRenderer.invoke('materials:ai-batch-reverse', ids),
    aiBatchClassify: (ids) => ipcRenderer.invoke('materials:ai-batch-classify', ids),
    canvasSubmit: (input) => ipcRenderer.invoke('materials:canvas-submit', input),
    canvasQueue: () => ipcRenderer.invoke('materials:canvas-queue'),
    canvasCancel: (taskId) => ipcRenderer.invoke('materials:canvas-cancel', taskId),
    canvasRetry: (taskId, index) => ipcRenderer.invoke('materials:canvas-retry', taskId, index),
    canvasDismiss: (taskId) => ipcRenderer.invoke('materials:canvas-dismiss', taskId),
    canvasHistory: () => ipcRenderer.invoke('materials:canvas-history'),
    canvasHistoryDelete: (ids) => ipcRenderer.invoke('materials:canvas-history-delete', ids),
    canvasTemplates: () => ipcRenderer.invoke('materials:canvas-templates'),
    canvasTemplateSave: (input) => ipcRenderer.invoke('materials:canvas-template-save', input),
    canvasTemplateDelete: (id) => ipcRenderer.invoke('materials:canvas-template-delete', id),
    canvasTemplateUse: (id) => ipcRenderer.invoke('materials:canvas-template-use', id),
    canvasSave: (taskId, index) => ipcRenderer.invoke('materials:canvas-save', taskId, index),
    canvasSaveAs: (taskId, index) => ipcRenderer.invoke('materials:canvas-save-as', taskId, index),
    canvasCopyImage: (taskId, index) => ipcRenderer.invoke('materials:canvas-copy-image', taskId, index),
    onCanvasQueue: (callback) => {
      const listener = (_event, tasks) => callback(tasks);
      ipcRenderer.on('materials:canvas-queue', listener);
      return () => ipcRenderer.removeListener('materials:canvas-queue', listener);
    },
    canvasReference: (id) => ipcRenderer.invoke('materials:canvas-reference', id),
    canvasClipboardImage: () => ipcRenderer.invoke('materials:canvas-clipboard-image'),
    canvasHistoryImage: (sha256, ext) => ipcRenderer.invoke('materials:canvas-history-image', sha256, ext),
    nasStatus: () => ipcRenderer.invoke('materials:nas-status'),
    nasReconnect: () => ipcRenderer.invoke('materials:nas-reconnect'),
    onNasStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('materials:nas-status', listener);
      return () => ipcRenderer.removeListener('materials:nas-status', listener);
    },
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('materials:progress', listener);
      return () => ipcRenderer.removeListener('materials:progress', listener);
    },
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  },
});

contextBridge.exposeInMainWorld('promptAssistantFloating', {
  showMain: () => ipcRenderer.invoke('floating:show-main'),
  openMenu: () => ipcRenderer.invoke('floating:open-menu'),
  startDrag: (point) => ipcRenderer.invoke('floating:start-drag', point),
  drag: (point) => ipcRenderer.invoke('floating:drag', point),
  endDrag: () => ipcRenderer.invoke('floating:end-drag'),
});
