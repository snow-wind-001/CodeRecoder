#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import path from 'path';
import { pathToFileURL } from 'url';
import * as z from 'zod/v4';
import { AutoCheckpointManager } from './autoCheckpointManager.js';
import {
  BackupManager,
  BackupResponse,
  RestoreMode
} from './backupManager.js';

const SERVER_VERSION = '3.0.0';

const responseSchema = {
  success: z.boolean(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional()
};

interface ActiveProject {
  name: string;
  root: string;
  activatedAt: number;
  backupManager: BackupManager;
  autoCheckpoint?: AutoCheckpointManager;
}

export class CodeRecoderServer {
  private readonly mcp: McpServer;
  private activeProject?: ActiveProject;
  private lifecycleTail: Promise<void> = Promise.resolve();

  constructor() {
    this.mcp = new McpServer(
      {
        name: 'coderecoder-mcp',
        version: SERVER_VERSION
      },
      {
        instructions: [
          'CodeRecoder is a code backup service, not a replacement for Git.',
          'Call activate_project before using project backup tools.',
          'Automatic filesystem checkpoints run only while this MCP process has an active project.',
          'Before any restore, call preview_project_restore and show the proposed changes to the user.',
          'Call restore_project_snapshot only after explicit user confirmation; never invent or reuse a confirmation token.',
          'Exact restore removes managed code paths absent from the selected backup, while configured exclusions are preserved.',
          'Check get_backup_status for degraded monitoring or uncheckpointed changes.'
        ].join(' ')
      }
    );

    this.registerTools();
    this.mcp.server.onclose = () => {
      void this.deactivateProject(true).then(response => {
        if (!response.success) {
          console.error('Final checkpoint after transport close failed:', response.error ?? response.message);
        }
      });
    };
  }

  async connect(transport: Transport): Promise<void> {
    await this.mcp.connect(transport);
  }

  async close(): Promise<void> {
    if (this.activeProject) {
      const response = await this.deactivateProject(true);
      if (!response.success) {
        console.error('CodeRecoder shutdown checkpoint failed:', response.error ?? response.message);
      }
    }
    await this.mcp.close();
  }

  private registerTools(): void {
    this.mcp.registerTool(
      'activate_project',
      {
        title: 'Activate Code Backup',
        description: 'Activate one project for this MCP process, create a verified baseline, and optionally start automatic checkpoints. Use storageRoot to keep all backup data outside a protected project.',
        inputSchema: {
          projectPath: z.string().min(1).describe('Project directory to protect'),
          projectName: z.string().min(1).max(120).optional(),
          storageRoot: z.string().min(1).optional().describe('Optional external directory for backup storage'),
          maxBackups: z.number().int().min(2).max(10_000).optional(),
          autoCheckpoint: z.boolean().optional().describe('Defaults to true'),
          debounceMs: z.number().int().min(100).max(60_000).optional(),
          reconciliationIntervalMs: z.number().int().min(1_000).max(86_400_000).optional(),
          excludeNames: z.array(z.string().min(1).max(255).regex(/^[^/\\]+$/)).max(100).optional()
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false
        }
      },
      async args => this.toToolResult(await this.activateProject(args))
    );

    this.mcp.registerTool(
      'deactivate_project',
      {
        title: 'Deactivate Code Backup',
        description: 'Create a final checkpoint by default, stop automatic monitoring, and clear this process-local active project.',
        inputSchema: {
          createFinalCheckpoint: z.boolean().optional().describe('Defaults to true')
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      async ({ createFinalCheckpoint }) => this.toToolResult(
        await this.deactivateProject(createFinalCheckpoint ?? true)
      )
    );

    this.mcp.registerTool(
      'get_backup_status',
      {
        title: 'Get Backup Status',
        description: 'Report active-project storage, integrity evidence, pending changes, and automatic-checkpoint health.',
        inputSchema: {},
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      async () => this.toToolResult(await this.getBackupStatus())
    );

    this.mcp.registerTool(
      'create_project_snapshot',
      {
        title: 'Create Verified Code Backup',
        description: 'Create an independently restorable, SHA-256-verified backup of the active project. Unchanged files may be deduplicated in storage.',
        inputSchema: {
          name: z.string().min(1).max(200).optional(),
          prompt: z.string().min(1).max(2_000).optional(),
          tags: z.array(z.string().min(1).max(80)).max(32).optional(),
          skipIfUnchanged: z.boolean().optional().describe('Defaults to false for explicit backups')
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false
        }
      },
      async args => {
        const active = this.requireActiveProject();
        if (!active.success) return this.toToolResult(active.response);
        return this.toToolResult(await active.project.backupManager.createBackup({
          name: args.name,
          prompt: args.prompt,
          tags: args.tags,
          trigger: 'manual',
          skipIfUnchanged: args.skipIfUnchanged ?? false
        }));
      }
    );

    this.mcp.registerTool(
      'list_project_snapshots',
      {
        title: 'List Code Backups',
        description: 'List verified backups newest first, including hashes, triggers, sizes, and change counts.',
        inputSchema: {
          limit: z.number().int().min(1).max(500).optional()
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      async ({ limit }) => {
        const active = this.requireActiveProject();
        if (!active.success) return this.toToolResult(active.response);
        return this.toToolResult(await active.project.backupManager.listBackups(limit ?? 50));
      }
    );

    this.mcp.registerTool(
      'preview_project_restore',
      {
        title: 'Preview Code Restore',
        description: 'Verify a backup and calculate the restore change set. Returns a short-lived token; present the preview to the user before requesting confirmation.',
        inputSchema: {
          snapshotId: z.string().uuid(),
          mode: z.enum(['exact', 'overlay']).optional().describe('Defaults to exact')
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false
        }
      },
      async ({ snapshotId, mode }) => {
        const active = this.requireActiveProject();
        if (!active.success) return this.toToolResult(active.response);
        return this.toToolResult(await active.project.backupManager.previewRestore(
          snapshotId,
          (mode ?? 'exact') as RestoreMode
        ));
      }
    );

    this.mcp.registerTool(
      'restore_project_snapshot',
      {
        title: 'Restore Code Backup',
        description: 'Destructively apply a previously previewed restore. Requires the matching unexpired confirmation token. A verified pre-restore safety backup and automatic rollback are mandatory.',
        inputSchema: {
          snapshotId: z.string().uuid(),
          confirmationToken: z.string().uuid().describe('Token returned by preview_project_restore after explicit user confirmation')
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false
        }
      },
      async ({ snapshotId, confirmationToken }) => this.toToolResult(
        await this.restoreProject(snapshotId, confirmationToken)
      )
    );

    this.mcp.registerTool(
      'verify_project_snapshot',
      {
        title: 'Verify Code Backup',
        description: 'Re-hash the selected backup and validate entry types, paths, modes, and manifest integrity.',
        inputSchema: {
          snapshotId: z.string().uuid()
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      async ({ snapshotId }) => {
        const active = this.requireActiveProject();
        if (!active.success) return this.toToolResult(active.response);
        return this.toToolResult(await active.project.backupManager.verifyBackup(snapshotId));
      }
    );

    this.mcp.registerTool(
      'delete_project_snapshot',
      {
        title: 'Delete Code Backup',
        description: 'Permanently delete one backup. Call only after explicit user approval and repeat the exact snapshot ID in confirmSnapshotId.',
        inputSchema: {
          snapshotId: z.string().uuid(),
          confirmSnapshotId: z.string().uuid()
        },
        outputSchema: responseSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false
        }
      },
      async ({ snapshotId, confirmSnapshotId }) => {
        const active = this.requireActiveProject();
        if (!active.success) return this.toToolResult(active.response);
        return this.toToolResult(await active.project.backupManager.deleteBackup(
          snapshotId,
          confirmSnapshotId
        ));
      }
    );
  }

  private async activateProject(args: {
    projectPath: string;
    projectName?: string;
    storageRoot?: string;
    maxBackups?: number;
    autoCheckpoint?: boolean;
    debounceMs?: number;
    reconciliationIntervalMs?: number;
    excludeNames?: string[];
  }): Promise<BackupResponse> {
    return await this.runLifecycleOperation(async () => await this.performActivateProject(args));
  }

  private async performActivateProject(args: {
    projectPath: string;
    projectName?: string;
    storageRoot?: string;
    maxBackups?: number;
    autoCheckpoint?: boolean;
    debounceMs?: number;
    reconciliationIntervalMs?: number;
    excludeNames?: string[];
  }): Promise<BackupResponse> {
    const manager = new BackupManager();
    let watcher: AutoCheckpointManager | undefined;

    try {
      await manager.initialize(args.projectPath, {
        storageRoot: args.storageRoot,
        maxBackups: args.maxBackups,
        excludeNames: args.excludeNames
      });

      if (args.autoCheckpoint ?? true) {
        watcher = new AutoCheckpointManager(manager, {
          debounceMs: args.debounceMs,
          reconciliationIntervalMs: args.reconciliationIntervalMs,
          onCheckpoint: response => {
            const level = response.success ? 'completed' : 'failed';
            console.error(`Automatic checkpoint ${level}: ${response.message}`);
          }
        });
        await watcher.start();
      }

      const activationCheckpoint = await manager.createBackup({
        name: `Activation checkpoint ${new Date().toISOString()}`,
        prompt: 'Verified baseline created when the project was activated',
        tags: ['activation'],
        trigger: 'activation',
        skipIfUnchanged: true
      });
      if (!activationCheckpoint.success) {
        await watcher?.stop();
        return {
          success: false,
          message: 'Project activation failed because the baseline backup could not be verified',
          error: activationCheckpoint.error ?? activationCheckpoint.message
        };
      }

      if (this.activeProject) {
        const deactivation = await this.performDeactivateProject(true);
        if (!deactivation.success) {
          await watcher?.stop();
          return {
            success: false,
            message: 'New project baseline was created, but the previous project could not be safely deactivated',
            error: deactivation.error ?? deactivation.message
          };
        }
      }
      const root = manager.getProjectRoot();
      this.activeProject = {
        name: args.projectName ?? path.basename(root),
        root,
        activatedAt: Date.now(),
        backupManager: manager,
        autoCheckpoint: watcher
      };

      const automaticStatus = watcher?.getStatus() ?? {
        state: 'stopped',
        lastError: null
      };
      const degraded = automaticStatus.state === 'degraded';
      return {
        success: true,
        message: degraded
          ? 'Project activated with degraded automatic monitoring; inspect automaticCheckpoint.lastError'
          : 'Project activated with a verified baseline backup',
        data: {
          state: degraded ? 'active_degraded' : 'active',
          projectName: this.activeProject.name,
          projectRoot: root,
          storageRoot: manager.getStorageRoot(),
          activationCheckpoint: activationCheckpoint.data ?? {},
          automaticCheckpoint: {
            enabled: watcher !== undefined,
            ...automaticStatus
          }
        }
      };
    } catch (error) {
      await watcher?.stop().catch(() => undefined);
      return this.failure('Failed to activate project backup', error);
    }
  }

  private async deactivateProject(createFinalCheckpoint: boolean): Promise<BackupResponse> {
    return await this.runLifecycleOperation(
      async () => await this.performDeactivateProject(createFinalCheckpoint)
    );
  }

  private async performDeactivateProject(createFinalCheckpoint: boolean): Promise<BackupResponse> {
    const project = this.activeProject;
    if (!project) {
      return {
        success: true,
        message: 'No project is active in this MCP process',
        data: { state: 'inactive', hadActiveProject: false }
      };
    }

    let finalCheckpoint: BackupResponse | undefined;
    try {
      await project.autoCheckpoint?.pause(true);
      if (createFinalCheckpoint) {
        finalCheckpoint = await project.backupManager.createBackup({
          name: `Deactivation checkpoint ${new Date().toISOString()}`,
          prompt: 'Final verified checkpoint before automatic monitoring stopped',
          tags: ['deactivation'],
          trigger: 'manual',
          skipIfUnchanged: true
        });
      }
      await project.autoCheckpoint?.stop();
      this.activeProject = undefined;

      if (finalCheckpoint && !finalCheckpoint.success) {
        return {
          success: false,
          message: 'Project was deactivated, but the final checkpoint failed',
          error: finalCheckpoint.error ?? finalCheckpoint.message,
          data: {
            state: 'inactive_degraded',
            hadActiveProject: true,
            projectRoot: project.root
          }
        };
      }

      return {
        success: true,
        message: 'Project backup deactivated and automatic monitoring stopped',
        data: {
          state: 'inactive',
          hadActiveProject: true,
          projectRoot: project.root,
          finalCheckpoint: finalCheckpoint?.data ?? null
        }
      };
    } catch (error) {
      await project.autoCheckpoint?.stop().catch(() => undefined);
      this.activeProject = undefined;
      return this.failure('Project deactivation encountered an error', error, {
        state: 'inactive_degraded',
        projectRoot: project.root
      });
    }
  }

  private async getBackupStatus(): Promise<BackupResponse> {
    const active = this.requireActiveProject();
    if (!active.success) return active.response;

    const response = await active.project.backupManager.getStatus();
    if (!response.success) return response;
    return {
      ...response,
      data: {
        ...response.data,
        activeProject: {
          name: active.project.name,
          root: active.project.root,
          activatedAt: active.project.activatedAt,
          scope: 'this-mcp-process'
        },
        automaticCheckpoint: active.project.autoCheckpoint
          ? {
              enabled: true,
              ...active.project.autoCheckpoint.getStatus()
            }
          : {
              enabled: false,
              state: 'stopped',
              lastError: null
            }
      }
    };
  }

  private async restoreProject(snapshotId: string, confirmationToken: string): Promise<BackupResponse> {
    const active = this.requireActiveProject();
    if (!active.success) return active.response;

    const watcher = active.project.autoCheckpoint;
    try {
      await watcher?.pause(true);
      const response = await active.project.backupManager.restoreBackup(
        snapshotId,
        confirmationToken
      );
      return {
        ...response,
        data: response.data
          ? {
              ...response.data,
              automaticCheckpointEvents: 'discarded-during-restore'
            }
          : response.data
      };
    } catch (error) {
      return this.failure('Failed to coordinate project restore', error);
    } finally {
      try {
        watcher?.resume(true);
      } catch (error) {
        console.error('Failed to resume automatic checkpoints:', error);
      }
    }
  }

  private requireActiveProject():
    | { success: true; project: ActiveProject }
    | { success: false; response: BackupResponse } {
    if (this.activeProject) return { success: true, project: this.activeProject };
    return {
      success: false,
      response: {
        success: false,
        message: 'No project is active in this MCP process',
        error: 'Call activate_project before using backup tools'
      }
    };
  }

  private toToolResult(response: BackupResponse): CallToolResult {
    const structuredContent: Record<string, unknown> = {
      success: response.success,
      message: response.message
    };
    if (response.data !== undefined) structuredContent.data = response.data;
    if (response.error !== undefined) structuredContent.error = response.error;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(structuredContent, null, 2)
      }],
      structuredContent,
      isError: !response.success
    };
  }

  private failure(
    message: string,
    error: unknown,
    data?: Record<string, unknown>
  ): BackupResponse {
    return {
      success: false,
      message,
      error: error instanceof Error ? error.message : String(error),
      data
    };
  }

  private async runLifecycleOperation<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = scheduled.then(() => undefined, () => undefined);
    return await scheduled;
  }
}

export async function startStdioServer(): Promise<CodeRecoderServer> {
  const server = new CodeRecoderServer();
  await server.connect(new StdioServerTransport());
  console.error(`CodeRecoder MCP ${SERVER_VERSION} running on stdio`);
  return server;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (entrypoint === import.meta.url) {
  let runningServer: CodeRecoderServer | undefined;
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await runningServer?.close();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.stdin.once('end', () => {
    void shutdown().finally(() => process.exit(0));
  });

  startStdioServer()
    .then(server => {
      runningServer = server;
    })
    .catch(error => {
      console.error('CodeRecoder MCP failed to start:', error);
      process.exit(1);
    });
}
