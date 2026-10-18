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
  materials: {
    getConfig: () => ipcRenderer.invoke('materials:get-config'),
    saveConfig: (config) => ipcRenderer.invoke('materials:save-config', config),
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
