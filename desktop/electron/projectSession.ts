import path from 'node:path';
import * as z from 'zod/v4';
import { AutoCheckpointManager } from '../../src/autoCheckpointManager.js';
import { BackupManager, type BackupResponse } from '../../src/backupManager.js';
import type {
  AutomaticCheckpointStatus,
  BackupStatusView,
  DesktopResult,
  ProjectDashboard,
  ProjectRegistrationInput,
  ProjectSummary,
  RecoveryView,
  RestoreOutcome,
  RestorePreview,
  SnapshotSummary,
  StorageRecoveryReport,
  VerificationOutcome
} from '../shared/contracts.js';
import { OperationScheduler } from './operationScheduler.js';
import { SerenaProcessManager } from './serenaManager.js';

const snapshotIdSchema = z.string().uuid();
const createSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(200).optional()
}).strict();
const previewRestoreSchema = z.object({
  snapshotId: snapshotIdSchema,
  mode: z.enum(['exact', 'overlay'])
}).strict();
const restoreSnapshotSchema = z.object({
  snapshotId: snapshotIdSchema,
  confirmationToken: z.string().uuid()
}).strict();

interface RestoreRecord {
  response: DesktopResult<RestoreOutcome>;
  snapshotId: string;
  occurredAt: number;
}

interface PreviewRecord {
  snapshotId: string;
  occurredAt: number;
}

export interface ProjectSessionOptions {
  id: string;
  registeredAt: number;
  config: ProjectRegistrationInput;
  scheduler: OperationScheduler;
  serenaCommandPath?: string | null;
  serenaStartupTimeoutMs?: number;
  onChange?: (reason: 'checkpoint' | 'serena' | 'restore') => void;
}

export class ProjectSession {
  readonly id: string;
  readonly registeredAt: number;
  readonly root: string;
  readonly name: string;
  private readonly config: ProjectRegistrationInput;
  private readonly scheduler: OperationScheduler;
  private readonly onChange?: ProjectSessionOptions['onChange'];
  private readonly serena: SerenaProcessManager;
  private manager?: BackupManager;
  private watcher?: AutoCheckpointManager;
  private protectionState: ProjectSummary['protectionState'] = 'stopped';
  private activatedAt: number | null = null;
  private lastError: string | null = null;
  private status: BackupStatusView | null = null;
  private snapshots: SnapshotSummary[] = [];
  private operationTail: Promise<void> = Promise.resolve();
  private restoreRecord?: RestoreRecord;
  private previewRecord?: PreviewRecord;

  constructor(options: ProjectSessionOptions) {
    this.id = options.id;
    this.registeredAt = options.registeredAt;
    this.config = { ...options.config };
    this.root = path.resolve(options.config.projectPath);
    this.name = path.basename(this.root);
    this.scheduler = options.scheduler;
    this.onChange = options.onChange;
    this.serena = new SerenaProcessManager({
      projectRoot: this.root,
      enabled: this.config.serenaEnabled,
      autoConfigure: this.config.serenaAutoConfigure,
      commandPath: options.serenaCommandPath,
      startupTimeoutMs: options.serenaStartupTimeoutMs,
      onChange: () => this.onChange?.('serena')
    });
  }

  async start(): Promise<DesktopResult> {
    return await this.serialize(async () => {
      if (this.manager) {
        return { success: true, message: '工程保护已经在运行', data: this.getSummary() };
      }

      this.protectionState = 'starting';
      this.lastError = null;
      try {
        const manager = new BackupManager();
        await this.scheduler.schedule(async () => {
          await manager.initialize(this.root, {
            storageRoot: this.config.storageRoot,
            maxBackups: this.config.maxBackups
          });
          const baseline = await manager.createBackup({
            name: `Desktop activation ${new Date().toISOString()}`,
            prompt: 'Verified baseline created by CodeRecoder Desktop',
            tags: ['activation', 'desktop'],
            trigger: 'activation',
            skipIfUnchanged: true
          });
          if (!baseline.success) {
            throw new Error(baseline.error ?? baseline.message);
          }
        });
        this.manager = manager;
        this.activatedAt = Date.now();

        let watcherError: string | null = null;
        if (this.config.autoCheckpoint) {
          const watcher = new AutoCheckpointManager(manager, {
            onCheckpoint: response => {
              if (!response.success) {
                console.error(`[${this.id}] automatic checkpoint failed:`, response.error ?? response.message);
              }
              this.onChange?.('checkpoint');
            }
          });
          try {
            await watcher.start();
            this.watcher = watcher;
            const watcherStatus = watcher.getStatus();
            if (watcherStatus.state === 'degraded') watcherError = watcherStatus.lastError;
          } catch (error) {
            watcherError = this.errorMessage(error);
            await watcher.stop().catch(() => undefined);
          }
        }

        this.protectionState = watcherError ? 'degraded' : 'running';
        this.lastError = watcherError;
        const cacheError = await this.refreshCacheSafely('initial dashboard refresh');
        if (cacheError) {
          this.protectionState = 'degraded';
          this.lastError = watcherError ?? cacheError;
        }

        // Serena is an optional sidecar. Its failure never changes backup health.
        const serenaStatus = await this.scheduler.schedule(async () => await this.serena.start());
        return {
          success: true,
          message: this.protectionState === 'degraded'
            ? '工程基线已验证，但状态刷新或自动检查点处于降级状态'
            : serenaStatus.state === 'degraded'
              ? '工程保护已启动；Serena 未就绪，可在设置中重试'
              : serenaStatus.state === 'disabled'
                ? '工程保护已启动'
                : '工程保护与 Serena 会话已启动',
          data: this.getSummary()
        };
      } catch (error) {
        await this.watcher?.stop().catch(() => undefined);
        this.watcher = undefined;
        this.manager = undefined;
        this.protectionState = 'stopped';
        this.lastError = this.errorMessage(error);
        return this.failure('启动工程保护失败', error);
      }
    });
  }

