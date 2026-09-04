import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import * as z from 'zod/v4';
import { AutoCheckpointManager } from '../../src/autoCheckpointManager.js';
import {
  BackupManager,
  type BackupResponse
} from '../../src/backupManager.js';
import type {
  ActivationInput,
  AutomaticCheckpointStatus,
  BackupStatusView,
  DesktopDashboard,
  DesktopResult,
  RecoveryView,
  RestoreOutcome,
  RestorePreview,
  SnapshotSummary,
  StorageRecoveryReport,
  VerificationOutcome
} from '../shared/contracts.js';

const activationSchema = z.object({
  projectPath: z.string().trim().min(1).max(4096),
  storageRoot: z.string().trim().min(1).max(4096).optional(),
  autoCheckpoint: z.boolean(),
  maxBackups: z.number().int().min(2).max(10_000)
}).strict();

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

interface ActiveDesktopProject {
  name: string;
  root: string;
  storageRoot: string;
  activatedAt: number;
  config: ActivationInput;
  manager: BackupManager;
  watcher?: AutoCheckpointManager;
  watcherStartError?: string;
}

interface RestoreRecord {
  response: BackupResponse;
  snapshotId: string;
  occurredAt: number;
}

interface PreviewRecord {
  snapshotId: string;
  occurredAt: number;
}

export interface DesktopControllerOptions {
  appVersion: string;
  defaultStorageRoot: string;
  preferencePath: string;
}

export class DesktopBackupController {
  private readonly appVersion: string;
  private readonly defaultStorageRoot: string;
  private readonly preferencePath: string;
  private activeProject?: ActiveDesktopProject;
  private savedSetup: ActivationInput | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private restoreRecord?: RestoreRecord;
  private previewRecord?: PreviewRecord;

  constructor(options: DesktopControllerOptions) {
    this.appVersion = options.appVersion;
    this.defaultStorageRoot = path.resolve(options.defaultStorageRoot);
    this.preferencePath = path.resolve(options.preferencePath);
  }

