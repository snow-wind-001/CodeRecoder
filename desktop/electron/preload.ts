import { contextBridge, ipcRenderer } from 'electron';
import {
  DESKTOP_IPC,
  type ActivationInput,
  type CodeRecoderDesktopApi,
  type DirectoryKind,
  type RestoreMode
} from '../shared/contracts.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function sanitizeActivation(input: ActivationInput): ActivationInput {
  if (!input || typeof input !== 'object') throw new TypeError('activation input is invalid');
  if (typeof input.autoCheckpoint !== 'boolean') throw new TypeError('autoCheckpoint is invalid');
  if (!Number.isInteger(input.maxBackups) || input.maxBackups < 2 || input.maxBackups > 10_000) {
    throw new TypeError('maxBackups is invalid');
  }
  return {
    projectPath: requireString(input.projectPath, 'projectPath'),
    storageRoot: input.storageRoot === undefined
      ? undefined
      : requireString(input.storageRoot, 'storageRoot'),
    autoCheckpoint: input.autoCheckpoint,
    maxBackups: input.maxBackups
  };
}

const api: CodeRecoderDesktopApi = Object.freeze({
  bootstrap: async () => await ipcRenderer.invoke(DESKTOP_IPC.bootstrap),
  chooseDirectory: async (kind: DirectoryKind) => {
    if (kind !== 'project' && kind !== 'storage') throw new TypeError('directory kind is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.chooseDirectory, kind);
  },
  activate: async (input: ActivationInput) => await ipcRenderer.invoke(
    DESKTOP_IPC.activate,
    sanitizeActivation(input)
  ),
  deactivate: async (createFinalCheckpoint = true) => {
    if (typeof createFinalCheckpoint !== 'boolean') {
      throw new TypeError('createFinalCheckpoint is invalid');
    }
    return await ipcRenderer.invoke(DESKTOP_IPC.deactivate, createFinalCheckpoint);
  },
  refresh: async () => await ipcRenderer.invoke(DESKTOP_IPC.refresh),
  createSnapshot: async (input: { name?: string }) => {
    if (!input || typeof input !== 'object') throw new TypeError('snapshot input is invalid');
    const name = input.name === undefined ? undefined : requireString(input.name, 'name', 200);
    return await ipcRenderer.invoke(DESKTOP_IPC.createSnapshot, { name });
  },
  verifySnapshot: async (snapshotId: string) => await ipcRenderer.invoke(
    DESKTOP_IPC.verifySnapshot,
    requireUuid(snapshotId, 'snapshotId')
  ),
  previewRestore: async (input: { snapshotId: string; mode: RestoreMode }) => {
    if (!input || typeof input !== 'object') throw new TypeError('restore preview input is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.previewRestore, {
      snapshotId: requireUuid(input.snapshotId, 'snapshotId'),
      mode: requireMode(input.mode)
    });
  },
  restoreSnapshot: async (input: { snapshotId: string; confirmationToken: string }) => {
    if (!input || typeof input !== 'object') throw new TypeError('restore input is invalid');
    return await ipcRenderer.invoke(DESKTOP_IPC.restoreSnapshot, {
      snapshotId: requireUuid(input.snapshotId, 'snapshotId'),
      confirmationToken: requireUuid(input.confirmationToken, 'confirmationToken')
    });
  }
});

contextBridge.exposeInMainWorld('codeRecoder', api);