  async stop(createFinalCheckpoint = true): Promise<DesktopResult> {
    return await this.serialize(async () => await this.stopInternal(createFinalCheckpoint));
  }

  async shutdown(): Promise<void> {
    await this.serialize(async () => {
      const result = await this.stopInternal(true);
      if (!result.success) {
        console.error(`[${this.id}] shutdown checkpoint failed:`, result.error ?? result.message);
      }
    });
  }

  async dashboard(refresh = true): Promise<ProjectDashboard> {
    return await this.serialize(async () => {
      if (refresh && this.manager) {
        try {
          await this.refreshCache();
        } catch (error) {
          this.lastError = this.errorMessage(error);
          this.protectionState = 'degraded';
        }
      }
      return this.buildDashboard();
    });
  }

  async createSnapshot(rawInput: unknown): Promise<DesktopResult> {
    return await this.serialize(async () => {
      const manager = this.requireManager();
      if (!manager.success) return manager.response;
      try {
        const input = createSnapshotSchema.parse(rawInput);
        const response = await this.scheduler.schedule(async () => await manager.value.createBackup({
          name: input.name ?? `Manual backup ${new Date().toISOString()}`,
          prompt: 'Manual backup created from CodeRecoder Desktop',
          tags: ['manual', 'desktop'],
          trigger: 'manual',
          skipIfUnchanged: false
        }));
        await this.refreshCacheSafely('manual snapshot refresh');
        this.onChange?.('checkpoint');
        return response;
      } catch (error) {
        return this.failure('创建备份失败', error);
      }
    });
  }

  async verifySnapshot(rawSnapshotId: unknown): Promise<DesktopResult<VerificationOutcome>> {
    return await this.serialize(async () => {
      const manager = this.requireManager();
      if (!manager.success) return manager.response;
      try {
        const snapshotId = snapshotIdSchema.parse(rawSnapshotId);
        return await this.scheduler.schedule(
          async () => await manager.value.verifyBackup(snapshotId)
        ) as DesktopResult<VerificationOutcome>;
      } catch (error) {
        return this.failure('验证备份失败', error);
      }
    });
  }

  async previewRestore(rawInput: unknown): Promise<DesktopResult<RestorePreview>> {
    return await this.serialize(async () => {
      const manager = this.requireManager();
      if (!manager.success) return manager.response;
      try {
        const input = previewRestoreSchema.parse(rawInput);
        const response = await this.scheduler.schedule(
          async () => await manager.value.previewRestore(input.snapshotId, input.mode)
        );
        if (response.success) {
          this.previewRecord = { snapshotId: input.snapshotId, occurredAt: Date.now() };
          this.onChange?.('restore');
        }
        return response as DesktopResult<RestorePreview>;
      } catch (error) {
        return this.failure('生成恢复预览失败', error);
      }
    });
  }

