import { createReadStream, promises as nodeFs } from 'fs';
import crypto from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const SCHEMA_VERSION = 1;
const LOCK_STALE_MS = 15 * 1000;
const LOCK_WAIT_MS = 30 * 1000;
const LOCK_HEARTBEAT_MS = 2 * 1000;
const RESTORE_TOKEN_TTL_MS = 5 * 60 * 1000;

export type BackupEntryKind = 'directory' | 'file' | 'symlink';
export type BackupTrigger = 'activation' | 'automatic' | 'manual' | 'pre-restore' | 'reconciliation';
export type RestoreMode = 'exact' | 'overlay';

export interface BackupEntry {
  path: string;
  kind: BackupEntryKind;
  mode: number;
  size: number;
  mtimeMs: number;
  hash?: string;
  linkTarget?: string;
}

export interface BackupChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

export interface BackupManifest {
  schemaVersion: number;
  id: string;
  projectRoot: string;
  createdAt: number;
  name: string;
  prompt: string;
  tags: string[];
  trigger: BackupTrigger;
  storageMode: 'full-copy' | 'hardlink-deduplicated';
  parentSnapshotId?: string;
  status: 'verified';
  entries: BackupEntry[];
  changes: BackupChangeSet;
  evidence: {
    hashAlgorithm: 'sha256';
    treeHash: string;
    copiedFiles: number;
    linkedFiles: number;
    totalFiles: number;
    logicalBytes: number;
    storedBytes: number;
  };
  git?: {
    branch?: string;
    commit?: string;
  };
}

export interface BackupSummary {
  id: string;
  createdAt: number;
  name: string;
  prompt: string;
  tags: string[];
  trigger: BackupTrigger;
  storageMode: BackupManifest['storageMode'];
  parentSnapshotId?: string;
  status: BackupManifest['status'];
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

interface BackupIndex {
  schemaVersion: number;
  projectRoot: string;
  createdAt: number;
  updatedAt: number;
  snapshots: BackupSummary[];
  settings: {
    maxBackups: number;
  };
}

interface PendingRestore {
  schemaVersion: number;
  token: string;
  snapshotId: string;
  mode: RestoreMode;
  projectRoot: string;
  currentTreeHash: string;
  createdAt: number;
  expiresAt: number;
}

interface RestoreRecoveryJournal {
  schemaVersion: number;
  projectRoot: string;
  snapshotId: string;
  preRestoreSnapshotId: string;
  mode: RestoreMode;
  startedAt: number;
  state: 'applying' | 'rollback-required';
  error?: string;
}

interface StorageRecoveryReport {
  checkedAt: number;
  rebuiltIndex: boolean;
  preservedCorruptIndex?: string;
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

export interface BackupManagerOptions {
  storageRoot?: string;
  maxBackups?: number;
  excludeNames?: string[];
}

export interface CreateBackupOptions {
  prompt?: string;
  name?: string;
  tags?: string[];
  trigger?: BackupTrigger;
  skipIfUnchanged?: boolean;
  preserveSnapshotIds?: string[];
}

export interface BackupResponse<T = Record<string, unknown>> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

interface MaterializeStats {
  copiedFiles: number;
  linkedFiles: number;
  logicalBytes: number;
  storedBytes: number;
}

const DEFAULT_EXCLUDED_NAMES = new Set([
  '.CodeRecoder',
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.parcel-cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.turbo',
  '.venv',
  'venv',
  'out',
  'target',
  '__pycache__'
]);

export class BackupManager {
  private projectRoot = '';
  private projectRootReal = '';
  private storageRoot = '';
  private indexPath = '';
  private snapshotsRoot = '';
  private pendingRoot = '';
  private lockPath = '';
  private projectLockPath = '';
  private recoveryPath = '';
  private maxBackups = 100;
  private requestedMaxBackups?: number;
  private excludedNames = new Set(DEFAULT_EXCLUDED_NAMES);
  private initialized = false;
  private lastRecovery?: StorageRecoveryReport;

  async initialize(projectRoot: string, options: BackupManagerOptions = {}): Promise<void> {
    if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
      throw new Error('projectRoot cannot be empty');
    }
    if (
      options.maxBackups !== undefined
      && (!Number.isInteger(options.maxBackups) || options.maxBackups < 2)
    ) {
      throw new Error('maxBackups must be an integer of at least 2');
    }
    if (options.storageRoot !== undefined && options.storageRoot.trim().length === 0) {
      throw new Error('storageRoot cannot be empty');
    }
    this.initialized = false;
    this.lastRecovery = undefined;
    const resolvedRoot = path.resolve(projectRoot);
    const stats = await nodeFs.stat(resolvedRoot);
    if (!stats.isDirectory()) {
      throw new Error(`Project root is not a directory: ${resolvedRoot}`);
    }
    const realProjectRoot = await nodeFs.realpath(resolvedRoot);
    if (realProjectRoot === path.parse(realProjectRoot).root) {
      throw new Error('Refusing to use a filesystem root as a code project');
    }
    for (const excludedName of options.excludeNames ?? []) {
      if (!excludedName || excludedName === '.' || excludedName === '..' || /[/\\]/.test(excludedName)) {
        throw new Error(`Invalid excluded path name: ${excludedName}`);
      }
    }

    this.projectRoot = realProjectRoot;
    this.projectRootReal = realProjectRoot;
    this.requestedMaxBackups = options.maxBackups;
    this.maxBackups = Math.max(2, options.maxBackups ?? 100);
    this.excludedNames = new Set([...DEFAULT_EXCLUDED_NAMES, ...(options.excludeNames ?? [])]);

    const projectKey = crypto.createHash('sha256').update(this.projectRootReal).digest('hex').slice(0, 16);
    if (options.storageRoot) {
      const projectName = path.basename(this.projectRootReal).replace(/[^a-zA-Z0-9._-]/g, '_');
      this.storageRoot = path.join(path.resolve(options.storageRoot), `${projectName}-${projectKey}`);
    } else {
      this.storageRoot = path.join(this.projectRoot, '.CodeRecoder', 'backups');
    }

    await fs.ensureDir(this.storageRoot);
    this.storageRoot = await nodeFs.realpath(this.storageRoot);
    this.snapshotsRoot = path.join(this.storageRoot, 'snapshots');
    this.pendingRoot = path.join(this.storageRoot, 'pending');
    this.indexPath = path.join(this.storageRoot, 'index.json');
    this.lockPath = path.join(this.storageRoot, '.backup.lock');
    this.recoveryPath = path.join(this.storageRoot, 'restore-recovery.json');
    const userKey = typeof process.getuid === 'function' ? String(process.getuid()) : 'default';
    const projectLocksRoot = path.join(os.tmpdir(), `coderecoder-project-locks-${userKey}`);
    this.projectLockPath = path.join(projectLocksRoot, `${projectKey}.lock`);

