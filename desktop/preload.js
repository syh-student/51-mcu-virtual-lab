/* 渲染进程只暴露桌面能力和只读信息，不开放 Node API。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('c51Desktop', {
  isDesktop: true,
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  minimize: () => ipcRenderer.send('c51-window', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('c51-window', 'maximize'),
  close: () => ipcRenderer.send('c51-window', 'close'),
  getWindowState: () => ipcRenderer.invoke('c51-window-state'),
  getAppInfo: () => ipcRenderer.invoke('c51-app-info'),
  openProjectFile: () => ipcRenderer.invoke('c51-open-project'),
  saveProjectFile: (payload) => ipcRenderer.invoke('c51-save-project', payload),
  onWindowState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('c51-window-state', listener);
    return () => ipcRenderer.removeListener('c51-window-state', listener);
  },
  onDownload: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('c51-download', listener);
    return () => ipcRenderer.removeListener('c51-download', listener);
  }
});
