export const DESKTOP_IPC = {
  bootstrap: 'coderecoder:bootstrap',
  chooseDirectory: 'coderecoder:choose-directory',
  registerProject: 'coderecoder:register-project',
  selectProject: 'coderecoder:select-project',
  startProject: 'coderecoder:start-project',
  stopProject: 'coderecoder:stop-project',
  removeProject: 'coderecoder:remove-project',
  openProjectWindow: 'coderecoder:open-project-window',
  refresh: 'coderecoder:refresh',
  createSnapshot: 'coderecoder:create-snapshot',
  verifySnapshot: 'coderecoder:verify-snapshot',
  previewRestore: 'coderecoder:preview-restore',
  restoreSnapshot: 'coderecoder:restore-snapshot',
  restartSerena: 'coderecoder:restart-serena',
  inspectMcpEnvironment: 'coderecoder:inspect-mcp-environment',
  getMcpRecommendation: 'coderecoder:get-mcp-recommendation',
  copyMcpRecommendation: 'coderecoder:copy-mcp-recommendation',
  stateChanged: 'coderecoder:state-changed'
} as const;

export type ProjectId = string;
export type RestoreMode = 'exact' | 'overlay';
export type DirectoryKind = 'project' | 'storage';
export type AutomaticState = 'running' | 'paused' | 'degraded' | 'stopped';
export type ProtectionState = 'starting' | 'running' | 'degraded' | 'stopped';
export type SerenaState = 'disabled' | 'checking' | 'configuring' | 'starting' | 'ready' | 'degraded' | 'stopped';
export type DesktopWindowKind = 'main' | 'project';
export type McpClientTarget = 'vscode' | 'cursor' | 'claude-code' | 'codex';
export type McpServiceTarget = 'coderecorder' | 'serena';

export interface DesktopResult<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface ProjectRegistrationInput {
  projectPath: string;
  storageRoot?: string;
  autoCheckpoint: boolean;
  maxBackups: number;
  startOnLaunch: boolean;
  serenaEnabled: boolean;
  serenaAutoConfigure: boolean;
}

/** Kept as an alias for integrations compiled against the initial desktop preview. */
export type ActivationInput = ProjectRegistrationInput;

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

export interface SerenaStatus {
  state: SerenaState;
  enabled: boolean;
  autoConfigure: boolean;
  cliPath: string | null;
  configPath: string;
  endpoint: string | null;
  pid: number | null;
  startedAt: number | null;
  lastCheckedAt: number | null;
  lastError: string | null;
  lastLog: string | null;
  repairedConfigBackup: string | null;
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

export interface ProjectSummary {
  id: ProjectId;
  name: string;
  root: string;
  storageRoot: string;
  registeredAt: number;
  activatedAt: number | null;
  startOnLaunch: boolean;
  protectionState: ProtectionState;
  snapshotCount: number;
  latestSnapshotAt: number | null;
  hasUncheckpointedChanges: boolean | null;
  automaticCheckpoint: AutomaticCheckpointStatus;
  serena: SerenaStatus;
  lastError: string | null;
}

export interface ProjectDashboard {
  project: ProjectSummary;
  config: ProjectRegistrationInput;
  status: BackupStatusView | null;
  snapshots: SnapshotSummary[];
  recovery: RecoveryView;
}

export interface DesktopDashboard {
  schemaVersion: 2;
  appVersion: string;
  defaultStorageRoot: string;
  window: {
    kind: DesktopWindowKind;
    projectId: ProjectId | null;
  };
  selectedProjectId: ProjectId | null;
  projects: ProjectSummary[];
  selectedProject: ProjectDashboard | null;
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

export interface EnvironmentCheckItem {
  id: 'node' | 'server-build' | 'serena' | 'serena-project' | 'vscode' | 'cursor' | 'claude-code' | 'codex';
  label: string;
  status: 'available' | 'missing' | 'warning';
  required: boolean;
  path: string | null;
  version: string | null;
  detail: string;
}

export interface McpEnvironmentReport {
  checkedAt: number;
  projectId: ProjectId | null;
  ready: boolean;
  items: EnvironmentCheckItem[];
}

export interface McpRecommendation {
  target: McpClientTarget;
  service: McpServiceTarget;
  title: string;
  format: 'json' | 'toml' | 'shell';
  configPath: string;
  content: string;
  notes: string[];
  endpoint: string | null;
  endpointIsTemporary: boolean;
}

export interface DesktopStateEvent {
  projectId: ProjectId | null;
  reason: 'project-registered' | 'project-started' | 'project-stopped' | 'project-removed' | 'checkpoint' | 'serena' | 'restore' | 'selection';
  occurredAt: number;
}

export interface CodeRecoderDesktopApi {
  bootstrap(): Promise<DesktopResult<DesktopDashboard>>;
  chooseDirectory(kind: DirectoryKind): Promise<DesktopResult<{ path: string | null }>>;
  registerProject(input: ProjectRegistrationInput): Promise<DesktopResult<{ projectId: ProjectId }>>;
  selectProject(projectId: ProjectId): Promise<DesktopResult<DesktopDashboard>>;
  startProject(projectId: ProjectId): Promise<DesktopResult>;
  stopProject(input: { projectId: ProjectId; createFinalCheckpoint: boolean }): Promise<DesktopResult>;
  removeProject(input: { projectId: ProjectId; createFinalCheckpoint: boolean }): Promise<DesktopResult>;
  openProjectWindow(projectId: ProjectId): Promise<DesktopResult>;
  refresh(projectId?: ProjectId): Promise<DesktopResult<DesktopDashboard>>;
  createSnapshot(input: { projectId: ProjectId; name?: string }): Promise<DesktopResult>;
  verifySnapshot(input: { projectId: ProjectId; snapshotId: string }): Promise<DesktopResult<VerificationOutcome>>;
  previewRestore(input: { projectId: ProjectId; snapshotId: string; mode: RestoreMode }): Promise<DesktopResult<RestorePreview>>;
  restoreSnapshot(input: { projectId: ProjectId; snapshotId: string; confirmationToken: string }): Promise<DesktopResult<RestoreOutcome>>;
  restartSerena(projectId: ProjectId): Promise<DesktopResult<SerenaStatus>>;
  inspectMcpEnvironment(projectId?: ProjectId): Promise<DesktopResult<McpEnvironmentReport>>;
  getMcpRecommendation(input: { target: McpClientTarget; service: McpServiceTarget; projectId?: ProjectId }): Promise<DesktopResult<McpRecommendation>>;
  copyMcpRecommendation(input: { target: McpClientTarget; service: McpServiceTarget; projectId?: ProjectId }): Promise<DesktopResult>;
  onStateChanged(listener: (event: DesktopStateEvent) => void): () => void;
}