    await fs.ensureDir(this.snapshotsRoot);
    await fs.ensureDir(this.pendingRoot);
    await fs.ensureDir(projectLocksRoot);
    for (const directoryPath of [this.storageRoot, this.snapshotsRoot, this.pendingRoot, projectLocksRoot]) {
      const directoryStats = await nodeFs.lstat(directoryPath);
      if (!directoryStats.isDirectory()) {
        throw new Error(`Backup infrastructure path is not a real directory: ${directoryPath}`);
      }
    }
    await Promise.all([
      nodeFs.chmod(this.storageRoot, 0o700),
      nodeFs.chmod(this.snapshotsRoot, 0o700),
      nodeFs.chmod(this.pendingRoot, 0o700),
      nodeFs.chmod(projectLocksRoot, 0o700)
    ]);

    await this.withOperationLocks(async () => {
      let preservedCorruptIndex: string | undefined;
      if (!(await fs.pathExists(this.indexPath))) {
        await this.atomicWriteJson(this.indexPath, this.createEmptyIndex());
      } else {
        try {
          await this.readIndex();
        } catch (error) {
          preservedCorruptIndex = path.join(
            this.storageRoot,
            `index.corrupt-${Date.now()}-${crypto.randomUUID()}.json`
          );
          await nodeFs.rename(this.indexPath, preservedCorruptIndex);
          await this.atomicWriteJson(this.indexPath, this.createEmptyIndex());
          console.error('Rebuilding backup index from verified manifests:', this.errorMessage(error));
        }
      }
      this.lastRecovery = await this.recoverStorage();
      if (preservedCorruptIndex) {
        this.lastRecovery.rebuiltIndex = true;
        this.lastRecovery.preservedCorruptIndex = preservedCorruptIndex;
        this.lastRecovery.warnings.push('Backup index was rebuilt from verified snapshot manifests');
      }
    });

    this.initialized = true;
  }

  getProjectRoot(): string {
    this.assertInitialized();
    return this.projectRoot;
  }

  getStorageRoot(): string {
    this.assertInitialized();
    return this.storageRoot;
  }

  isPathIgnored(candidatePath: string): boolean {
    if (!this.initialized) return false;
    const absolutePath = path.resolve(candidatePath);
    const relativePath = path.relative(this.projectRoot, absolutePath);
    if (!relativePath || relativePath === '.') return false;
    if (this.isOutside(relativePath)) return true;
    return this.shouldExclude(relativePath);
  }

  async createBackup(options: CreateBackupOptions = {}): Promise<BackupResponse> {
    this.assertInitialized();

    try {
      return await this.withOperationLocks(async () => {
        const index = await this.readIndex();
        const entries = await this.scanProject();
        const treeHash = this.calculateTreeHash(entries);
        const previousSummary = index.snapshots[index.snapshots.length - 1];
        const previousManifest = previousSummary
          ? await this.readManifest(previousSummary.id)
          : undefined;

        if (options.skipIfUnchanged && previousManifest?.evidence.treeHash === treeHash) {
          return {
            success: true,
            message: 'No code changes detected; automatic checkpoint skipped',
            data: {
              skipped: true,
              reason: 'unchanged',
              latestSnapshotId: previousManifest.id,
              treeHash
            }
          };
        }

        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const stagingRoot = path.join(this.snapshotsRoot, `.partial-${id}`);
        const finalRoot = path.join(this.snapshotsRoot, id);
        const treeRoot = path.join(stagingRoot, 'tree');
        const changes = this.compareEntries(previousManifest?.entries ?? [], entries);

        await fs.remove(stagingRoot);
        await fs.ensureDir(treeRoot);
        await nodeFs.chmod(stagingRoot, 0o700);
        await nodeFs.chmod(treeRoot, 0o700);

        try {
          const materializeStats = await this.materializeTree(
            entries,
            treeRoot,
            previousManifest
          );

          const git = await this.readGitEvidence();
          const manifest: BackupManifest = {
            schemaVersion: SCHEMA_VERSION,
            id,
            projectRoot: this.projectRootReal,
            createdAt,
            name: options.name || this.defaultBackupName(createdAt, options.trigger ?? 'manual'),
            prompt: options.prompt || 'Code backup checkpoint',
            tags: options.tags ?? [],
            trigger: options.trigger ?? 'manual',
            storageMode: previousManifest ? 'hardlink-deduplicated' : 'full-copy',
            parentSnapshotId: previousManifest?.id,
            status: 'verified',
            entries,
            changes,
            evidence: {
              hashAlgorithm: 'sha256',
              treeHash,
              copiedFiles: materializeStats.copiedFiles,
              linkedFiles: materializeStats.linkedFiles,
              totalFiles: entries.filter(entry => entry.kind === 'file').length,
              logicalBytes: materializeStats.logicalBytes,
              storedBytes: materializeStats.storedBytes
            },
            git
          };

          await this.atomicWriteJson(path.join(stagingRoot, 'manifest.json'), manifest);
          await nodeFs.rename(stagingRoot, finalRoot);
          await this.syncDirectory(this.snapshotsRoot);

          const summary = this.toSummary(manifest);
          index.snapshots.push(summary);
          index.updatedAt = Date.now();

          const expired = this.applyRetention(
            index,
            new Set(options.preserveSnapshotIds ?? [])
          );
          await this.atomicWriteJson(this.indexPath, index);

          for (const expiredId of expired) {
            await fs.remove(path.join(this.snapshotsRoot, expiredId));
          }
          if (expired.length > 0) await this.syncDirectory(this.snapshotsRoot);

          return {
            success: true,
            message: 'Verified code backup created',
            data: {
              snapshot: summary,
              storageRoot: this.storageRoot,
              verification: 'verified'
            }
          };
        } catch (error) {
          await fs.remove(stagingRoot);
          throw error;
        }
      });
    } catch (error) {
      return this.failure('Failed to create code backup', error);
    }
  }

  async listBackups(limit = 50): Promise<BackupResponse> {
    this.assertInitialized();

    try {
      if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
      const index = await this.readIndex();
      const snapshots = [...index.snapshots]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, Math.max(1, limit));

      return {
        success: true,
        message: `Found ${index.snapshots.length} verified code backups`,
        data: {
          snapshots,
          total: index.snapshots.length,
          projectRoot: this.projectRoot,
          storageRoot: this.storageRoot
        }
      };
    } catch (error) {
      return this.failure('Failed to list code backups', error);
    }
  }

  async getStatus(): Promise<BackupResponse> {
    this.assertInitialized();

    try {
      const index = await this.readIndex();
      const latest = index.snapshots[index.snapshots.length - 1];
      const currentEntries = await this.scanProject();
      const currentTreeHash = this.calculateTreeHash(currentEntries);
      const matchingSnapshot = [...index.snapshots]
        .reverse()
        .find(snapshot => snapshot.treeHash === currentTreeHash);

      return {
        success: true,
        message: 'Backup system status retrieved',
        data: {
          state: 'ready',
          projectRoot: this.projectRoot,
          storageRoot: this.storageRoot,
          externalStorage: !this.isPathWithin(this.projectRootReal, this.storageRoot),
          snapshotCount: index.snapshots.length,
          latestSnapshot: latest ?? null,
          currentMatchesSnapshot: matchingSnapshot ?? null,
          currentTreeHash,
          hasUncheckpointedChanges: matchingSnapshot === undefined,
          hashAlgorithm: 'sha256',
          lastRecovery: this.lastRecovery ?? null
        }
      };
    } catch (error) {
      return this.failure('Failed to read backup status', error);
    }
  }

