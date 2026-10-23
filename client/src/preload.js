const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('native', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onWinState: on('win:state'),

  syncCache: (args) => ipcRenderer.invoke('cache:sync', args),
  readSound: (sound) => ipcRenderer.invoke('cache:read', sound),
  onCacheProgress: on('cache:progress'),

  pickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('fs:pickFiles'),
  describePaths: (paths) => ipcRenderer.invoke('fs:describe', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  uploadFiles: (args) => ipcRenderer.invoke('upload:files', args),
  onUploadProgress: on('upload:progress'),

  setHotkeys: (map) => ipcRenderer.invoke('hotkeys:set', map),
  onHotkey: on('hotkey'),
});
