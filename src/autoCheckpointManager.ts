import { FSWatcher, watch } from 'chokidar';
import path from 'path';
import {
  BackupManager,
  BackupResponse,
  BackupTrigger
} from './backupManager.js';

export type AutoCheckpointState = 'running' | 'paused' | 'degraded' | 'stopped';

export interface AutoCheckpointOptions {
  debounceMs?: number;
  reconciliationIntervalMs?: number;
  onCheckpoint?: (response: BackupResponse, trigger: BackupTrigger) => void | Promise<void>;
}

export interface AutoCheckpointStatus {
  state: AutoCheckpointState;
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

export class AutoCheckpointManager {
  private readonly backupManager: BackupManager;
  private readonly debounceMs: number;
  private readonly reconciliationIntervalMs: number;
  private readonly onCheckpoint?: AutoCheckpointOptions['onCheckpoint'];
  private watcher?: FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private reconciliationTimer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private pendingPaths = new Set<string>();
  private reconciliationPending = false;
  private paused = false;
  private stopped = true;
  private watcherReady = false;
  private startedAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastCheckpointAt: number | null = null;
  private lastCheckpointResult: AutoCheckpointStatus['lastCheckpointResult'] = null;
  private watcherError?: string;
  private checkpointError?: string;

  constructor(backupManager: BackupManager, options: AutoCheckpointOptions = {}) {
    this.backupManager = backupManager;
    this.debounceMs = Math.max(100, options.debounceMs ?? 1500);
    this.reconciliationIntervalMs = Math.max(
      this.debounceMs,
      options.reconciliationIntervalMs ?? 60_000
    );
    this.onCheckpoint = options.onCheckpoint;
  }

  async start(): Promise<void> {
    if (!this.stopped) return;

    this.stopped = false;
    this.paused = false;
    this.watcherReady = false;
    this.watcherError = undefined;
    this.checkpointError = undefined;
    this.clearPending();
    this.startedAt = Date.now();
    this.lastEventAt = null;
    this.lastCheckpointAt = null;
    this.lastCheckpointResult = null;
    const projectRoot = this.backupManager.getProjectRoot();

    const watcher = watch(projectRoot, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: Math.min(this.debounceMs, 1000),
        pollInterval: 100
      },
      ignored: candidatePath => this.backupManager.isPathIgnored(path.resolve(candidatePath))
    });
    this.watcher = watcher;

    watcher.on('all', (_eventName, changedPath) => {
      this.handleChange(path.resolve(changedPath));
    });
    watcher.on('error', error => {
      this.watcherError = this.errorMessage(error);
      console.error('Automatic checkpoint watcher degraded:', this.watcherError);
    });