  async verifyBackup(snapshotId: string): Promise<BackupResponse> {
    this.assertInitialized();

    try {
      this.assertIdentifier(snapshotId, 'snapshot ID');
      const manifest = await this.readManifest(snapshotId);
      const failures = await this.verifyManifestFiles(manifest);

      if (failures.length > 0) {
        return {
          success: false,
          message: 'Backup verification failed',
          error: `${failures.length} entries failed verification`,
          data: {
            snapshotId,
            verification: 'failed',
            failures: failures.slice(0, 100)
          }
        };
      }

      return {
        success: true,
        message: 'Backup verification completed successfully',
        data: {
          snapshotId,
          verification: 'verified',
          treeHash: manifest.evidence.treeHash,
          verifiedEntries: manifest.entries.length
        }
      };
    } catch (error) {
      return this.failure('Failed to verify code backup', error);
    }
  }

  async previewRestore(snapshotId: string, mode: RestoreMode = 'exact'): Promise<BackupResponse> {
    this.assertInitialized();

    try {
      this.assertIdentifier(snapshotId, 'snapshot ID');
      if (mode !== 'exact' && mode !== 'overlay') throw new Error('Invalid restore mode');
      const verification = await this.verifyBackup(snapshotId);
      if (!verification.success) return verification;

      const manifest = await this.readManifest(snapshotId);
      const currentEntries = await this.scanProject();
      const currentTreeHash = this.calculateTreeHash(currentEntries);
      const changes = this.compareEntries(currentEntries, manifest.entries);
      const token = crypto.randomUUID();
      const now = Date.now();
      const pending: PendingRestore = {
        schemaVersion: SCHEMA_VERSION,
        token,
        snapshotId,
        mode,
        projectRoot: this.projectRootReal,
        currentTreeHash,
        createdAt: now,
        expiresAt: now + RESTORE_TOKEN_TTL_MS
      };

      await this.atomicWriteJson(path.join(this.pendingRoot, `${token}.json`), pending);

      return {
        success: true,
        message: 'Restore preview created; explicit confirmation is required',
        data: {
          state: 'restore_preview',
          snapshotId,
          snapshotName: manifest.name,
          mode,
          changes,
          counts: this.changeCounts(changes),
          confirmationToken: token,
          expiresAt: pending.expiresAt,
          requiresConfirmation: true
        }
      };
    } catch (error) {
      return this.failure('Failed to preview code restore', error);
    }
  }

  async restoreBackup(snapshotId: string, confirmationToken: string): Promise<BackupResponse> {
    this.assertInitialized();

    try {
      this.assertIdentifier(snapshotId, 'snapshot ID');
      this.assertIdentifier(confirmationToken, 'confirmation token');
      const pendingPath = path.join(this.pendingRoot, `${confirmationToken}.json`);
      if (!(await fs.pathExists(pendingPath))) {
        throw new Error('Restore confirmation token is invalid, expired, or already consumed');
      }
      const pending = await this.readJson<PendingRestore>(pendingPath);

      if (
        pending.schemaVersion !== SCHEMA_VERSION
        || pending.token !== confirmationToken
        || pending.snapshotId !== snapshotId
        || pending.projectRoot !== this.projectRootReal
        || (pending.mode !== 'exact' && pending.mode !== 'overlay')
        || !Number.isFinite(pending.expiresAt)
        || !/^[a-f0-9]{64}$/.test(pending.currentTreeHash)
      ) {
        throw new Error('Restore confirmation does not match this snapshot or project');
      }
      if (pending.expiresAt < Date.now()) {
        await fs.remove(pendingPath);
        await this.syncDirectory(this.pendingRoot);
        throw new Error('Restore confirmation expired; create a new preview');
      }

      const currentEntries = await this.scanProject();
      if (this.calculateTreeHash(currentEntries) !== pending.currentTreeHash) {
        throw new Error('Project changed after the preview; create a new restore preview');
      }

      const preRestore = await this.createBackup({
        name: `Pre-restore ${new Date().toISOString()}`,
        prompt: `Automatic safety backup before restoring ${snapshotId}`,
        tags: ['pre-restore', 'protected'],
        trigger: 'pre-restore',
        skipIfUnchanged: false,
        preserveSnapshotIds: [snapshotId]
      });
      if (!preRestore.success) {
        throw new Error(`Unable to create pre-restore backup: ${preRestore.error ?? preRestore.message}`);
      }

      const preRestoreId = this.extractSnapshotId(preRestore);
      if (!preRestoreId) {
        throw new Error('Pre-restore backup completed without a snapshot ID');
      }

      return await this.withOperationLocks(async () => {
        const latestEntries = await this.scanProject();
        if (this.calculateTreeHash(latestEntries) !== pending.currentTreeHash) {
          throw new Error('Project changed while preparing the restore; no files were restored');
        }

        const targetManifest = await this.readManifest(snapshotId);
        const targetFailures = await this.verifyManifestFiles(targetManifest);
        if (targetFailures.length > 0) {
          throw new Error(`Target backup failed verification for ${targetFailures.length} entries`);
        }
        if (!(await fs.pathExists(pendingPath))) {
          throw new Error('Restore confirmation token was already consumed');
        }
        await fs.remove(pendingPath);
        await this.syncDirectory(this.pendingRoot);

        const recoveryJournal: RestoreRecoveryJournal = {
          schemaVersion: SCHEMA_VERSION,
          projectRoot: this.projectRootReal,
          snapshotId,
          preRestoreSnapshotId: preRestoreId,
          mode: pending.mode,
          startedAt: Date.now(),
          state: 'applying'
        };
        await this.atomicWriteJson(this.recoveryPath, recoveryJournal);

        try {
          await this.applyManifest(targetManifest, pending.mode);
          const restoredEntries = await this.scanProject();
          const verification = this.verifyRestoredState(restoredEntries, targetManifest.entries, pending.mode);
          if (!verification.success) {
            throw new Error(verification.error);
          }

          await this.removeRecoveryJournal();
          return {
            success: true,
            message: 'Code restore completed and verified',
            data: {
              state: 'restored_verified',
              snapshotId,
              mode: pending.mode,
              preRestoreSnapshotId: preRestoreId,
              verification: 'verified',
              restoredTreeHash: this.calculateTreeHash(targetManifest.entries)
            }
          };
        } catch (restoreError) {
          let rollbackState: 'restored' | 'failed' | 'unavailable' = 'unavailable';
          let rollbackError: string | undefined;

          try {
            try {
              await this.atomicWriteJson(this.recoveryPath, {
                ...recoveryJournal,
                state: 'rollback-required',
                error: this.errorMessage(restoreError)
              } satisfies RestoreRecoveryJournal);
            } catch (journalError) {
              console.error('Failed to update restore recovery journal:', journalError);
            }
            await this.rollbackToSnapshot(preRestoreId);
            rollbackState = 'restored';
            try {
              await this.removeRecoveryJournal();
            } catch (journalError) {
              console.error('Failed to remove completed recovery journal:', journalError);
            }
          } catch (error) {
            rollbackState = 'failed';
            rollbackError = this.errorMessage(error);
          }

          return {
            success: false,
            message: 'Code restore failed',
            error: this.errorMessage(restoreError),
            data: {
              state: 'restore_failed',
              snapshotId,
              preRestoreSnapshotId: preRestoreId,
              rollbackState,
              rollbackError
            }
          };
        }
      });
    } catch (error) {
      return this.failure('Failed to restore code backup', error);
    }
  }

