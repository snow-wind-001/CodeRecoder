import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent
} from 'electron';
import { McpIntegrationService } from './mcpIntegrationService.js';
import {
  ProjectSessionRegistry,
  type RegistryWindowScope
} from './projectSessionRegistry.js';
import {
  assertMainWindow,
  assertProjectAccess,
  resolveProjectForScope
} from './windowAuthorization.js';
import {
  DESKTOP_IPC,
  type DesktopResult,
  type DesktopStateEvent,
  type DirectoryKind,
  type McpClientTarget,
  type McpServiceTarget,
  type ProjectId
} from '../shared/contracts.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '../..');
const rendererEntry = path.resolve(currentDirectory, '../renderer/index.html');
const preloadEntry = path.resolve(currentDirectory, '../preload/index.cjs');
const desktopIcon = path.resolve(currentDirectory, '../../desktop/assets/coderecoder.png');
const packagedRendererUrl = pathToFileURL(rendererEntry);
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
  try {
    const parsed = new URL(value);
    if (developmentUrl) {
      const expected = new URL(developmentUrl);
      return parsed.origin === expected.origin && parsed.pathname === expected.pathname;
    }
    return parsed.protocol === 'file:' && parsed.pathname === packagedRendererUrl.pathname;
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
let registry: ProjectSessionRegistry | undefined;
let integrationService: McpIntegrationService | undefined;
let quitIsReady = false;
let quitIsPending = false;
const projectWindows = new Map<ProjectId, BrowserWindow>();
const windowScopes = new Map<number, RegistryWindowScope>();

function createWindow(scope: RegistryWindowScope): BrowserWindow {
  const isProjectWindow = scope.kind === 'project';
  const window = new BrowserWindow({
    title: isProjectWindow ? 'CodeRecoder · Project' : 'CodeRecoder',
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

  const webContentsId = window.webContents.id;
  windowScopes.set(webContentsId, scope);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    windowScopes.delete(webContentsId);
    if (mainWindow === window) mainWindow = null;
    if (scope.projectId && projectWindows.get(scope.projectId) === window) {
      projectWindows.delete(scope.projectId);
    }
  });

  if (process.env.CODERECODER_DESKTOP_SMOKE === '1' && scope.kind === 'main') {
    const smokeTimeout = setTimeout(() => {
      console.error('CodeRecoder Desktop smoke check timed out before renderer bootstrap');
      app.exit(1);
    }, 12_000);
    smokeTimeout.unref();
    window.webContents.on('page-title-updated', (_event, title) => {
      if (title !== 'CodeRecoder · Ready') return;
      clearTimeout(smokeTimeout);
      app.quit();
    });
  }
  return window;
}

async function loadRenderer(window: BrowserWindow, scope: RegistryWindowScope): Promise<void> {
  const query = {
    view: scope.kind,
    ...(scope.projectId ? { projectId: scope.projectId } : {})
  };
  if (developmentUrl) {
    const url = new URL(developmentUrl);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    await window.loadURL(url.href);
  } else {
    await window.loadFile(rendererEntry, { query });
  }
}

async function ensureMainWindow(): Promise<BrowserWindow> {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const window = createWindow({ kind: 'main', projectId: null });
  mainWindow = window;
  await loadRenderer(window, { kind: 'main', projectId: null });
  return window;
}

async function openProjectWindow(projectId: ProjectId): Promise<DesktopResult> {
  if (!registry?.hasProject(projectId)) {
    return safeFailure('无法打开工程窗口', '工程不存在或已被移除');
  }
  const existing = projectWindows.get(projectId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { success: true, message: '已聚焦现有工程窗口' };
  }
  const scope: RegistryWindowScope = { kind: 'project', projectId };
  const window = createWindow(scope);
  projectWindows.set(projectId, window);
  try {
    await loadRenderer(window, scope);
  } catch (error) {
    projectWindows.delete(projectId);
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
  return { success: true, message: '工程窗口已打开' };
}

function trustedScope(event: IpcMainInvokeEvent): RegistryWindowScope {
  const scope = windowScopes.get(event.sender.id);
  if (
    !scope
    || event.senderFrame !== event.sender.mainFrame
    || !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error('Rejected IPC request from an untrusted renderer');
  }
  return scope;
}

function safeFailure(message: string, error: unknown): DesktopResult<never> {
  return {
    success: false,
    message,
    error: error instanceof Error ? error.message : String(error)
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function requireIntegrationTarget(value: unknown): McpClientTarget {
  if (value === 'vscode' || value === 'cursor' || value === 'claude-code' || value === 'codex') return value;
  throw new Error('MCP client target is invalid');
}

function requireServiceTarget(value: unknown): McpServiceTarget {
  if (value === 'coderecorder' || value === 'serena') return value;
  throw new Error('MCP service target is invalid');
}

function resolveProjectId(scope: RegistryWindowScope, value: unknown): ProjectId | undefined {
  return resolveProjectForScope(scope, value, registry?.getSelectedProjectId() ?? null);
}

function integrationProject(projectId: ProjectId | undefined) {
  if (!projectId || !registry || !integrationService) return null;
  const project = registry.getProject(projectId);
  const summary = project.getSummary();
  return integrationService.projectContext(project.id, project.root, summary.serena);
}

function broadcastState(event: DesktopStateEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    const scope = windowScopes.get(window.webContents.id);
    if (!scope) continue;
    if (scope.kind === 'project' && event.projectId && scope.projectId !== event.projectId) continue;
    window.webContents.send(DESKTOP_IPC.stateChanged, event);
  }
}

function registerIpcHandlers(activeRegistry: ProjectSessionRegistry, integrations: McpIntegrationService): void {
  const handle = <T extends unknown[]>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: T) => Promise<DesktopResult<unknown>>
  ): void => {
    ipcMain.handle(channel, async (event, ...args: T) => {
      try {
        trustedScope(event);
        return await handler(event, ...args);
      } catch (error) {
        return safeFailure('桌面操作被拒绝', error);
      }
    });
  };

  handle(DESKTOP_IPC.bootstrap, async event => {
    return await activeRegistry.dashboard(trustedScope(event), undefined, true);
  });
  handle(DESKTOP_IPC.refresh, async (event, requestedProjectId: unknown) => {
    const scope = trustedScope(event);
    const projectId = resolveProjectId(scope, requestedProjectId);
    return await activeRegistry.dashboard(scope, projectId, true);
  });
  handle(DESKTOP_IPC.registerProject, async (event, input: unknown) => {
    assertMainWindow(trustedScope(event));
    return await activeRegistry.registerProject(input);
  });
  handle(DESKTOP_IPC.selectProject, async (event, projectId: unknown) => {
    assertMainWindow(trustedScope(event));
    return await activeRegistry.selectProject(projectId);
  });
  handle(DESKTOP_IPC.startProject, async (event, projectId: unknown) => {
    const scope = trustedScope(event);
    return await activeRegistry.startProject(assertProjectAccess(scope, projectId));
  });
  handle(DESKTOP_IPC.stopProject, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    const input = requireObject(rawInput, 'stop input');
    if (typeof input.createFinalCheckpoint !== 'boolean') throw new Error('createFinalCheckpoint is invalid');
    return await activeRegistry.stopProject(
      assertProjectAccess(scope, input.projectId),
      input.createFinalCheckpoint
    );
  });
  handle(DESKTOP_IPC.removeProject, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    assertMainWindow(scope);
    const input = requireObject(rawInput, 'remove input');
    if (typeof input.createFinalCheckpoint !== 'boolean') throw new Error('createFinalCheckpoint is invalid');
    const projectId = assertProjectAccess(scope, input.projectId);
    const response = await activeRegistry.removeProject(projectId, input.createFinalCheckpoint);
    if (response.success) projectWindows.get(projectId)?.close();
    return response;
  });
  handle(DESKTOP_IPC.openProjectWindow, async (event, projectId: unknown) => {
    const scope = trustedScope(event);
    assertMainWindow(scope);
    return await openProjectWindow(assertProjectAccess(scope, projectId));
  });
  handle(DESKTOP_IPC.createSnapshot, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    const input = requireObject(rawInput, 'snapshot input');
    const projectId = assertProjectAccess(scope, input.projectId);
    return await activeRegistry.createSnapshot(projectId, { name: input.name });
  });
  handle(DESKTOP_IPC.verifySnapshot, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    const input = requireObject(rawInput, 'verification input');
    return await activeRegistry.verifySnapshot(
      assertProjectAccess(scope, input.projectId),
      input.snapshotId
    );
  });
  handle(DESKTOP_IPC.previewRestore, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    const input = requireObject(rawInput, 'restore preview input');
    return await activeRegistry.previewRestore(assertProjectAccess(scope, input.projectId), {
      snapshotId: input.snapshotId,
      mode: input.mode
    });
  });
  handle(DESKTOP_IPC.restoreSnapshot, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    const input = requireObject(rawInput, 'restore input');
    return await activeRegistry.restoreSnapshot(assertProjectAccess(scope, input.projectId), {
      snapshotId: input.snapshotId,
      confirmationToken: input.confirmationToken
    });
  });
  handle(DESKTOP_IPC.restartSerena, async (event, projectId: unknown) => {
    return await activeRegistry.restartSerena(assertProjectAccess(trustedScope(event), projectId));
  });
  handle(DESKTOP_IPC.chooseDirectory, async (event, kind: unknown) => {
    assertMainWindow(trustedScope(event));
    if (kind !== 'project' && kind !== 'storage') throw new Error('directory kind is invalid');
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent) return safeFailure('无法打开目录选择器', 'Desktop window is unavailable');
    const result = await dialog.showOpenDialog(parent, {
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
  handle(DESKTOP_IPC.inspectMcpEnvironment, async (event, requestedProjectId: unknown) => {
    const scope = trustedScope(event);
    const projectId = resolveProjectId(scope, requestedProjectId);
    return {
      success: true,
      message: 'MCP 环境检查完成',
      data: await integrations.inspect(integrationProject(projectId))
    };
  });
  handle(DESKTOP_IPC.getMcpRecommendation, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    const input = requireObject(rawInput, 'recommendation input');
    const projectId = resolveProjectId(scope, input.projectId);
    const recommendation = await integrations.recommendation(
      requireIntegrationTarget(input.target),
      requireServiceTarget(input.service),
      integrationProject(projectId)
    );
    return { success: true, message: 'MCP 配置建议已生成', data: recommendation };
  });
  handle(DESKTOP_IPC.copyMcpRecommendation, async (event, rawInput: unknown) => {
    const scope = trustedScope(event);
    const input = requireObject(rawInput, 'copy recommendation input');
    const projectId = resolveProjectId(scope, input.projectId);
    const recommendation = await integrations.recommendation(
      requireIntegrationTarget(input.target),
      requireServiceTarget(input.service),
      integrationProject(projectId)
    );
    clipboard.writeText(recommendation.content);
    return { success: true, message: '配置建议已复制到剪贴板' };
  });
}

async function startDesktop(): Promise<void> {
  const userDataRoot = app.getPath('userData');
  integrationService = new McpIntegrationService(repositoryRoot);
  registry = new ProjectSessionRegistry({
    appVersion: app.getVersion(),
    defaultStorageRoot: path.join(userDataRoot, 'backup-storage'),
    preferencePath: path.join(userDataRoot, 'desktop-preferences.json'),
    onStateChange: broadcastState
  });
  await registry.initialize();
  registerIpcHandlers(registry, integrationService);
  await ensureMainWindow();
  void registry.startConfiguredProjects().catch(error => {
    console.error('Failed to restore configured project sessions:', error);
  });
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    void ensureMainWindow().then(window => {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }).catch(error => console.error('Failed to focus CodeRecoder window:', error));
  });

  app.whenReady().then(startDesktop).catch(error => {
    console.error('CodeRecoder Desktop failed to start:', error);
    app.exit(1);
  });

  app.on('activate', () => {
    void ensureMainWindow().catch(error => console.error('Failed to reopen CodeRecoder window:', error));
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', event => {
    if (quitIsReady) return;
    event.preventDefault();
    if (quitIsPending) return;
    quitIsPending = true;
    const shutdown = registry ? registry.shutdown() : Promise.resolve();
    void shutdown
      .catch(error => console.error('CodeRecoder Desktop shutdown failed:', error))
      .finally(() => {
        quitIsReady = true;
        app.quit();
      });
  });
}
