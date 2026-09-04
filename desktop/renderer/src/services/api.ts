import type {
  ActivationInput,
  CodeRecoderDesktopApi,
  DesktopDashboard,
  DesktopResult,
  RestoreMode,
  RestoreOutcome,
  RestorePreview,
  VerificationOutcome,
  SnapshotSummary
} from '../../../shared/contracts.js';

const demoProjectPath = '/home/user/work/CodeRecoder';
const demoStorageRoot = '/home/user/.config/CodeRecoder/backup-storage/CodeRecoder-demo';

function demoSnapshot(
  id: string,
  createdAt: number,
  trigger: SnapshotSummary['trigger'],
  name: string,
  overrides: Partial<SnapshotSummary> = {}
): SnapshotSummary {
  return {
    id,
    createdAt,
    name,
    prompt: 'Verified desktop backup',
    tags: [trigger, 'desktop'],
    trigger,
    storageMode: trigger === 'activation' ? 'full-copy' : 'hardlink-deduplicated',
    status: 'verified',
    treeHash: id.replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
    totalFiles: 126,
    logicalBytes: 2_936_012,
    storedBytes: 188_416,
    changeCounts: { added: 4, modified: 1, deleted: 1, renamed: 0 },
    ...overrides
  };
}

function createDemoApi(): CodeRecoderDesktopApi {
  const now = Date.now();
  let snapshots: SnapshotSummary[] = [
    demoSnapshot('8f420000-0000-4000-8000-00000000c91a', now - 2 * 60_000, 'automatic', 'Automatic checkpoint'),
    demoSnapshot('aa190000-0000-4000-8000-0000000072ef', now - 86 * 60_000, 'manual', 'Release candidate', {
      changeCounts: { added: 2, modified: 6, deleted: 0, renamed: 1 },
      storedBytes: 425_984
    }),
    demoSnapshot('10d40000-0000-4000-8000-00000000ab35', now - 5 * 60 * 60_000, 'activation', 'Activation baseline', {
      changeCounts: { added: 126, modified: 0, deleted: 0, renamed: 0 },
      storedBytes: 2_936_012
    })
  ];
  let active = true;
  let savedSetup: ActivationInput = {
    projectPath: demoProjectPath,
    storageRoot: '/home/user/.config/CodeRecoder/backup-storage',
    autoCheckpoint: true,
    maxBackups: 100
  };
  let recovery: DesktopDashboard['recovery'] = {
    state: 'ready',
    title: '恢复保护就绪',
    detail: '最近未执行恢复，也没有待处理的回滚'
  };
  let lastRestoreMode: RestoreMode = 'exact';

  const dashboard = (): DesktopDashboard => ({
    appVersion: '3.0.0-preview',
    active,
    defaultStorageRoot: '/home/user/.config/CodeRecoder/backup-storage',
    savedSetup,
    project: active ? {
      name: 'CodeRecoder',
      root: savedSetup.projectPath,
      storageRoot: demoStorageRoot,
      activatedAt: now - 6 * 60 * 60_000
    } : null,
    status: active ? {
      state: 'ready',
      projectRoot: savedSetup.projectPath,
      storageRoot: demoStorageRoot,
      externalStorage: true,
      snapshotCount: snapshots.length,
      latestSnapshot: snapshots[0] ?? null,
      currentMatchesSnapshot: snapshots[0] ?? null,
      currentTreeHash: snapshots[0]?.treeHash ?? ''.padEnd(64, '0'),
      hasUncheckpointedChanges: false,
      hashAlgorithm: 'sha256',
      lastRecovery: null
    } : null,
    automaticCheckpoint: {
      state: active && savedSetup.autoCheckpoint ? 'running' : 'stopped',
      watcherReady: active && savedSetup.autoCheckpoint,
      startedAt: active ? now - 6 * 60 * 60_000 : null,
      lastEventAt: now - 2 * 60_000,
      lastCheckpointAt: snapshots[0]?.createdAt ?? null,
      lastCheckpointResult: snapshots.length > 0 ? 'created' : null,
      pendingChangeCount: 0,
      backupInProgress: false,
      debounceMs: 1500,
      reconciliationIntervalMs: 60_000,
      lastError: null
    },
    snapshots: active ? snapshots : [],
    recovery
  });

  const ok = <T>(message: string, data?: T): DesktopResult<T> => ({ success: true, message, data });

  return {
    bootstrap: async () => ok('预览数据已加载', structuredClone(dashboard())),
    refresh: async () => ok('预览数据已刷新', structuredClone(dashboard())),
    chooseDirectory: async kind => ok('目录已选择', {
      path: kind === 'project' ? demoProjectPath : savedSetup.storageRoot ?? null
    }),
    activate: async input => {
      savedSetup = { ...input };
      active = true;
      return ok('工程已激活');
    },
    deactivate: async () => {
      active = false;
      return ok('工程监控已安全停止');
    },
    createSnapshot: async input => {
      const id = crypto.randomUUID();
      snapshots = [demoSnapshot(id, Date.now(), 'manual', input.name ?? 'Manual backup'), ...snapshots];
      return ok('Verified code backup created', { snapshot: snapshots[0] });
    },
    verifySnapshot: async snapshotId => ok('备份验证通过', {
      snapshotId,
      verification: 'verified' as const,
      treeHash: snapshots.find(snapshot => snapshot.id === snapshotId)?.treeHash,
      verifiedEntries: snapshots.find(snapshot => snapshot.id === snapshotId)?.totalFiles ?? 0
    }),
    previewRestore: async ({ snapshotId, mode }) => {
      const snapshot = snapshots.find(item => item.id === snapshotId);
      if (!snapshot) return { success: false, message: '快照不存在', error: 'Snapshot not found' };
      recovery = {
        state: 'preview-ready',
        title: '恢复预览等待确认',
        detail: '尚未修改工程文件；确认令牌将在五分钟后失效',
        occurredAt: Date.now(),
        snapshotId
      };
      lastRestoreMode = mode;
      return ok('恢复预览已生成', {
        state: 'restore_preview' as const,
        snapshotId,
        snapshotName: snapshot.name,
        mode,
        changes: {
          added: ['src/new-feature.ts'],
          modified: ['src/index.ts', 'README.md', 'package.json', 'test/backup-system.test.js'],
          deleted: ['src/old-adapter.ts', 'docs/legacy.md'],
          renamed: []
        },
        counts: { added: 1, modified: 4, deleted: 2, renamed: 0 },
        confirmationToken: crypto.randomUUID(),
        expiresAt: Date.now() + 5 * 60_000,
        requiresConfirmation: true as const
      });
    },
    restoreSnapshot: async ({ snapshotId }) => {
      recovery = {
        state: 'restored',
        title: '恢复完成并通过校验',
        detail: '目标快照已应用，恢复前安全备份已保留',
        occurredAt: Date.now(),
        snapshotId,
        preRestoreSnapshotId: crypto.randomUUID()
      };
      return ok('代码恢复完成并通过校验', {
        state: 'restored_verified' as const,
        snapshotId,
        mode: lastRestoreMode,
        preRestoreSnapshotId: recovery.preRestoreSnapshotId,
        verification: 'verified' as const
      });
    }
  };
}

function unavailableApi(): CodeRecoderDesktopApi {
  const unavailable = async <T = unknown>(): Promise<DesktopResult<T>> => ({
    success: false,
    message: '桌面桥接不可用',
    error: '请通过 Electron 启动 CodeRecoder Desktop'
  });
  return {
    bootstrap: async () => await unavailable<DesktopDashboard>(),
    chooseDirectory: async () => await unavailable<{ path: string | null }>(),
    activate: async () => await unavailable(),
    deactivate: async () => await unavailable(),
    refresh: async () => await unavailable<DesktopDashboard>(),
    createSnapshot: async () => await unavailable(),
    verifySnapshot: async () => await unavailable<VerificationOutcome>(),
    previewRestore: async () => await unavailable<RestorePreview>(),
    restoreSnapshot: async () => await unavailable<RestoreOutcome>()
  };
}

let resolvedApi: CodeRecoderDesktopApi | undefined;

export function getDesktopApi(): CodeRecoderDesktopApi {
  if (resolvedApi) return resolvedApi;
  resolvedApi = window.codeRecoder
    ?? (import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1'
      ? createDemoApi()
      : unavailableApi());
  return resolvedApi;
}