  async deleteBackup(snapshotId: string, confirmSnapshotId: string): Promise<BackupResponse> {
    this.assertInitialized();

    try {
      this.assertIdentifier(snapshotId, 'snapshot ID');
      if (confirmSnapshotId !== snapshotId) {
        throw new Error('Deletion confirmation must exactly match the snapshot ID');
      }

      return await this.withFileLock(async () => {
        const index = await this.readIndex();
        const snapshotIndex = index.snapshots.findIndex(snapshot => snapshot.id === snapshotId);
        if (snapshotIndex < 0) throw new Error(`Backup not found: ${snapshotId}`);

        const snapshotRoot = path.join(this.snapshotsRoot, snapshotId);
        const deletingRoot = path.join(this.snapshotsRoot, `.deleting-${snapshotId}`);
        await fs.remove(deletingRoot);
        await nodeFs.rename(snapshotRoot, deletingRoot);
        await this.syncDirectory(this.snapshotsRoot);

        const [removed] = index.snapshots.splice(snapshotIndex, 1);
        index.updatedAt = Date.now();
        try {
          await this.atomicWriteJson(this.indexPath, index);
        } catch (error) {
          await nodeFs.rename(deletingRoot, snapshotRoot);
          await this.syncDirectory(this.snapshotsRoot);
          throw error;
        }

        let cleanupPending = false;
        try {
          await fs.remove(deletingRoot);
          await this.syncDirectory(this.snapshotsRoot);
        } catch (error) {
          cleanupPending = true;
          console.error('Deleted backup cleanup deferred until next initialization:', error);
        }

        return {
          success: true,
          message: 'Code backup deleted',
          data: {
            state: 'deleted',
            snapshot: removed,
            remainingSnapshots: index.snapshots.length,
            cleanupPending
          }
        };
      });
    } catch (error) {
      return this.failure('Failed to delete code backup', error);
    }
  }

  private async materializeTree(
    entries: BackupEntry[],
    treeRoot: string,
    previousManifest?: BackupManifest
  ): Promise<MaterializeStats> {
    const previousEntries = new Map((previousManifest?.entries ?? []).map(entry => [entry.path, entry]));
    const previousTreeRoot = previousManifest
      ? path.join(this.snapshotsRoot, previousManifest.id, 'tree')
      : undefined;
    const stats: MaterializeStats = {
      copiedFiles: 0,
      linkedFiles: 0,
      logicalBytes: 0,
      storedBytes: 0
    };

    const directories = entries
      .filter(entry => entry.kind === 'directory')
      .sort((left, right) => this.depth(left.path) - this.depth(right.path));
    for (const entry of directories) {
      const directoryPath = this.safeJoin(treeRoot, entry.path);
      await fs.ensureDir(directoryPath);
      await nodeFs.chmod(directoryPath, 0o700);
    }

    for (const entry of entries.filter(candidate => candidate.kind !== 'directory')) {
      const destinationPath = this.safeJoin(treeRoot, entry.path);
      await fs.ensureDir(path.dirname(destinationPath));

      if (entry.kind === 'symlink') {
        await nodeFs.symlink(entry.linkTarget ?? '', destinationPath);
        continue;
      }

      stats.logicalBytes += entry.size;
      const previousEntry = previousEntries.get(entry.path);
      const canLink = previousTreeRoot && previousEntry && this.entriesEqual(previousEntry, entry);

      if (canLink) {
        try {
          await nodeFs.link(this.safeJoin(previousTreeRoot, entry.path), destinationPath);
          stats.linkedFiles++;
        } catch {
          await this.copySourceFile(entry, destinationPath);
          stats.copiedFiles++;
          stats.storedBytes += entry.size;
        }
      } else {
        await this.copySourceFile(entry, destinationPath);
        stats.copiedFiles++;
        stats.storedBytes += entry.size;
      }

      const copiedHash = await this.hashFile(destinationPath);
      if (copiedHash !== entry.hash) {
        throw new Error(`Source changed while backing up: ${entry.path}`);
      }
      await nodeFs.chmod(destinationPath, 0o600);
      await this.syncFile(destinationPath);
    }

    for (const entry of [...directories].reverse()) {
      const directoryPath = this.safeJoin(treeRoot, entry.path);
      await nodeFs.chmod(directoryPath, 0o700);
      await this.syncDirectory(directoryPath);
    }
    await this.syncDirectory(treeRoot);

    return stats;
  }

  private async copySourceFile(entry: BackupEntry, destinationPath: string): Promise<void> {
    const sourcePath = this.safeJoin(this.projectRoot, entry.path);
    const sourceReal = await nodeFs.realpath(sourcePath);
    if (!this.isPathWithin(this.projectRootReal, sourceReal)) {
      throw new Error(`Refusing to back up a file outside the project root: ${entry.path}`);
    }
    await nodeFs.copyFile(sourcePath, destinationPath);
  }