  async restoreSnapshot(rawInput: unknown): Promise<DesktopResult<RestoreOutcome>> {
    return await this.serialize(async () => {
      const manager = this.requireManager();
      if (!manager.success) return manager.response;
      let watcherPaused = false;
      try {
        const input = restoreSnapshotSchema.parse(rawInput);
        await this.watcher?.pause(true);
        watcherPaused = this.watcher !== undefined;
        const rawResponse = await this.scheduler.schedule(
          async () => await manager.value.restoreBackup(input.snapshotId, input.confirmationToken)
        );
        const response = rawResponse as DesktopResult<RestoreOutcome>;
        this.restoreRecord = {
          response,
          snapshotId: input.snapshotId,
          occurredAt: Date.now()
        };
        this.previewRecord = undefined;
        await this.refreshCacheSafely('restore result refresh');
        this.onChange?.('restore');
        return response;
      } catch (error) {
        const response = this.failure<RestoreOutcome>('协调恢复操作失败', error);
        this.restoreRecord = {
          response,
          snapshotId: this.snapshotIdFromUnknown(rawInput),
          occurredAt: Date.now()
        };
        this.previewRecord = undefined;
        this.onChange?.('restore');
        return response;
      } finally {
        if (watcherPaused) {
          try {
            this.watcher?.resume(true);
          } catch (error) {
            console.error(`[${this.id}] failed to resume automatic checkpoints:`, this.errorMessage(error));
          }
        }
      }
    });
  }

  async restartSerena(): Promise<DesktopResult> {
    const status = await this.serena.restart();
    return status.state === 'ready'
      ? { success: true, message: 'Serena 已通过 MCP initialize 握手', data: status }
      : { success: false, message: 'Serena 未能就绪', error: status.lastError ?? '未知错误', data: status };
  }

  getSummary(): ProjectSummary {
    const automaticCheckpoint = this.watcher
      ? this.watcher.getStatus() as AutomaticCheckpointStatus
      : this.inactiveAutomaticStatus();
    let currentProtectionState = this.protectionState;
    if (this.manager && automaticCheckpoint.state === 'degraded') currentProtectionState = 'degraded';
    return {
      id: this.id,
      name: this.name,
      root: this.root,
      storageRoot: this.status?.storageRoot ?? this.config.storageRoot ?? path.join(this.root, '.CodeRecoder', 'backups'),
      registeredAt: this.registeredAt,
      activatedAt: this.activatedAt,
      startOnLaunch: this.config.startOnLaunch,
      protectionState: currentProtectionState,
      snapshotCount: this.status?.snapshotCount ?? this.snapshots.length,
      latestSnapshotAt: this.status?.latestSnapshot?.createdAt ?? this.snapshots[0]?.createdAt ?? null,
      hasUncheckpointedChanges: this.status?.hasUncheckpointedChanges ?? null,
      automaticCheckpoint,
      serena: this.serena.getStatus(),
      lastError: automaticCheckpoint.lastError ?? this.lastError
    };
  }

  getRegistration(): ProjectRegistrationInput {
    return { ...this.config };
  }

  setStartOnLaunch(value: boolean): void {
    this.config.startOnLaunch = value;
  }

  private async stopInternal(createFinalCheckpoint: boolean): Promise<DesktopResult> {
    const manager = this.manager;
    if (!manager) {
      await this.serena.stop();
      this.protectionState = 'stopped';
      this.activatedAt = null;
      return { success: true, message: '工程保护已经停止', data: this.getSummary() };
    }

    let finalCheckpoint: BackupResponse | undefined;
    try {
      await this.watcher?.pause(true);
      if (createFinalCheckpoint) {
        finalCheckpoint = await this.scheduler.schedule(async () => await manager.createBackup({
          name: `Desktop shutdown ${new Date().toISOString()}`,
          prompt: 'Final verified checkpoint before CodeRecoder Desktop stopped monitoring',
          tags: ['deactivation', 'desktop'],
          trigger: 'manual',
          skipIfUnchanged: true
        }));
      }
      await this.refreshCacheSafely('final checkpoint refresh');
      await this.watcher?.stop();
      await this.serena.stop();
      this.watcher = undefined;
      this.manager = undefined;
      this.protectionState = 'stopped';
      this.activatedAt = null;
      if (finalCheckpoint && !finalCheckpoint.success) {
        this.lastError = finalCheckpoint.error ?? finalCheckpoint.message;
        return this.failure('工程已停止，但最终检查点创建失败', this.lastError);
      }
      this.lastError = null;
      return { success: true, message: '工程监控已安全停止', data: this.getSummary() };
    } catch (error) {
      await this.watcher?.stop().catch(() => undefined);
      await this.serena.stop().catch(() => undefined);
      this.watcher = undefined;
      this.manager = undefined;
      this.protectionState = 'stopped';
      this.activatedAt = null;
      this.lastError = this.errorMessage(error);
      return this.failure('停用工程时发生错误', error);
    }
  }

  private async refreshCache(): Promise<void> {
    const manager = this.manager;
    if (!manager) return;
    const [statusResponse, listResponse] = await this.scheduler.schedule(async () => await Promise.all([
      manager.getStatus(),
      manager.listBackups(200)
    ]));
    if (!statusResponse.success) throw new Error(statusResponse.error ?? statusResponse.message);
    if (!listResponse.success) throw new Error(listResponse.error ?? listResponse.message);
    this.status = statusResponse.data as unknown as BackupStatusView;
    this.snapshots = (listResponse.data as unknown as { snapshots: SnapshotSummary[] }).snapshots;
  }