  async initialize(): Promise<void> {
    try {
      const content = await nodeFs.readFile(this.preferencePath, 'utf8');
      this.savedSetup = activationSchema.parse(JSON.parse(content));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && !(error instanceof z.ZodError) && !(error instanceof SyntaxError)) {
        console.error('Failed to read desktop preferences:', this.errorMessage(error));
      }
      this.savedSetup = null;
    }
  }

  async bootstrap(): Promise<DesktopResult<DesktopDashboard>> {
    return await this.serialize(async () => await this.buildDashboard());
  }

  async refresh(): Promise<DesktopResult<DesktopDashboard>> {
    return await this.serialize(async () => await this.buildDashboard());
  }

  async activate(rawInput: unknown): Promise<DesktopResult> {
    return await this.serialize(async () => {
      try {
        const parsed = activationSchema.parse(rawInput);
        const config: ActivationInput = {
          ...parsed,
          projectPath: path.resolve(parsed.projectPath),
          storageRoot: path.resolve(parsed.storageRoot ?? this.defaultStorageRoot)
        };
        const manager = new BackupManager();
        await manager.initialize(config.projectPath, {
          storageRoot: config.storageRoot,
          maxBackups: config.maxBackups
        });

        const baseline = await manager.createBackup({
          name: `Desktop activation ${new Date().toISOString()}`,
          prompt: 'Verified baseline created by CodeRecoder Desktop',
          tags: ['activation', 'desktop'],
          trigger: 'activation',
          skipIfUnchanged: true
        });
        if (!baseline.success) {
          return this.failure(
            '无法激活工程：基线备份未通过校验',
            baseline.error ?? baseline.message
          );
        }

        if (this.activeProject) {
          const deactivation = await this.deactivateInternal(true);
          if (!deactivation.success) {
            return this.failure(
              '新工程已建立基线，但旧工程未能安全停用',
              deactivation.error ?? deactivation.message
            );
          }
        }

        let watcher: AutoCheckpointManager | undefined;
        let watcherStartError: string | undefined;
        if (config.autoCheckpoint) {
          watcher = new AutoCheckpointManager(manager, {
            onCheckpoint: response => {
              if (!response.success) {
                console.error('Desktop automatic checkpoint failed:', response.error ?? response.message);
              }
            }
          });
          try {
            await watcher.start();
          } catch (error) {
            watcherStartError = this.errorMessage(error);
            await watcher.stop().catch(() => undefined);
            watcher = undefined;
          }
        }

        const root = manager.getProjectRoot();
        this.activeProject = {
          name: path.basename(root),
          root,
          storageRoot: manager.getStorageRoot(),
          activatedAt: Date.now(),
          config,
          manager,
          watcher,
          watcherStartError
        };
        this.savedSetup = config;
        this.restoreRecord = undefined;
        this.previewRecord = undefined;
        await this.savePreferences(config);

        return {
          success: true,
          message: watcherStartError
            ? '工程已激活，但自动检查点未能启动'
            : '工程已激活并完成基线备份',
          data: {
            projectRoot: root,
            storageRoot: manager.getStorageRoot(),
            automaticCheckpoint: watcherStartError ? 'degraded' : watcher ? 'running' : 'stopped'
          }
        };
      } catch (error) {
        return this.failure('激活工程失败', error);
      }
    });
  }

  async deactivate(createFinalCheckpoint = true): Promise<DesktopResult> {
    return await this.serialize(async () => await this.deactivateInternal(createFinalCheckpoint));
  }

  async createSnapshot(rawInput: unknown): Promise<DesktopResult> {
    return await this.serialize(async () => {
      const active = this.requireActiveProject();
      if (!active.success) return active.response;

      try {
        const input = createSnapshotSchema.parse(rawInput);
        return await active.project.manager.createBackup({
          name: input.name ?? `Manual backup ${new Date().toISOString()}`,
          prompt: 'Manual backup created from CodeRecoder Desktop',
          tags: ['manual', 'desktop'],
          trigger: 'manual',
          skipIfUnchanged: false
        });
      } catch (error) {
        return this.failure('创建备份失败', error);
      }
    });
  }

  async verifySnapshot(rawSnapshotId: unknown): Promise<DesktopResult<VerificationOutcome>> {
    return await this.serialize(async () => {
      const active = this.requireActiveProject();
      if (!active.success) return active.response;

      try {
        const snapshotId = snapshotIdSchema.parse(rawSnapshotId);
        return await active.project.manager.verifyBackup(snapshotId) as DesktopResult<VerificationOutcome>;
      } catch (error) {
        return this.failure('验证备份失败', error);
      }
    });
  }

  async previewRestore(rawInput: unknown): Promise<DesktopResult<RestorePreview>> {
    return await this.serialize(async () => {
      const active = this.requireActiveProject();
      if (!active.success) return active.response;

      try {
        const input = previewRestoreSchema.parse(rawInput);
        const response = await active.project.manager.previewRestore(input.snapshotId, input.mode);
        if (response.success) {
          this.previewRecord = {
            snapshotId: input.snapshotId,
            occurredAt: Date.now()
          };
        }
        return response as DesktopResult<RestorePreview>;
      } catch (error) {
        return this.failure('生成恢复预览失败', error);
      }
    });
  }

  async restoreSnapshot(rawInput: unknown): Promise<DesktopResult<RestoreOutcome>> {
    return await this.serialize(async () => {
      const active = this.requireActiveProject();
      if (!active.success) return active.response;

      let watcherPaused = false;
      try {
        const input = restoreSnapshotSchema.parse(rawInput);
        await active.project.watcher?.pause(true);
        watcherPaused = active.project.watcher !== undefined;
        const response = await active.project.manager.restoreBackup(
          input.snapshotId,
          input.confirmationToken
        );
        this.restoreRecord = {
          response,
          snapshotId: input.snapshotId,
          occurredAt: Date.now()
        };
        this.previewRecord = undefined;
        return response as DesktopResult<RestoreOutcome>;
      } catch (error) {
        const response = this.failure('协调恢复操作失败', error);
        this.restoreRecord = {
          response,
          snapshotId: this.snapshotIdFromUnknown(rawInput),
          occurredAt: Date.now()
        };
        this.previewRecord = undefined;
        return response;
      } finally {
        if (watcherPaused) {
          try {
            active.project.watcher?.resume(true);
          } catch (error) {
            console.error('Failed to resume desktop automatic checkpoints:', this.errorMessage(error));
          }
        }
      }
    });
  }

  async shutdown(): Promise<void> {
    await this.serialize(async () => {
      if (!this.activeProject) return;
      const response = await this.deactivateInternal(true);
      if (!response.success) {
        console.error('Desktop shutdown checkpoint failed:', response.error ?? response.message);
      }
    });
  }

  private async buildDashboard(): Promise<DesktopResult<DesktopDashboard>> {
    const inactiveAutomaticStatus = this.inactiveAutomaticStatus();
    if (!this.activeProject) {
      return {
        success: true,
        message: '桌面备份控制台尚未激活工程',
        data: {
          appVersion: this.appVersion,
          active: false,
          defaultStorageRoot: this.defaultStorageRoot,
          savedSetup: this.savedSetup,
          project: null,
          status: null,
          automaticCheckpoint: inactiveAutomaticStatus,
          snapshots: [],
          recovery: this.readyRecoveryView()
        }
      };
    }

    try {
      const project = this.activeProject;
      const [statusResponse, listResponse] = await Promise.all([
        project.manager.getStatus(),
        project.manager.listBackups(200)
      ]);
      if (!statusResponse.success) {
        return this.failure('读取备份状态失败', statusResponse.error ?? statusResponse.message);
      }
      if (!listResponse.success) {
        return this.failure('读取快照列表失败', listResponse.error ?? listResponse.message);
      }

      const status = statusResponse.data as unknown as BackupStatusView;
      const listData = listResponse.data as unknown as { snapshots: SnapshotSummary[] };
      const automaticCheckpoint: AutomaticCheckpointStatus = project.watcher
        ? project.watcher.getStatus() as AutomaticCheckpointStatus
        : {
            ...inactiveAutomaticStatus,
            state: project.watcherStartError ? 'degraded' : 'stopped',
            lastError: project.watcherStartError ?? null
          };

      return {
        success: true,
        message: '桌面备份状态已刷新',
        data: {
          appVersion: this.appVersion,
          active: true,
          defaultStorageRoot: this.defaultStorageRoot,
          savedSetup: this.savedSetup,
          project: {
            name: project.name,
            root: project.root,
            storageRoot: project.storageRoot,
            activatedAt: project.activatedAt
          },
          status,
          automaticCheckpoint,
          snapshots: listData.snapshots,
          recovery: this.buildRecoveryView(status.lastRecovery)
        }
      };
    } catch (error) {
      return this.failure('刷新桌面备份状态失败', error);
    }
  }

  private async deactivateInternal(createFinalCheckpoint: boolean): Promise<DesktopResult> {
    const project = this.activeProject;
    if (!project) {
      return {
        success: true,
        message: '当前没有激活工程',
        data: { state: 'inactive' }
      };
    }

    let finalCheckpoint: BackupResponse | undefined;
    try {
      await project.watcher?.pause(true);
      if (createFinalCheckpoint) {
        finalCheckpoint = await project.manager.createBackup({
          name: `Desktop shutdown ${new Date().toISOString()}`,
          prompt: 'Final verified checkpoint before CodeRecoder Desktop stopped monitoring',
          tags: ['deactivation', 'desktop'],
          trigger: 'manual',
          skipIfUnchanged: true
        });
      }
      await project.watcher?.stop();
      this.activeProject = undefined;

      if (finalCheckpoint && !finalCheckpoint.success) {
        return this.failure(
          '工程已停用，但最终检查点创建失败',
          finalCheckpoint.error ?? finalCheckpoint.message
        );
      }
      return {
        success: true,
        message: '工程监控已安全停止',
        data: { state: 'inactive' }
      };
    } catch (error) {
      await project.watcher?.stop().catch(() => undefined);
      this.activeProject = undefined;
      return this.failure('停用工程时发生错误', error);
    }
  }

  private buildRecoveryView(lastRecovery: StorageRecoveryReport | null): RecoveryView {
    if (this.restoreRecord) {
      const data = this.restoreRecord.response.data as RestoreOutcome | undefined;
      if (this.restoreRecord.response.success && data?.state === 'restored_verified') {
        return {
          state: 'restored',
          title: '恢复完成并通过校验',
          detail: data.preRestoreSnapshotId
            ? '目标快照已应用，恢复前安全备份已保留'
            : '目标快照已应用并完成内容校验',
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

    return this.readyRecoveryView();
  }

  private readyRecoveryView(): RecoveryView {
    return {
      state: 'ready',
      title: '恢复保护就绪',
      detail: '最近未执行恢复，也没有待处理的回滚'
    };
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

  private requireActiveProject():
    | { success: true; project: ActiveDesktopProject }
    | { success: false; response: DesktopResult<never> } {
    if (this.activeProject) return { success: true, project: this.activeProject };
    return {
      success: false,
      response: {
        success: false,
        message: '尚未激活工程',
        error: '请先选择工程并启动保护'
      }
    };
  }

  private async savePreferences(config: ActivationInput): Promise<void> {
    await nodeFs.mkdir(path.dirname(this.preferencePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.preferencePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await nodeFs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      await nodeFs.rename(temporaryPath, this.preferencePath);
      await nodeFs.chmod(this.preferencePath, 0o600);
    } catch (error) {
      await nodeFs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.operationTail.then(operation, operation);
    this.operationTail = scheduled.then(() => undefined, () => undefined);
    return await scheduled;
  }

  private snapshotIdFromUnknown(input: unknown): string {
    if (!input || typeof input !== 'object') return 'unknown';
    const snapshotId = (input as { snapshotId?: unknown }).snapshotId;
    return typeof snapshotId === 'string' ? snapshotId : 'unknown';
  }

  private failure<T = never>(message: string, error: unknown): DesktopResult<T> {
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
