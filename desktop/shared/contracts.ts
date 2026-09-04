export const DESKTOP_IPC = {
  bootstrap: 'coderecoder:bootstrap',
  chooseDirectory: 'coderecoder:choose-directory',
  activate: 'coderecoder:activate',
  deactivate: 'coderecoder:deactivate',
  refresh: 'coderecoder:refresh',
  createSnapshot: 'coderecoder:create-snapshot',
  verifySnapshot: 'coderecoder:verify-snapshot',
  previewRestore: 'coderecoder:preview-restore',
  restoreSnapshot: 'coderecoder:restore-snapshot'
} as const;

export type RestoreMode = 'exact' | 'overlay';
export type DirectoryKind = 'project' | 'storage';
export type AutomaticState = 'running' | 'paused' | 'degraded' | 'stopped';

export interface DesktopResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface ActivationInput {
  projectPath: string;
  storageRoot?: string;
  autoCheckpoint: boolean;
  maxBackups: number;
}

export interface SnapshotSummary {
  id: string;
  createdAt: number;
  name: string;
  prompt: string;
  tags: string[];
  trigger: 'activation' | 'automatic' | 'manual' | 'pre-restore' | 'reconciliation';
  storageMode: 'full-copy' | 'hardlink-deduplicated';
  parentSnapshotId?: string;
  status: 'verified';
  treeHash: string;
  totalFiles: number;
  logicalBytes: number;
  storedBytes: number;
  changeCounts: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
  };
}

export interface AutomaticCheckpointStatus {
  state: AutomaticState;
  watcherReady: boolean;
  startedAt: number | null;
  lastEventAt: number | null;
  lastCheckpointAt: number | null;
  lastCheckpointResult: 'created' | 'skipped' | 'failed' | null;
  pendingChangeCount: number;
  backupInProgress: boolean;
  debounceMs: number;
  reconciliationIntervalMs: number;
  lastError: string | null;
}

export interface StorageRecoveryReport {
  checkedAt: number;
  rebuiltIndex: boolean;
  removedPartialSnapshots: number;
  removedExpiredRestoreTokens: number;
  rolledBackInterruptedDeletes: number;
  completedInterruptedDeletes: number;
  recoveredSnapshots: string[];
  warnings: string[];
  interruptedRestore?: {
    snapshotId: string;
    preRestoreSnapshotId: string;
    recoveredAt: number;
  };
}

export interface BackupStatusView {
  state: 'ready';
  projectRoot: string;
  storageRoot: string;
  externalStorage: boolean;
  snapshotCount: number;
  latestSnapshot: SnapshotSummary | null;
  currentMatchesSnapshot: SnapshotSummary | null;
  currentTreeHash: string;
  hasUncheckpointedChanges: boolean;
  hashAlgorithm: 'sha256';
  lastRecovery: StorageRecoveryReport | null;
}

export type RecoveryState =
  | 'ready'
  | 'preview-ready'
  | 'restored'
  | 'restore-rejected'
  | 'rolled-back'
  | 'rollback-failed'
  | 'startup-rollback';

export interface RecoveryView {
  state: RecoveryState;
  title: string;
  detail: string;
  occurredAt?: number;
  snapshotId?: string;
  preRestoreSnapshotId?: string;
}

export interface DesktopDashboard {
  appVersion: string;
  active: boolean;
  defaultStorageRoot: string;
  savedSetup: ActivationInput | null;
  project: {
    name: string;
    root: string;
    storageRoot: string;
    activatedAt: number;
  } | null;
  status: BackupStatusView | null;
  automaticCheckpoint: AutomaticCheckpointStatus;
  snapshots: SnapshotSummary[];
  recovery: RecoveryView;
}

export interface RestorePreview {
  state: 'restore_preview';
  snapshotId: string;
  snapshotName: string;
  mode: RestoreMode;
  changes: {
    added: string[];
    modified: string[];
    deleted: string[];
    renamed: Array<{ from: string; to: string }>;
  };
  counts: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
  };
  confirmationToken: string;
  expiresAt: number;
  requiresConfirmation: true;
}

export interface RestoreOutcome {
  state: 'restored_verified' | 'restore_failed';
  snapshotId: string;
  mode?: RestoreMode;
  preRestoreSnapshotId?: string;
  verification?: 'verified';
  restoredTreeHash?: string;
  rollbackState?: 'restored' | 'failed' | 'unavailable';
  rollbackError?: string;
}

export interface VerificationOutcome {
  snapshotId: string;
  verification: 'verified' | 'failed';
  treeHash?: string;
  verifiedEntries?: number;
  failures?: string[];
}

export interface CodeRecoderDesktopApi {
  bootstrap(): Promise<DesktopResult<DesktopDashboard>>;
  chooseDirectory(kind: DirectoryKind): Promise<DesktopResult<{ path: string | null }>>;
  activate(input: ActivationInput): Promise<DesktopResult>;
  deactivate(createFinalCheckpoint?: boolean): Promise<DesktopResult>;
  refresh(): Promise<DesktopResult<DesktopDashboard>>;
  createSnapshot(input: { name?: string }): Promise<DesktopResult>;
  verifySnapshot(snapshotId: string): Promise<DesktopResult<VerificationOutcome>>;
  previewRestore(input: { snapshotId: string; mode: RestoreMode }): Promise<DesktopResult<RestorePreview>>;
  restoreSnapshot(input: { snapshotId: string; confirmationToken: string }): Promise<DesktopResult<RestoreOutcome>>;
}