  private async refreshCacheSafely(context: string): Promise<string | null> {
    try {
      await this.refreshCache();
      return null;
    } catch (error) {
      const message = this.errorMessage(error);
      console.error(`[${this.id}] ${context} failed:`, message);
      return message;
    }
  }

  private buildDashboard(): ProjectDashboard {
    return {
      project: this.getSummary(),
      config: this.getRegistration(),
      status: this.status,
      snapshots: [...this.snapshots],
      recovery: this.buildRecoveryView(this.status?.lastRecovery ?? null)
    };
  }

  private buildRecoveryView(lastRecovery: StorageRecoveryReport | null): RecoveryView {
    if (this.restoreRecord) {
      const data = this.restoreRecord.response.data as RestoreOutcome | undefined;
      if (this.restoreRecord.response.success && data?.state === 'restored_verified') {
        return {
          state: 'restored',
          title: '恢复完成并通过校验',
          detail: data.preRestoreSnapshotId ? '目标快照已应用，恢复前安全备份已保留' : '目标快照已应用并完成内容校验',
          occurredAt: this.restoreRecord.occurredAt,
          snapshotId: this.restoreRecord.snapshotId,
          preRestoreSnapshotId: data.preRestoreSnapshotId
        };
      }
      if (data?.rollbackState === 'restored') {
        return {
          state: 'rolled-back',
          title: '恢复失败，已自动回滚',
          detail: '工程已恢复到操作前创建的受保护安全快照',
          occurredAt: this.restoreRecord.occurredAt,
          snapshotId: this.restoreRecord.snapshotId,
          preRestoreSnapshotId: data.preRestoreSnapshotId
        };
      }
      if (data?.rollbackState === 'failed') {
        return {
          state: 'rollback-failed',
          title: '自动回滚失败，需要人工处理',
          detail: data.rollbackError ?? this.restoreRecord.response.error ?? '恢复日志已保留',
          occurredAt: this.restoreRecord.occurredAt,
          snapshotId: this.restoreRecord.snapshotId,
          preRestoreSnapshotId: data.preRestoreSnapshotId
        };
      }
      return {
        state: 'restore-rejected',
        title: '恢复未执行',
        detail: this.restoreRecord.response.error ?? this.restoreRecord.response.message,
        occurredAt: this.restoreRecord.occurredAt,
        snapshotId: this.restoreRecord.snapshotId
      };
    }
    if (lastRecovery?.interruptedRestore) {
      return {
        state: 'startup-rollback',
        title: '检测到中断恢复，已自动回滚',
        detail: '启动检查已从受保护安全快照恢复工程',
        occurredAt: lastRecovery.interruptedRestore.recoveredAt,
        snapshotId: lastRecovery.interruptedRestore.snapshotId,
        preRestoreSnapshotId: lastRecovery.interruptedRestore.preRestoreSnapshotId
      };
    }
    if (this.previewRecord) {
      return {
        state: 'preview-ready',
        title: '恢复预览等待确认',
        detail: '尚未修改工程文件；确认令牌将在五分钟后失效',
        occurredAt: this.previewRecord.occurredAt,
        snapshotId: this.previewRecord.snapshotId
      };
    }
    return { state: 'ready', title: '恢复保护就绪', detail: '最近未执行恢复，也没有待处理的回滚' };
  }

  private inactiveAutomaticStatus(): AutomaticCheckpointStatus {
    return {
      state: 'stopped',
      watcherReady: false,
      startedAt: null,
      lastEventAt: null,
      lastCheckpointAt: null,
      lastCheckpointResult: null,
      pendingChangeCount: 0,
      backupInProgress: false,
      debounceMs: 1500,
      reconciliationIntervalMs: 60_000,
      lastError: null
    };
  }

  private requireManager():
    | { success: true; value: BackupManager }
    | { success: false; response: DesktopResult<never> } {
    if (this.manager) return { success: true, value: this.manager };
    return {
      success: false,
      response: { success: false, message: '工程保护未运行', error: '请先启动该工程的保护会话' }
    };
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.operationTail.then(operation, operation);
    this.operationTail = scheduled.then(() => undefined, () => undefined);
    return await scheduled;
  }

  private snapshotIdFromUnknown(input: unknown): string {
    if (!input || typeof input !== 'object') return 'unknown';
    const value = (input as { snapshotId?: unknown }).snapshotId;
    return typeof value === 'string' ? value : 'unknown';
  }

  private failure<T = never>(message: string, error: unknown): DesktopResult<T> {
    return { success: false, message, error: this.errorMessage(error) };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