  private async applyManifest(manifest: BackupManifest, mode: RestoreMode): Promise<void> {
    const currentEntries = await this.scanProject();
    const targetMap = new Map(manifest.entries.map(entry => [entry.path, entry]));

    if (mode === 'exact') {
      const removable = currentEntries
        .filter(entry => !targetMap.has(entry.path))
        .sort((left, right) => this.depth(right.path) - this.depth(left.path));

      for (const entry of removable.filter(candidate => candidate.kind !== 'directory')) {
        await fs.remove(this.safeJoin(this.projectRoot, entry.path));
      }
      for (const entry of removable.filter(candidate => candidate.kind === 'directory')) {
        try {
          await nodeFs.rmdir(this.safeJoin(this.projectRoot, entry.path));
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOTEMPTY' && code !== 'ENOENT') throw error;
        }
      }
    }

    const directories = manifest.entries
      .filter(entry => entry.kind === 'directory')
      .sort((left, right) => this.depth(left.path) - this.depth(right.path));
    for (const entry of directories) {
      const destinationPath = this.safeJoin(this.projectRoot, entry.path);
      const existing = await this.lstatIfExists(destinationPath);
      if (existing && !existing.isDirectory()) await fs.remove(destinationPath);
      await fs.ensureDir(destinationPath);
    }

    const snapshotTree = path.join(this.snapshotsRoot, manifest.id, 'tree');
    for (const entry of manifest.entries.filter(candidate => candidate.kind !== 'directory')) {
      const destinationPath = this.safeJoin(this.projectRoot, entry.path);
      const existing = await this.lstatIfExists(destinationPath);
      if (existing?.isDirectory()) {
        try {
          await nodeFs.rmdir(destinationPath);
        } catch {
          throw new Error(`Cannot replace non-empty directory during restore: ${entry.path}`);
        }
      } else if (existing) {
        await fs.remove(destinationPath);
      }

      await fs.ensureDir(path.dirname(destinationPath));
      const temporaryPath = `${destinationPath}.coderecoder-restore-${crypto.randomUUID()}`;
      try {
        if (entry.kind === 'symlink') {
          await nodeFs.symlink(entry.linkTarget ?? '', temporaryPath);
        } else {
          await nodeFs.copyFile(this.safeJoin(snapshotTree, entry.path), temporaryPath);
          const handle = await nodeFs.open(temporaryPath, 'r+');
          try {
            await handle.chmod(entry.mode & 0o777);
            await handle.utimes(new Date(), new Date(entry.mtimeMs));
            await handle.sync();
          } finally {
            await handle.close();
          }
        }

        await nodeFs.rename(temporaryPath, destinationPath);
      } catch (error) {
        await fs.remove(temporaryPath);
        throw error;
      }
    }

    for (const entry of [...directories].reverse()) {
      const destinationPath = this.safeJoin(this.projectRoot, entry.path);
      await nodeFs.chmod(destinationPath, entry.mode & 0o777);
      await this.syncDirectory(destinationPath);
    }
    await this.syncDirectory(this.projectRoot);
  }

  private verifyRestoredState(
    actualEntries: BackupEntry[],
    expectedEntries: BackupEntry[],
    mode: RestoreMode
  ): { success: true } | { success: false; error: string } {
    const actualMap = new Map(actualEntries.map(entry => [entry.path, entry]));
    const expectedMap = new Map(expectedEntries.map(entry => [entry.path, entry]));

    for (const [relativePath, expected] of expectedMap) {
      const actual = actualMap.get(relativePath);
      if (!actual || !this.entriesEqual(actual, expected)) {
        return { success: false, error: `Restored entry does not match backup: ${relativePath}` };
      }
    }

    if (mode === 'exact') {
      for (const relativePath of actualMap.keys()) {
        if (!expectedMap.has(relativePath)) {
          return { success: false, error: `Unexpected entry remains after exact restore: ${relativePath}` };
        }
      }
    }

    return { success: true };
  }

  private async verifyManifestFiles(manifest: BackupManifest): Promise<string[]> {
    const failures: string[] = [];
    const treeRoot = path.join(this.snapshotsRoot, manifest.id, 'tree');
    const treeStats = await this.lstatIfExists(treeRoot);
    if (!treeStats?.isDirectory()) return ['.: backup tree is missing or is not a directory'];
    const expectedPaths = new Set(manifest.entries.map(entry => entry.path));

    for (const entry of manifest.entries) {
      const entryPath = this.safeJoin(treeRoot, entry.path);
      const stats = await this.lstatIfExists(entryPath);
      if (!stats) {
        failures.push(`${entry.path}: missing`);
        continue;
      }

      if (entry.kind === 'directory' && !stats.isDirectory()) {
        failures.push(`${entry.path}: expected directory`);
      } else if (entry.kind === 'symlink') {
        if (!stats.isSymbolicLink()) {
          failures.push(`${entry.path}: expected symlink`);
        } else if ((await nodeFs.readlink(entryPath)) !== entry.linkTarget) {
          failures.push(`${entry.path}: symlink target mismatch`);
        }
      } else if (entry.kind === 'file') {
        if (!stats.isFile()) {
          failures.push(`${entry.path}: expected file`);
        } else if (stats.size !== entry.size || (await this.hashFile(entryPath)) !== entry.hash) {
          failures.push(`${entry.path}: content hash mismatch`);
        }
      }

      const expectedStorageMode = entry.kind === 'directory' ? 0o700 : 0o600;
      if (entry.kind !== 'symlink' && (Number(stats.mode) & 0o777) !== expectedStorageMode) {
        failures.push(`${entry.path}: insecure backup-storage mode`);
      }
    }

    const storedPaths = await this.listStoredPaths(treeRoot);
    for (const storedPath of storedPaths) {
      if (!expectedPaths.has(storedPath)) failures.push(`${storedPath}: not declared in manifest`);
    }

    return failures;
  }

