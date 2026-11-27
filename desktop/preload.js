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
  /* 桌面版直接读盘：给渲染进程一个"按路径访问文件夹"的接口 */
  pickFolder: () => ipcRenderer.invoke('c51-pick-folder'),
  getLastDir: () => ipcRenderer.invoke('c51-last-dir'),
  setLastDir: (dir) => ipcRenderer.invoke('c51-set-last-dir', dir),
  clearLastDir: () => ipcRenderer.invoke('c51-clear-last-dir'),
  pathExists: (p) => ipcRenderer.invoke('c51-path-exists', p),
  listDir: (p) => ipcRenderer.invoke('c51-list-dir', p),
  readText: (p) => ipcRenderer.invoke('c51-read-text', p),
  writeText: (p, text) => ipcRenderer.invoke('c51-write-text', p, text),
  mkdir: (p) => ipcRenderer.invoke('c51-mkdir', p),
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
