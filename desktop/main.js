/* 51 单片机虚拟实验台 · Electron 桌面壳
 * 只负责窗口、权限和外部链接；页面本身仍然是仓库根目录的 index.html。
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, shell, session, screen, ipcMain, dialog } = require('electron');

const APP_DIR = app.getAppPath();
const APP_ROOT_URL = pathToFileURL(path.resolve(APP_DIR) + path.sep).href;
let mainWindow = null;

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch (err) {
    return null;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    const data = {
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      maximized: !!mainWindow.isMaximized()
    };
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(data), 'utf8');
  } catch (err) { /* 窗口状态写不进去不影响使用 */ }
}

function boundsVisible(bounds) {
  try {
    return screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return bounds.x < area.x + area.width - 80
        && bounds.x + bounds.width > area.x + 80
        && bounds.y < area.y + area.height - 40
        && bounds.y + bounds.height > area.y + 40;
    });
  } catch (err) { return false; }
}

function notifyWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send('c51-window-state', { maximized: mainWindow.isMaximized() });
  } catch (err) { /* 页面还没准备好时忽略 */ }
}

function windowForEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && win === mainWindow ? win : null;
}

function registerWindowIpc() {
  ipcMain.on('c51-window', (event, action) => {
    const win = windowForEvent(event);
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
  });
  ipcMain.handle('c51-window-state', (event) => {
    const win = windowForEvent(event);
    return { maximized: !!(win && win.isMaximized()) };
  });
  ipcMain.handle('c51-app-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron
  }));
  ipcMain.handle('c51-open-project', async (event) => {
    const win = windowForEvent(event);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: '打开 51 工程',
      properties: ['openFile'],
      filters: [
        { name: '51 实验台工程', extensions: ['json'] },
        { name: 'Keil 工程', extensions: ['uvproj', 'uvprojx'] }
      ]
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { name: path.basename(filePath), path: filePath, text };
  });
  ipcMain.handle('c51-save-project', async (event, payload) => {
    const win = windowForEvent(event);
    if (!win) return { canceled: true };
    const text = String((payload && payload.text) || '');
    if (!text || text.length > 32 * 1024 * 1024) {
      return { error: '工程文件过大或内容为空' };
    }
    const safeName = String((payload && payload.name) || 'project')
      .replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'project';
    const result = await dialog.showSaveDialog(win, {
      title: '保存 51 工程',
      defaultPath: path.join(app.getPath('documents'), safeName + '.c51proj.json'),
      filters: [{ name: '51 实验台工程', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { filePath: result.filePath };
  });
}

function initialBounds() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const defaults = {
    width: Math.max(960, Math.min(1440, area.width - 48)),
    height: Math.max(600, Math.min(900, area.height - 72))
  };
  const saved = readWindowState();
  if (!saved) return defaults;
  const next = {
    width: Number.isFinite(saved.width) ? Math.max(960, Math.min(4000, saved.width)) : defaults.width,
    height: Number.isFinite(saved.height) ? Math.max(600, Math.min(3000, saved.height)) : defaults.height
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && boundsVisible({ x: saved.x, y: saved.y, width: next.width, height: next.height })) {
    next.x = saved.x;
    next.y = saved.y;
  }
  next.maximized = !!saved.maximized;
  return next;
}

/* 仅开发模式接受 C51_DEBUG_PORT；打包后的正式版不会打开调试端口。 */
if (!app.isPackaged && process.env.C51_DEBUG_PORT) {
  const debugPort = Number(process.env.C51_DEBUG_PORT);
  if (debugPort > 0 && debugPort < 65536) {
    app.commandLine.appendSwitch('remote-debugging-port', String(debugPort));
    app.commandLine.appendSwitch('remote-allow-origins', 'http://127.0.0.1:' + debugPort);
  }
}

function isAppUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('file://')) return false;
  try {
    return new URL(url).href.startsWith(APP_ROOT_URL);
  } catch (err) {
    return false;
  }
}

/* 导出的时序图/CSV 和网页版保持一致：直接落到「下载」文件夹，不弹另存为。
   重名时自动加序号，避免覆盖用户上一次导出的文件。 */
function uniqueSavePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext) || 'export';
  let candidate = path.join(dir, base + ext);
  let index = 2;
  while (fs.existsSync(candidate) && index < 100) {
    candidate = path.join(dir, base + ' (' + index + ')' + ext);
    index += 1;
  }
  return candidate;
}

function registerDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    let name = '导出文件';
    try {
      name = String(item.getFilename() || name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || name;
      const dir = app.getPath('downloads');
      fs.mkdirSync(dir, { recursive: true });
      item.setSavePath(uniqueSavePath(dir, name));
    } catch (err) {
      /* 设置失败就退回 Electron 默认行为，不影响导出 */
    }
    item.once('done', (_event, state) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        mainWindow.webContents.send('c51-download', {
          ok: state === 'completed',
          name,
          path: item.getSavePath()
        });
      } catch (err) { /* 页面正在关闭时忽略 */ }
    });
  });
}

function createWindow() {
  const bounds = initialBounds();
  const winOptions = {
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0b0e',
    title: '51 单片机 · 虚拟实验台',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  };
  if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    winOptions.x = bounds.x;
    winOptions.y = bounds.y;
  }
  if (process.platform === 'win32') {
    winOptions.frame = false;
  }
  mainWindow = new BrowserWindow(winOptions);

  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-finish-load', notifyWindowState);
  mainWindow.on('maximize', notifyWindowState);
  mainWindow.on('unmaximize', notifyWindowState);
  mainWindow.on('restore', notifyWindowState);
  if (bounds.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(APP_DIR, 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  mainWindow.on('close', saveWindowState);
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.syh.c51lab');
    /* 本地文件选择器需要 fileSystem 权限；页面本身是本地文件，不加载远程内容。 */
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'fileSystem' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write');
    });
    /* 桌面版记住上次的文件夹后，重启要能直接续上，不再让用户点一次「重新连接」 */
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      return permission === 'fileSystem';
    });
    registerWindowIpc();
    registerDownloads();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

Menu.setApplicationMenu(null);