  private async listStoredPaths(treeRoot: string): Promise<string[]> {
    const paths: string[] = [];
    const walk = async (directoryPath: string): Promise<void> => {
      const entries = await nodeFs.readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(directoryPath, entry.name);
        const relativePath = this.normalizeRelative(path.relative(treeRoot, absolutePath));
        paths.push(relativePath);
        const stats = await nodeFs.lstat(absolutePath);
        if (stats.isDirectory()) await walk(absolutePath);
      }
    };
    await walk(treeRoot);
    paths.sort();
    return paths;
  }

  private async scanProject(): Promise<BackupEntry[]> {
    const entries: BackupEntry[] = [];

    const walk = async (directoryPath: string): Promise<void> => {
      const directoryEntries = await nodeFs.readdir(directoryPath, { withFileTypes: true });
      directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

      for (const directoryEntry of directoryEntries) {
        const absolutePath = path.join(directoryPath, directoryEntry.name);
        const relativePath = this.normalizeRelative(path.relative(this.projectRoot, absolutePath));
        if (this.shouldExclude(relativePath)) continue;

        const stats = await nodeFs.lstat(absolutePath);
        const baseEntry = {
          path: relativePath,
          mode: stats.mode & 0o777,
          size: stats.size,
          mtimeMs: stats.mtimeMs
        };

        if (stats.isSymbolicLink()) {
          const linkTarget = await nodeFs.readlink(absolutePath);
          entries.push({
            ...baseEntry,
            kind: 'symlink',
            linkTarget,
            hash: crypto.createHash('sha256').update(linkTarget).digest('hex')
          });
        } else if (stats.isDirectory()) {
          entries.push({ ...baseEntry, kind: 'directory', size: 0 });
          await walk(absolutePath);
        } else if (stats.isFile()) {
          entries.push({ ...baseEntry, kind: 'file', hash: await this.hashFile(absolutePath) });
        } else {
          throw new Error(`Unsupported filesystem entry in code project: ${relativePath}`);
        }
      }
    };

    await walk(this.projectRoot);
    entries.sort((left, right) => left.path.localeCompare(right.path));
    return entries;
  }

  private compareEntries(before: BackupEntry[], after: BackupEntry[]): BackupChangeSet {
    const beforeMap = new Map(before.map(entry => [entry.path, entry]));
    const afterMap = new Map(after.map(entry => [entry.path, entry]));
    const added = [...afterMap.keys()].filter(relativePath => !beforeMap.has(relativePath));
    const deleted = [...beforeMap.keys()].filter(relativePath => !afterMap.has(relativePath));
    const modified = [...afterMap.keys()].filter(relativePath => {
      const previous = beforeMap.get(relativePath);
      return previous !== undefined && !this.entriesEqual(previous, afterMap.get(relativePath)!);
    });
    const renamed: Array<{ from: string; to: string }> = [];

    const deletedByIdentity = new Map<string, string[]>();
    for (const relativePath of deleted) {
      const deletedEntry = beforeMap.get(relativePath)!;
      if (deletedEntry.kind === 'directory') continue;
      const identity = this.entryIdentity(deletedEntry);
      const candidates = deletedByIdentity.get(identity) ?? [];
      candidates.push(relativePath);
      deletedByIdentity.set(identity, candidates);
    }

    for (const relativePath of added) {
      const addedEntry = afterMap.get(relativePath)!;
      if (addedEntry.kind === 'directory') continue;
      const identity = this.entryIdentity(addedEntry);
      const candidates = deletedByIdentity.get(identity);
      if (candidates?.length === 1) {
        renamed.push({ from: candidates[0], to: relativePath });
        deletedByIdentity.delete(identity);
      }
    }

    const renamedFrom = new Set(renamed.map(rename => rename.from));
    const renamedTo = new Set(renamed.map(rename => rename.to));

    return {
      added: added.filter(relativePath => !renamedTo.has(relativePath)).sort(),
      modified: modified.sort(),
      deleted: deleted.filter(relativePath => !renamedFrom.has(relativePath)).sort(),
      renamed: renamed.sort((left, right) => left.from.localeCompare(right.from))
    };
  }

  private entriesEqual(left: BackupEntry, right: BackupEntry): boolean {
    return left.kind === right.kind
      && left.mode === right.mode
      && left.size === right.size
      && left.hash === right.hash
      && left.linkTarget === right.linkTarget;
  }

  private entryIdentity(entry: BackupEntry): string {
    return `${entry.kind}:${entry.size}:${entry.hash ?? ''}:${entry.linkTarget ?? ''}`;
  }

  private calculateTreeHash(entries: BackupEntry[]): string {
    const stableEntries = entries.map(entry => ({
      path: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      size: entry.size,
      hash: entry.hash,
      linkTarget: entry.linkTarget
    }));
    return crypto.createHash('sha256').update(JSON.stringify(stableEntries)).digest('hex');
  }

  private async hashFile(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private shouldExclude(relativePath: string): boolean {
    const normalized = this.normalizeRelative(relativePath);
    const segments = normalized.split('/');
    if (segments.some(segment => this.excludedNames.has(segment))) return true;

    const baseName = segments[segments.length - 1];
    if (baseName.startsWith('.env')) return true;
    if (/\.(log|tmp|temp|pyc)$/.test(baseName)) return true;

    if (this.storageRoot && this.isPathWithin(this.projectRootReal, this.storageRoot)) {
      const storageRelative = this.normalizeRelative(path.relative(this.projectRootReal, this.storageRoot));
      if (normalized === storageRelative || normalized.startsWith(`${storageRelative}/`)) return true;
    }

    return false;
  }

  private applyRetention(index: BackupIndex, preserveSnapshotIds = new Set<string>()): string[] {
    const expired: string[] = [];
    while (index.snapshots.length > index.settings.maxBackups) {
      const candidateIndex = index.snapshots.findIndex(
        snapshot => !snapshot.tags.includes('protected') && !preserveSnapshotIds.has(snapshot.id)
      );
      if (candidateIndex < 0) break;
      const [candidate] = index.snapshots.splice(candidateIndex, 1);
      expired.push(candidate.id);
    }
    return expired;
  }

  private toSummary(manifest: BackupManifest): BackupSummary {
    return {
      id: manifest.id,
      createdAt: manifest.createdAt,
      name: manifest.name,
      prompt: manifest.prompt,
      tags: manifest.tags,
      trigger: manifest.trigger,
      storageMode: manifest.storageMode,
      parentSnapshotId: manifest.parentSnapshotId,
      status: manifest.status,
      treeHash: manifest.evidence.treeHash,
      totalFiles: manifest.evidence.totalFiles,
      logicalBytes: manifest.evidence.logicalBytes,
      storedBytes: manifest.evidence.storedBytes,
      changeCounts: this.changeCounts(manifest.changes)
    };
  }

  private changeCounts(changes: BackupChangeSet): BackupSummary['changeCounts'] {
    return {
      added: changes.added.length,
      modified: changes.modified.length,
      deleted: changes.deleted.length,
      renamed: changes.renamed.length
    };
  }

  private async readManifest(snapshotId: string): Promise<BackupManifest> {
    this.assertIdentifier(snapshotId, 'snapshot ID');
    const manifest = await this.readJson<BackupManifest>(
      path.join(this.snapshotsRoot, snapshotId, 'manifest.json')
    );
    if (
      !manifest
      || manifest.schemaVersion !== SCHEMA_VERSION
      || manifest.status !== 'verified'
      || manifest.id !== snapshotId
      || !Array.isArray(manifest.entries)
      || !manifest.evidence
      || manifest.evidence.hashAlgorithm !== 'sha256'
    ) {
      throw new Error(`Unsupported or unverified backup manifest: ${snapshotId}`);
    }
    if (manifest.projectRoot !== this.projectRootReal) {
      throw new Error(`Backup belongs to a different project: ${snapshotId}`);
    }
    let previousPath = '';
    for (const entry of manifest.entries) {
      if (
        !entry
        || typeof entry.path !== 'string'
        || entry.path.length === 0
        || entry.path !== this.normalizeRelative(entry.path)
        || entry.path.includes('//')
        || entry.path <= previousPath
        || !['directory', 'file', 'symlink'].includes(entry.kind)
        || !Number.isInteger(entry.mode)
        || entry.mode < 0
        || entry.mode > 0o777
        || !Number.isFinite(entry.size)
        || entry.size < 0
        || !Number.isFinite(entry.mtimeMs)
      ) {
        throw new Error(`Backup manifest contains an invalid entry: ${snapshotId}`);
      }
      this.safeJoin(this.projectRoot, entry.path);
      if (entry.kind === 'file' && !/^[a-f0-9]{64}$/.test(entry.hash ?? '')) {
        throw new Error(`Backup manifest contains an invalid file hash: ${entry.path}`);
      }
      if (entry.kind === 'symlink' && typeof entry.linkTarget !== 'string') {
        throw new Error(`Backup manifest contains an invalid symlink: ${entry.path}`);
      }
      previousPath = entry.path;
    }
    if (this.calculateTreeHash(manifest.entries) !== manifest.evidence.treeHash) {
      throw new Error(`Backup manifest tree hash is invalid: ${snapshotId}`);
    }
    return manifest;
  }

  private async readIndex(): Promise<BackupIndex> {
    const index = await this.readJson<BackupIndex>(this.indexPath);
    if (
      !index
      || index.schemaVersion !== SCHEMA_VERSION
      || !Array.isArray(index.snapshots)
      || !index.settings
      || !Number.isInteger(index.settings.maxBackups)
      || index.settings.maxBackups < 2
    ) {
      throw new Error('Unsupported or invalid backup index');
    }
    if (index.projectRoot !== this.projectRootReal) {
      throw new Error('Backup index belongs to a different project root');
    }
    const identifiers = new Set<string>();
    for (const snapshot of index.snapshots) {
      if (
        !snapshot
        || !this.isIdentifier(snapshot.id)
        || identifiers.has(snapshot.id)
        || snapshot.status !== 'verified'
        || !/^[a-f0-9]{64}$/.test(snapshot.treeHash)
        || !Number.isFinite(snapshot.createdAt)
      ) {
        throw new Error('Backup index contains an invalid snapshot entry');
      }
      identifiers.add(snapshot.id);
    }
    return index;
  }

  private createEmptyIndex(): BackupIndex {
    const now = Date.now();
    return {
      schemaVersion: SCHEMA_VERSION,
      projectRoot: this.projectRootReal,
      createdAt: now,
      updatedAt: now,
      snapshots: [],
      settings: {
        maxBackups: this.maxBackups
      }
    };
  }

  private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    await fs.ensureDir(path.dirname(filePath));
    const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    let handle: Awaited<ReturnType<typeof nodeFs.open>> | undefined;
    try {
      handle = await nodeFs.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await nodeFs.rename(temporaryPath, filePath);
      await this.syncDirectory(path.dirname(filePath));
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.remove(temporaryPath);
      throw error;
    }
  }

  private async readJson<T>(filePath: string): Promise<T> {
    const content = await nodeFs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    return await this.withFileLockAt(this.lockPath, operation);
  }

  private async withOperationLocks<T>(operation: () => Promise<T>): Promise<T> {
    return await this.withFileLockAt(
      this.projectLockPath,
      async () => await this.withFileLockAt(this.lockPath, operation)
    );
  }

  private async withFileLockAt<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireFileLock(lockPath);
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async acquireFileLock(lockPath: string): Promise<() => Promise<void>> {
    const token = crypto.randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;

    while (Date.now() < deadline) {
      try {
        const handle = await nodeFs.open(lockPath, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({
          token,
          pid: process.pid,
          createdAt: Date.now()
        }));
        await handle.sync();
        await handle.close();
        const heartbeat = setInterval(() => {
          void this.refreshLock(lockPath, token);
        }, LOCK_HEARTBEAT_MS);
        heartbeat.unref();
        return async () => {
          clearInterval(heartbeat);
          try {
            const lock = await this.readJson<{ token: string }>(lockPath);
            if (lock.token === token) await nodeFs.unlink(lockPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              console.error('Failed to release backup lock:', error);
            }
          }
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw error;

        try {
          const stats = await nodeFs.stat(lockPath);
          if (Date.now() - stats.mtimeMs > LOCK_STALE_MS && !(await this.lockOwnerIsAlive(lockPath))) {
            await nodeFs.unlink(lockPath);
            continue;
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw statError;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    throw new Error('Timed out waiting for another backup operation to finish');
  }

  private async refreshLock(lockPath: string, token: string): Promise<void> {
    try {
      const lock = await this.readJson<{ token: string }>(lockPath);
      if (lock.token !== token) return;
      const now = new Date();
      await nodeFs.utimes(lockPath, now, now);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to refresh backup lock heartbeat:', error);
      }
    }
  }

  private async lockOwnerIsAlive(lockPath: string): Promise<boolean> {
    try {
      const lock = await this.readJson<{ pid?: unknown }>(lockPath);
      if (!Number.isInteger(lock.pid) || (lock.pid as number) <= 0) return false;
      try {
        process.kill(lock.pid as number, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    } catch {
      return false;
    }
  }

  private async recoverStorage(): Promise<StorageRecoveryReport> {
    const report: StorageRecoveryReport = {
      checkedAt: Date.now(),
      rebuiltIndex: false,
      removedPartialSnapshots: 0,
      removedExpiredRestoreTokens: 0,
      rolledBackInterruptedDeletes: 0,
      completedInterruptedDeletes: 0,
      recoveredSnapshots: [],
      warnings: []
    };
    const index = await this.readIndex();
    if (this.requestedMaxBackups === undefined) {
      this.maxBackups = Math.max(2, index.settings.maxBackups);
    } else if (index.settings.maxBackups !== this.maxBackups) {
      index.settings.maxBackups = this.maxBackups;
    }

    const pendingTokens = await nodeFs.readdir(this.pendingRoot, { withFileTypes: true });
    for (const entry of pendingTokens) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const pendingPath = path.join(this.pendingRoot, entry.name);
      try {
        const pending = await this.readJson<PendingRestore>(pendingPath);
        if (pending.expiresAt < Date.now()) {
          await fs.remove(pendingPath);
          await this.syncDirectory(this.pendingRoot);
          report.removedExpiredRestoreTokens++;
        }
      } catch (error) {
        report.warnings.push(`Could not inspect pending restore ${entry.name}: ${this.errorMessage(error)}`);
      }
    }

    const snapshotDirectories = await nodeFs.readdir(this.snapshotsRoot, { withFileTypes: true });
    const indexed = new Set(index.snapshots.map(snapshot => snapshot.id));
    for (const entry of snapshotDirectories) {
      if (!entry.isDirectory() || !entry.name.startsWith('.deleting-')) continue;
      const snapshotId = entry.name.slice('.deleting-'.length);
      if (!this.isIdentifier(snapshotId)) {
        report.warnings.push(`Unrecognized interrupted-delete directory: ${entry.name}`);
        continue;
      }
      const deletingRoot = path.join(this.snapshotsRoot, entry.name);
      const snapshotRoot = path.join(this.snapshotsRoot, snapshotId);
      if (indexed.has(snapshotId)) {
        if (await fs.pathExists(snapshotRoot)) {
          report.warnings.push(`Cannot roll back interrupted delete because ${snapshotId} already exists`);
          continue;
        }
        await nodeFs.rename(deletingRoot, snapshotRoot);
        report.rolledBackInterruptedDeletes++;
      } else {
        await fs.remove(deletingRoot);
        report.completedInterruptedDeletes++;
      }
    }

    for (const entry of snapshotDirectories) {
      if (entry.isDirectory() && entry.name.startsWith('.partial-')) {
        await fs.remove(path.join(this.snapshotsRoot, entry.name));
        report.removedPartialSnapshots++;
      }
    }

    for (const entry of snapshotDirectories) {
      if (!entry.isDirectory() || !this.isIdentifier(entry.name) || indexed.has(entry.name)) {
        continue;
      }
      try {
        const manifest = await this.readManifest(entry.name);
        const failures = await this.verifyManifestFiles(manifest);
        if (failures.length > 0) {
          report.warnings.push(`Unindexed backup ${entry.name} failed verification`);
          continue;
        }
        index.snapshots.push(this.toSummary(manifest));
        report.recoveredSnapshots.push(entry.name);
      } catch (error) {
        report.warnings.push(`Could not recover unindexed backup ${entry.name}: ${this.errorMessage(error)}`);
      }
    }

    for (const snapshot of index.snapshots) {
      if (!(await fs.pathExists(path.join(this.snapshotsRoot, snapshot.id, 'manifest.json')))) {
        report.warnings.push(`Indexed backup is missing from storage: ${snapshot.id}`);
      }
    }

    index.snapshots.sort((left, right) => left.createdAt - right.createdAt);
    index.updatedAt = Date.now();
    const expired = this.applyRetention(index);
    await this.atomicWriteJson(this.indexPath, index);
    for (const expiredId of expired) {
      await fs.remove(path.join(this.snapshotsRoot, expiredId));
    }

    if (await fs.pathExists(this.recoveryPath)) {
      const journal = await this.readJson<RestoreRecoveryJournal>(this.recoveryPath);
      if (journal.schemaVersion !== SCHEMA_VERSION || journal.projectRoot !== this.projectRootReal) {
        throw new Error('Restore recovery journal does not belong to this project');
      }
      await this.rollbackToSnapshot(journal.preRestoreSnapshotId);
      await this.removeRecoveryJournal();
      report.interruptedRestore = {
        snapshotId: journal.snapshotId,
        preRestoreSnapshotId: journal.preRestoreSnapshotId,
        recoveredAt: Date.now()
      };
    }

    return report;
  }

  private async rollbackToSnapshot(snapshotId: string): Promise<void> {
    const rollbackManifest = await this.readManifest(snapshotId);
    const failures = await this.verifyManifestFiles(rollbackManifest);
    if (failures.length > 0) {
      throw new Error(`Safety backup failed verification for ${failures.length} entries`);
    }
    await this.applyManifest(rollbackManifest, 'exact');
    const rollbackEntries = await this.scanProject();
    const verification = this.verifyRestoredState(
      rollbackEntries,
      rollbackManifest.entries,
      'exact'
    );
    if (!verification.success) throw new Error(verification.error);
  }

  private async syncDirectory(directoryPath: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof nodeFs.open>> | undefined;
    try {
      handle = await nodeFs.open(directoryPath, 'r');
      await handle.sync();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EISDIR' && code !== 'EPERM') throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async syncFile(filePath: string): Promise<void> {
    const handle = await nodeFs.open(filePath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async removeRecoveryJournal(): Promise<void> {
    await fs.remove(this.recoveryPath);
    await this.syncDirectory(this.storageRoot);
  }

  private async readGitEvidence(): Promise<BackupManifest['git']> {
    const gitMarker = path.join(this.projectRoot, '.git');
    if (!(await fs.pathExists(gitMarker))) return undefined;

    try {
      const markerStats = await nodeFs.lstat(gitMarker);
      let gitDirectory = gitMarker;
      if (markerStats.isFile()) {
        const marker = (await nodeFs.readFile(gitMarker, 'utf8')).trim();
        if (!marker.startsWith('gitdir: ')) return undefined;
        gitDirectory = path.resolve(this.projectRoot, marker.slice('gitdir: '.length));
      }
      let refsDirectory = gitDirectory;
      try {
        const commonDirectory = (await nodeFs.readFile(path.join(gitDirectory, 'commondir'), 'utf8')).trim();
        refsDirectory = path.resolve(gitDirectory, commonDirectory);
      } catch {
        refsDirectory = gitDirectory;
      }
      const head = (await nodeFs.readFile(path.join(gitDirectory, 'HEAD'), 'utf8')).trim();
      if (head.startsWith('ref: ')) {
        const reference = head.slice(5);
        const branch = reference.replace(/^refs\/heads\//, '');
        let commit: string | undefined;
        try {
          const looseReference = await nodeFs.readFile(path.join(refsDirectory, reference), 'utf8');
          commit = looseReference.trim().slice(0, 12);
        } catch {
          try {
            const packedRefs = await nodeFs.readFile(path.join(refsDirectory, 'packed-refs'), 'utf8');
            const packedReference = packedRefs
              .split('\n')
              .find(line => !line.startsWith('#') && line.endsWith(` ${reference}`));
            commit = packedReference?.split(' ')[0].slice(0, 12);
          } catch {
            commit = undefined;
          }
        }
        return { branch, commit };
      }
      return { commit: head.slice(0, 12) };
    } catch {
      return undefined;
    }
  }

  private safeJoin(root: string, relativePath: string): string {
    const normalized = this.normalizeRelative(relativePath);
    if (!normalized || path.isAbsolute(normalized) || this.isOutside(normalized)) {
      throw new Error(`Unsafe relative path: ${relativePath}`);
    }
    const resolved = path.resolve(root, normalized);
    if (!this.isPathWithin(path.resolve(root), resolved)) {
      throw new Error(`Path escapes backup root: ${relativePath}`);
    }
    return resolved;
  }

  private isPathWithin(root: string, candidate: string): boolean {
    const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
    return relativePath === '' || (!this.isOutside(relativePath) && !path.isAbsolute(relativePath));
  }

  private isOutside(relativePath: string): boolean {
    return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || relativePath.startsWith('../');
  }

  private normalizeRelative(relativePath: string): string {
    return relativePath.split(path.sep).join('/').replace(/^\.\//, '');
  }

  private depth(relativePath: string): number {
    return this.normalizeRelative(relativePath).split('/').length;
  }

  private async lstatIfExists(filePath: string): Promise<Awaited<ReturnType<typeof nodeFs.lstat>> | undefined> {
    try {
      return await nodeFs.lstat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private assertIdentifier(value: string, label: string): void {
    if (!this.isIdentifier(value)) {
      throw new Error(`Invalid ${label}`);
    }
  }

  private isIdentifier(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Backup manager is not initialized');
  }

  private defaultBackupName(createdAt: number, trigger: BackupTrigger): string {
    return `${trigger} checkpoint ${new Date(createdAt).toISOString()}`;
  }

  private extractSnapshotId(response: BackupResponse): string | undefined {
    const snapshot = response.data?.snapshot;
    if (!snapshot || typeof snapshot !== 'object') return undefined;
    const id = (snapshot as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }

  private failure(message: string, error: unknown): BackupResponse {
    return {
      success: false,
      message,
      error: this.errorMessage(error)
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
