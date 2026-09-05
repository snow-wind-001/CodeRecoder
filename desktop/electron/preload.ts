import { contextBridge, ipcRenderer } from 'electron';
import {
  DESKTOP_IPC,
  type CodeRecoderDesktopApi,
  type DesktopStateEvent,
  type DirectoryKind,
  type McpClientTarget,
  type McpServiceTarget,
  type ProjectRegistrationInput,
  type RestoreMode
} from '../shared/contracts.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_REASONS = new Set<DesktopStateEvent['reason']>([
  'project-registered',
  'project-started',
  'project-stopped',
  'project-removed',
  'checkpoint',
  'serena',
  'restore',
  'selection'
]);

function requireString(value: unknown, label: string, maxLength = 4096): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

function requireUuid(value: unknown, label: string): string {
  const parsed = requireString(value, label, 64);
  if (!UUID_PATTERN.test(parsed)) throw new TypeError(`${label} is invalid`);
  return parsed;
}

function requireMode(value: unknown): RestoreMode {
  if (value !== 'exact' && value !== 'overlay') throw new TypeError('restore mode is invalid');
  return value;
}

function requireTarget(value: unknown): McpClientTarget {
  if (value === 'vscode' || value === 'cursor' || value === 'claude-code' || value === 'codex') return value;
  throw new TypeError('MCP client target is invalid');
}

function requireService(value: unknown): McpServiceTarget {
  if (value === 'coderecorder' || value === 'serena') return value;
  throw new TypeError('MCP service target is invalid');
}

function sanitizeRegistration(input: ProjectRegistrationInput): ProjectRegistrationInput {
  if (!input || typeof input !== 'object') throw new TypeError('project registration is invalid');
  if (typeof input.autoCheckpoint !== 'boolean') throw new TypeError('autoCheckpoint is invalid');
  if (typeof input.startOnLaunch !== 'boolean') throw new TypeError('startOnLaunch is invalid');
  if (typeof input.serenaEnabled !== 'boolean') throw new TypeError('serenaEnabled is invalid');
  if (typeof input.serenaAutoConfigure !== 'boolean') throw new TypeError('serenaAutoConfigure is invalid');
  if (!Number.isInteger(input.maxBackups) || input.maxBackups < 2 || input.maxBackups > 10_000) {
    throw new TypeError('maxBackups is invalid');
  }
  return {
    projectPath: requireString(input.projectPath, 'projectPath'),
    storageRoot: input.storageRoot === undefined ? undefined : requireString(input.storageRoot, 'storageRoot'),
    autoCheckpoint: input.autoCheckpoint,
    maxBackups: input.maxBackups,
    startOnLaunch: input.startOnLaunch,
    serenaEnabled: input.serenaEnabled,
    serenaAutoConfigure: input.serenaAutoConfigure
  };
}

function sanitizeRecommendationInput(input: {
  target: McpClientTarget;
  service: McpServiceTarget;
  projectId?: string;
}): { target: McpClientTarget; service: McpServiceTarget; projectId?: string } {
  if (!input || typeof input !== 'object') throw new TypeError('recommendation input is invalid');
  return {
    target: requireTarget(input.target),
    service: requireService(input.service),
    projectId: input.projectId === undefined ? undefined : requireUuid(input.projectId, 'projectId')
  };
}