    await new Promise<void>(resolve => {
      let settled = false;
      let readinessTimer: NodeJS.Timeout | undefined;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (readinessTimer) clearTimeout(readinessTimer);
        resolve();
      };
      watcher.once('ready', () => {
        this.watcherReady = true;
        this.watcherError = undefined;
        settle();
      });
      watcher.once('error', settle);
      readinessTimer = setTimeout(() => {
        this.watcherError = 'Filesystem watcher did not become ready within 10 seconds';
        settle();
      }, 10_000);
    });

    this.reconciliationTimer = setInterval(() => {
      this.requestReconciliation();
    }, this.reconciliationIntervalMs);
    this.reconciliationTimer.unref();
  }

  async pause(discardPending = true): Promise<void> {
    if (this.stopped) return;
    this.paused = true;
    this.clearDebounceTimer();
    if (discardPending) this.clearPending();
    await this.inFlight;
    if (discardPending) this.clearPending();
  }

  resume(discardPending = true): void {
    if (this.stopped) throw new Error('Automatic checkpoint watcher is stopped');
    if (discardPending) this.clearPending();
    this.paused = false;
    if (this.pendingPaths.size > 0 || this.reconciliationPending) this.scheduleCheckpoint();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.paused = false;
    this.clearDebounceTimer();
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = undefined;
    }
    this.clearPending();
    await this.inFlight;
    await this.watcher?.close();
    this.watcher = undefined;
    this.watcherReady = false;
  }

  getStatus(): AutoCheckpointStatus {
    const lastError = this.checkpointError ?? this.watcherError ?? null;
    let state: AutoCheckpointState = 'running';
    if (this.stopped) state = 'stopped';
    else if (this.paused) state = 'paused';
    else if (lastError) state = 'degraded';

    return {
      state,
      watcherReady: this.watcherReady,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      lastCheckpointAt: this.lastCheckpointAt,
      lastCheckpointResult: this.lastCheckpointResult,
      pendingChangeCount: this.pendingPaths.size + (this.reconciliationPending ? 1 : 0),
      backupInProgress: this.inFlight !== undefined,
      debounceMs: this.debounceMs,
      reconciliationIntervalMs: this.reconciliationIntervalMs,
      lastError
    };
  }

  private handleChange(changedPath: string): void {
    if (this.stopped || this.paused || this.backupManager.isPathIgnored(changedPath)) return;
    const relativePath = path.relative(this.backupManager.getProjectRoot(), changedPath) || '.';
    this.pendingPaths.add(relativePath);
    this.lastEventAt = Date.now();
    this.scheduleCheckpoint();
  }

  private requestReconciliation(): void {
    if (this.stopped || this.paused) return;
    this.reconciliationPending = true;
    this.scheduleCheckpoint();
  }

  private scheduleCheckpoint(): void {
    if (this.stopped || this.paused || this.inFlight) return;
    this.clearDebounceTimer();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.flushPending();
    }, this.debounceMs);
    this.debounceTimer.unref();
  }

  private async flushPending(): Promise<void> {
    if (this.stopped || this.paused || this.inFlight) return;
    if (this.pendingPaths.size === 0 && !this.reconciliationPending) return;

    const trigger: BackupTrigger = this.pendingPaths.size > 0 ? 'automatic' : 'reconciliation';
    this.clearPending();
    const operation = this.performCheckpoint(trigger);
    this.inFlight = operation;

    try {
      await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = undefined;
      if (!this.stopped && !this.paused && (this.pendingPaths.size > 0 || this.reconciliationPending)) {
        this.scheduleCheckpoint();
      }
    }
  }

  private async performCheckpoint(trigger: BackupTrigger): Promise<void> {
    let response: BackupResponse;
    try {
      response = await this.backupManager.createBackup({
        name: `${trigger} checkpoint ${new Date().toISOString()}`,
        prompt: trigger === 'automatic'
          ? 'Automatic checkpoint after filesystem changes'
          : 'Periodic reconciliation checkpoint',
        tags: [trigger],
        trigger,
        skipIfUnchanged: true
      });
      this.lastCheckpointAt = Date.now();
      if (response.success) {
        const skipped = response.data?.skipped === true;
        this.lastCheckpointResult = skipped ? 'skipped' : 'created';
        this.checkpointError = undefined;
      } else {
        this.lastCheckpointResult = 'failed';
        this.checkpointError = response.error ?? response.message;
      }
    } catch (error) {
      response = {
        success: false,
        message: 'Automatic checkpoint failed',
        error: this.errorMessage(error)
      };
      this.lastCheckpointAt = Date.now();
      this.lastCheckpointResult = 'failed';
      this.checkpointError = response.error;
    }

    if (!response.success) {
      console.error('Automatic checkpoint degraded:', response.error ?? response.message);
    }
    try {
      await this.onCheckpoint?.(response, trigger);
    } catch (error) {
      console.error('Automatic checkpoint observer failed:', this.errorMessage(error));
    }
  }

  private clearPending(): void {
    this.pendingPaths.clear();
    this.reconciliationPending = false;
  }

  private clearDebounceTimer(): void {
    if (!this.debounceTimer) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
