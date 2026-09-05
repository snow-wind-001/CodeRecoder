import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent
} from 'electron';
import { DesktopBackupController } from './backupController.js';
import {
  DESKTOP_IPC,
  type DesktopResult,
  type DirectoryKind
} from '../shared/contracts.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererEntry = path.resolve(currentDirectory, '../renderer/index.html');
const preloadEntry = path.resolve(currentDirectory, '../preload/index.cjs');
const desktopIcon = path.resolve(currentDirectory, '../../desktop/assets/coderecoder.png');
const packagedRendererUrl = pathToFileURL(rendererEntry).href;
const developmentUrl = resolveDevelopmentUrl(process.env.ELECTRON_RENDERER_URL);

function resolveDevelopmentUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('ELECTRON_RENDERER_URL must be a valid loopback URL');
  }

  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (
    parsed.protocol !== 'http:'
    || !loopbackHosts.has(parsed.hostname)
    || parsed.username.length > 0
    || parsed.password.length > 0
  ) {
    throw new Error('ELECTRON_RENDERER_URL must use HTTP on a loopback host');
  }
  return parsed.href;
}

function isTrustedRendererUrl(value: string): boolean {
  if (!developmentUrl) return value === packagedRendererUrl;
  try {
    return new URL(value).origin === new URL(developmentUrl).origin;
  } catch {
    return false;
  }
}

app.setName('CodeRecoder');
app.setAppUserModelId('com.coderecoder.desktop');
if (process.platform === 'linux') app.setDesktopName('coderecoder.desktop');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let controller: DesktopBackupController | undefined;
let quitIsReady = false;
let quitIsPending = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'CodeRecoder',
    width: 424,
    height: 880,
    minWidth: 380,
    minHeight: 640,
    maxWidth: 560,
    backgroundColor: '#f3f5f7',
    ...(process.platform === 'linux' ? { icon: desktopIcon } : {}),
    autoHideMenuBar: true,
    show: false,
    useContentSize: true,
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: developmentUrl !== undefined,
      spellcheck: false,
      webviewTag: false,
      navigateOnDragDrop: false
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => {
    event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  if (process.env.CODERECODER_DESKTOP_SMOKE === '1') {
    const smokeTimeout = setTimeout(() => {
      console.error('CodeRecoder Desktop smoke check timed out before renderer bootstrap');
      app.exit(1);
    }, 10_000);
    smokeTimeout.unref();
    window.webContents.on('page-title-updated', (_event, title) => {
      if (title !== 'CodeRecoder · Ready') return;
      clearTimeout(smokeTimeout);
      app.quit();
    });
  }

  return window;
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (developmentUrl) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(rendererEntry);
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== event.sender.mainFrame
    || !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error('Rejected IPC request from an untrusted renderer');
  }
}

function safeFailure(message: string, error: unknown): DesktopResult<never> {
  return {
    success: false,
    message,
    error: error instanceof Error ? error.message : String(error)
  };
}

function registerIpcHandlers(activeController: DesktopBackupController): void {
  const handle = <T extends unknown[]>(
    channel: string,
    handler: (...args: T) => Promise<DesktopResult<unknown>>
  ): void => {
    ipcMain.handle(channel, async (event, ...args: T) => {
      try {
        assertTrustedSender(event);
        return await handler(...args);
      } catch (error) {
        return safeFailure('桌面操作被拒绝', error);
      }
    });
  };

  handle(DESKTOP_IPC.bootstrap, async () => await activeController.bootstrap());
  handle(DESKTOP_IPC.refresh, async () => await activeController.refresh());
  handle(DESKTOP_IPC.activate, async (input: unknown) => await activeController.activate(input));
  handle(
    DESKTOP_IPC.deactivate,
    async (createFinalCheckpoint: unknown) => {
      if (typeof createFinalCheckpoint !== 'boolean') {
        return safeFailure('停用参数无效', 'createFinalCheckpoint must be a boolean');
      }
      return await activeController.deactivate(createFinalCheckpoint);
    }
  );
  handle(DESKTOP_IPC.createSnapshot, async (input: unknown) => {
    return await activeController.createSnapshot(input);
  });
  handle(DESKTOP_IPC.verifySnapshot, async (snapshotId: unknown) => {
    return await activeController.verifySnapshot(snapshotId);
  });
  handle(DESKTOP_IPC.previewRestore, async (input: unknown) => {
    return await activeController.previewRestore(input);
  });
  handle(DESKTOP_IPC.restoreSnapshot, async (input: unknown) => {
    return await activeController.restoreSnapshot(input);
  });
  handle(DESKTOP_IPC.chooseDirectory, async (kind: unknown) => {
    if (kind !== 'project' && kind !== 'storage') {
      return safeFailure('目录类型无效', 'Only project or storage directories may be selected');
    }
    if (!mainWindow) return safeFailure('无法打开目录选择器', 'Desktop window is unavailable');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: (kind as DirectoryKind) === 'project' ? '选择需要保护的工程' : '选择外部备份位置',
      buttonLabel: '选择此目录',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    });
    return {
      success: true,
      message: result.canceled ? '已取消选择' : '目录已选择',
      data: { path: result.canceled ? null : result.filePaths[0] ?? null }
    };
  });
}

async function startDesktop(): Promise<void> {
  const userDataRoot = app.getPath('userData');
  controller = new DesktopBackupController({
    appVersion: app.getVersion(),
    defaultStorageRoot: path.join(userDataRoot, 'backup-storage'),
    preferencePath: path.join(userDataRoot, 'desktop-preferences.json')
  });
  await controller.initialize();
  mainWindow = createWindow();
  registerIpcHandlers(controller);
  await loadRenderer(mainWindow);
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady()
    .then(startDesktop)
    .catch(error => {
      console.error('CodeRecoder Desktop failed to start:', error);
      app.exit(1);
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length !== 0) return;
    const window = createWindow();
    mainWindow = window;
    void loadRenderer(window).catch(error => {
      console.error('CodeRecoder Desktop failed to load its renderer:', error);
      if (!window.isDestroyed()) window.destroy();
    });
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', event => {
    if (quitIsReady) return;
    event.preventDefault();
    if (quitIsPending) return;
    quitIsPending = true;
    const shutdown = controller ? controller.shutdown() : Promise.resolve();
    void shutdown
      .catch(error => console.error('CodeRecoder Desktop shutdown failed:', error))
      .finally(() => {
        quitIsReady = true;
        app.quit();
      });
  });
}