const api: CodeRecoderDesktopApi = Object.freeze({
  bootstrap: async () => await ipcRenderer.invoke(DESKTOP_IPC.bootstrap),
  chooseDirectory: async (kind: DirectoryKind) => {
    if (kind !== 'project' && kind !== 'storage') throw new TypeError('directory kind is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.chooseDirectory, kind);
  },
  registerProject: async (input: ProjectRegistrationInput) => await ipcRenderer.invoke(
    DESKTOP_IPC.registerProject,
    sanitizeRegistration(input)
  ),
  selectProject: async (projectId: string) => await ipcRenderer.invoke(
    DESKTOP_IPC.selectProject,
    requireUuid(projectId, 'projectId')
  ),
  startProject: async (projectId: string) => await ipcRenderer.invoke(
    DESKTOP_IPC.startProject,
    requireUuid(projectId, 'projectId')
  ),
  stopProject: async (input: { projectId: string; createFinalCheckpoint: boolean }) => {
    if (!input || typeof input !== 'object' || typeof input.createFinalCheckpoint !== 'boolean') {
      throw new TypeError('stop input is invalid');
    }
    return await ipcRenderer.invoke(DESKTOP_IPC.stopProject, {
      projectId: requireUuid(input.projectId, 'projectId'),
      createFinalCheckpoint: input.createFinalCheckpoint
    });
  },
  removeProject: async (input: { projectId: string; createFinalCheckpoint: boolean }) => {
    if (!input || typeof input !== 'object' || typeof input.createFinalCheckpoint !== 'boolean') {
      throw new TypeError('remove input is invalid');
    }
    return await ipcRenderer.invoke(DESKTOP_IPC.removeProject, {
      projectId: requireUuid(input.projectId, 'projectId'),
      createFinalCheckpoint: input.createFinalCheckpoint
    });
  },
  openProjectWindow: async (projectId: string) => await ipcRenderer.invoke(
    DESKTOP_IPC.openProjectWindow,
    requireUuid(projectId, 'projectId')
  ),
  refresh: async (projectId?: string) => await ipcRenderer.invoke(
    DESKTOP_IPC.refresh,
    projectId === undefined ? undefined : requireUuid(projectId, 'projectId')
  ),
  createSnapshot: async (input: { projectId: string; name?: string }) => {
    if (!input || typeof input !== 'object') throw new TypeError('snapshot input is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.createSnapshot, {
      projectId: requireUuid(input.projectId, 'projectId'),
      name: input.name === undefined ? undefined : requireString(input.name, 'name', 200)
    });
  },
  verifySnapshot: async (input: { projectId: string; snapshotId: string }) => {
    if (!input || typeof input !== 'object') throw new TypeError('verification input is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.verifySnapshot, {
      projectId: requireUuid(input.projectId, 'projectId'),
      snapshotId: requireUuid(input.snapshotId, 'snapshotId')
    });
  },
  previewRestore: async (input: { projectId: string; snapshotId: string; mode: RestoreMode }) => {
    if (!input || typeof input !== 'object') throw new TypeError('restore preview input is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.previewRestore, {
      projectId: requireUuid(input.projectId, 'projectId'),
      snapshotId: requireUuid(input.snapshotId, 'snapshotId'),
      mode: requireMode(input.mode)
    });
  },
  restoreSnapshot: async (input: { projectId: string; snapshotId: string; confirmationToken: string }) => {
    if (!input || typeof input !== 'object') throw new TypeError('restore input is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.restoreSnapshot, {
      projectId: requireUuid(input.projectId, 'projectId'),
      snapshotId: requireUuid(input.snapshotId, 'snapshotId'),
      confirmationToken: requireUuid(input.confirmationToken, 'confirmationToken')
    });
  },
  restartSerena: async (projectId: string) => await ipcRenderer.invoke(
    DESKTOP_IPC.restartSerena,
    requireUuid(projectId, 'projectId')
  ),
  inspectMcpEnvironment: async (projectId?: string) => await ipcRenderer.invoke(
    DESKTOP_IPC.inspectMcpEnvironment,
    projectId === undefined ? undefined : requireUuid(projectId, 'projectId')
  ),
  getMcpRecommendation: async (input: { target: McpClientTarget; service: McpServiceTarget; projectId?: string }) => await ipcRenderer.invoke(
    DESKTOP_IPC.getMcpRecommendation,
    sanitizeRecommendationInput(input)
  ),
  copyMcpRecommendation: async (input: { target: McpClientTarget; service: McpServiceTarget; projectId?: string }) => await ipcRenderer.invoke(
    DESKTOP_IPC.copyMcpRecommendation,
    sanitizeRecommendationInput(input)
  ),
  onStateChanged: (listener: (event: DesktopStateEvent) => void) => {
    if (typeof listener !== 'function') throw new TypeError('state listener is invalid');
    const wrapped = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
      if (!raw || typeof raw !== 'object') return;
      const candidate = raw as Partial<DesktopStateEvent>;
      if (
        (candidate.projectId !== null && (typeof candidate.projectId !== 'string' || !UUID_PATTERN.test(candidate.projectId)))
        || !STATE_REASONS.has(candidate.reason as DesktopStateEvent['reason'])
        || typeof candidate.occurredAt !== 'number'
      ) return;
      listener({
        projectId: candidate.projectId ?? null,
        reason: candidate.reason as DesktopStateEvent['reason'],
        occurredAt: candidate.occurredAt
      });
    };
    ipcRenderer.on(DESKTOP_IPC.stateChanged, wrapped);
    return () => ipcRenderer.removeListener(DESKTOP_IPC.stateChanged, wrapped);
  }
});

contextBridge.exposeInMainWorld('codeRecoder', api);
