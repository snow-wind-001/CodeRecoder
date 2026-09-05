import type {
  CodeRecoderDesktopApi,
  DesktopDashboard,
  DesktopResult,
  McpRecommendation,
  ProjectDashboard,
  ProjectRegistrationInput,
  ProjectSummary,
  RestoreMode,
  RestoreOutcome,
  RestorePreview,
  SnapshotSummary,
  VerificationOutcome
} from '../../../shared/contracts.js';

const firstProjectId = 'af420000-0000-4000-8000-00000000c91a';
const secondProjectId = 'bb190000-0000-4000-8000-0000000072ef';

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
  const configs = new Map<string, ProjectRegistrationInput>([
    [firstProjectId, {
      projectPath: '/home/user/work/CodeRecoder',
      storageRoot: '/home/user/Backups/CodeRecoder',
      autoCheckpoint: true,
      maxBackups: 100,
      startOnLaunch: true,
      serenaEnabled: true,
      serenaAutoConfigure: true
    }],
    [secondProjectId, {
      projectPath: '/home/user/work/client-portal',
      storageRoot: '/home/user/Backups/CodeRecoder',
      autoCheckpoint: true,
      maxBackups: 100,
      startOnLaunch: true,
      serenaEnabled: true,
      serenaAutoConfigure: true
    }]
  ]);
  const snapshots = new Map<string, SnapshotSummary[]>([
    [firstProjectId, [
      demoSnapshot('8f420000-0000-4000-8000-00000000c91a', now - 2 * 60_000, 'automatic', 'Automatic checkpoint'),
      demoSnapshot('aa190000-0000-4000-8000-0000000072ef', now - 86 * 60_000, 'manual', 'Release candidate', {
        changeCounts: { added: 2, modified: 6, deleted: 0, renamed: 1 }, storedBytes: 425_984
      }),
      demoSnapshot('10d40000-0000-4000-8000-00000000ab35', now - 5 * 60 * 60_000, 'activation', 'Activation baseline', {
        changeCounts: { added: 126, modified: 0, deleted: 0, renamed: 0 }, storedBytes: 2_936_012
      })
    ]],
    [secondProjectId, [demoSnapshot('71d40000-0000-4000-8000-00000000ab35', now - 18 * 60_000, 'automatic', 'Automatic checkpoint')]]
  ]);
  const running = new Set<string>([firstProjectId, secondProjectId]);
  const serenaReady = new Set<string>([firstProjectId]);
  let selectedId: string | null = firstProjectId;
  const readyRecovery = (): ProjectDashboard['recovery'] => ({
    state: 'ready',
    title: '恢复保护就绪',
    detail: '最近未执行恢复，也没有待处理的回滚'
  });
  const recoveries = new Map<string, ProjectDashboard['recovery']>([
    [firstProjectId, readyRecovery()],
    [secondProjectId, readyRecovery()]
  ]);
  let lastRestoreMode: RestoreMode = 'exact';

  const summary = (id: string): ProjectSummary => {
    const config = configs.get(id) as ProjectRegistrationInput;
    const projectSnapshots = snapshots.get(id) ?? [];
    const isRunning = running.has(id);
    const serenaEnabled = config.serenaEnabled;
    const isSerenaReady = serenaEnabled && serenaReady.has(id) && isRunning;
    return {
      id,
      name: config.projectPath.split('/').at(-1) ?? 'project',
      root: config.projectPath,
      storageRoot: `${config.storageRoot}/${config.projectPath.split('/').at(-1)}-demo`,
      registeredAt: now - 24 * 60 * 60_000,
      activatedAt: isRunning ? now - 6 * 60 * 60_000 : null,
      startOnLaunch: config.startOnLaunch,
      protectionState: isRunning ? 'running' : 'stopped',
      snapshotCount: projectSnapshots.length,
      latestSnapshotAt: projectSnapshots[0]?.createdAt ?? null,
      hasUncheckpointedChanges: id === secondProjectId,
      automaticCheckpoint: {
        state: isRunning ? 'running' : 'stopped',
        watcherReady: isRunning,
        startedAt: isRunning ? now - 6 * 60 * 60_000 : null,
        lastEventAt: id === secondProjectId ? now - 40_000 : now - 2 * 60_000,
        lastCheckpointAt: projectSnapshots[0]?.createdAt ?? null,
        lastCheckpointResult: projectSnapshots.length ? 'created' : null,
        pendingChangeCount: id === secondProjectId ? 2 : 0,
        backupInProgress: false,
        debounceMs: 1500,
        reconciliationIntervalMs: 60_000,
        lastError: null
      },
      serena: {
        state: !serenaEnabled ? 'disabled' : !isRunning ? 'stopped' : isSerenaReady ? 'ready' : 'degraded',
        enabled: serenaEnabled,
        autoConfigure: config.serenaAutoConfigure,
        cliPath: '/home/user/.local/bin/serena',
        configPath: `${config.projectPath}/.serena/project.yml`,
        endpoint: isSerenaReady ? 'http://127.0.0.1:19123/mcp' : null,
        pid: isSerenaReady ? 42117 : null,
        startedAt: isSerenaReady ? now - 6 * 60 * 60_000 : null,
        lastCheckedAt: now - 12_000,
        lastError: id === secondProjectId && !isSerenaReady ? 'Error loading configuration；原配置已保留，可重新检测' : null,
        lastLog: null,
        repairedConfigBackup: null
      },
      lastError: null
    };
  };

  const projectDashboard = (id: string): ProjectDashboard => {
    const projectSummary = summary(id);
    const projectSnapshots = snapshots.get(id) ?? [];
    return {
      project: projectSummary,
      config: { ...(configs.get(id) as ProjectRegistrationInput) },
      status: running.has(id) ? {
        state: 'ready',
        projectRoot: projectSummary.root,
        storageRoot: projectSummary.storageRoot,
        externalStorage: true,
        snapshotCount: projectSnapshots.length,
        latestSnapshot: projectSnapshots[0] ?? null,
        currentMatchesSnapshot: id === secondProjectId ? null : projectSnapshots[0] ?? null,
        currentTreeHash: projectSnapshots[0]?.treeHash ?? ''.padEnd(64, '0'),
        hasUncheckpointedChanges: id === secondProjectId,
        hashAlgorithm: 'sha256',
        lastRecovery: null
      } : null,
      snapshots: projectSnapshots,
      recovery: recoveries.get(id) ?? readyRecovery()
    };
  };

  const dashboard = (): DesktopDashboard => ({
    schemaVersion: 2,
    appVersion: '3.1.0-preview',
    defaultStorageRoot: '/home/user/.config/CodeRecoder/backup-storage',
    window: { kind: 'main', projectId: null },
    selectedProjectId: selectedId,
    projects: [...configs.keys()].map(summary),
    selectedProject: selectedId && configs.has(selectedId) ? projectDashboard(selectedId) : null
  });
  const ok = <T>(message: string, data?: T): DesktopResult<T> => ({ success: true, message, data });

  return {
    bootstrap: async () => ok('预览数据已加载', structuredClone(dashboard())),
    refresh: async projectId => {
      if (projectId && configs.has(projectId)) selectedId = projectId;
      return ok('预览数据已刷新', structuredClone(dashboard()));
    },
    chooseDirectory: async kind => ok('目录已选择', { path: kind === 'project' ? '/home/user/work/new-project' : '/home/user/Backups/CodeRecoder' }),
    registerProject: async input => {
      const id = crypto.randomUUID();
      configs.set(id, { ...input });
      snapshots.set(id, [demoSnapshot(crypto.randomUUID(), Date.now(), 'activation', 'Activation baseline')]);
      running.add(id);
      if (input.serenaEnabled) serenaReady.add(id);
      recoveries.set(id, readyRecovery());
      selectedId = id;
      return ok('工程保护已启动', { projectId: id });
    },
    selectProject: async id => {
      selectedId = id;
      return ok('工程已选择', structuredClone(dashboard()));
    },
    startProject: async id => {
      running.add(id);
      if (configs.get(id)?.serenaEnabled) serenaReady.add(id);
      return ok('工程保护已启动');
    },
    stopProject: async ({ projectId }) => {
      running.delete(projectId);
      serenaReady.delete(projectId);
      return ok('工程监控已安全停止');
    },
    removeProject: async ({ projectId }) => {
      configs.delete(projectId); snapshots.delete(projectId); running.delete(projectId);
      serenaReady.delete(projectId); recoveries.delete(projectId);
      selectedId = configs.keys().next().value ?? null;
      return ok('工程已移除');
    },
    openProjectWindow: async () => ok('工程窗口已打开'),
    createSnapshot: async input => {
      const list = snapshots.get(input.projectId) ?? [];
      list.unshift(demoSnapshot(crypto.randomUUID(), Date.now(), 'manual', input.name ?? 'Manual backup'));
      snapshots.set(input.projectId, list);
      return ok('Verified code backup created', { snapshot: list[0] });
    },
    verifySnapshot: async input => ok('备份验证通过', {
      snapshotId: input.snapshotId,
      verification: 'verified' as const,
      treeHash: snapshots.get(input.projectId)?.find(item => item.id === input.snapshotId)?.treeHash,
      verifiedEntries: 126
    }),
    previewRestore: async ({ projectId, snapshotId, mode }) => {
      lastRestoreMode = mode;
      recoveries.set(projectId, { state: 'preview-ready', title: '恢复预览等待确认', detail: '尚未修改工程文件；确认令牌将在五分钟后失效', occurredAt: Date.now(), snapshotId });
      return ok('恢复预览已生成', {
        state: 'restore_preview' as const,
        snapshotId,
        snapshotName: 'Verified snapshot',
        mode,
        changes: { added: ['src/new-feature.ts'], modified: ['src/index.ts', 'README.md'], deleted: ['src/old-adapter.ts'], renamed: [] },
        counts: { added: 1, modified: 2, deleted: 1, renamed: 0 },
        confirmationToken: crypto.randomUUID(),
        expiresAt: Date.now() + 5 * 60_000,
        requiresConfirmation: true as const
      });
    },
    restoreSnapshot: async ({ projectId, snapshotId }) => {
      const preRestoreSnapshotId = crypto.randomUUID();
      recoveries.set(projectId, { state: 'restored', title: '恢复完成并通过校验', detail: '目标快照已应用，恢复前安全备份已保留', occurredAt: Date.now(), snapshotId, preRestoreSnapshotId });
      return ok('代码恢复完成并通过校验', { state: 'restored_verified' as const, snapshotId, mode: lastRestoreMode, preRestoreSnapshotId, verification: 'verified' as const });
    },
    restartSerena: async id => {
      if (running.has(id) && configs.get(id)?.serenaEnabled) serenaReady.add(id);
      return ok('Serena 已通过 MCP initialize 握手', summary(id).serena);
    },
    inspectMcpEnvironment: async projectId => ok('MCP 环境检查完成', {
      checkedAt: Date.now(), projectId: projectId ?? null, ready: true,
      items: [
        { id: 'node' as const, label: 'Node.js', status: 'available' as const, required: true, path: '/usr/bin/node', version: '22.20.0', detail: '满足要求' },
        { id: 'server-build' as const, label: 'CodeRecoder MCP 构建', status: 'available' as const, required: true, path: '/workspace/dist/index.js', version: null, detail: 'stdio 服务入口可用' },
        { id: 'serena' as const, label: 'Serena CLI', status: 'available' as const, required: false, path: '/home/user/.local/bin/serena', version: '1.7.1', detail: 'CLI 可用' },
        { id: 'serena-project' as const, label: 'Serena 工程配置', status: projectId ? 'available' as const : 'warning' as const, required: false, path: projectId ? '/project/.serena/project.yml' : null, version: null, detail: '工程配置' },
        ...([
          ['vscode', 'Visual Studio Code'],
          ['cursor', 'Cursor'],
          ['claude-code', 'Claude Code'],
          ['codex', 'Codex CLI']
        ] as const).map(([id, label]) => ({ id, label, status: 'available' as const, required: false, path: `/usr/bin/${id}`, version: 'installed', detail: '本机客户端可用' }))
      ]
    }),
    getMcpRecommendation: async input => ok('配置建议已生成', demoRecommendation(input.target, input.service, input.projectId)),
    copyMcpRecommendation: async () => ok('配置建议已复制到剪贴板'),
    onStateChanged: () => () => undefined
  };
}

function demoRecommendation(target: McpRecommendation['target'], service: McpRecommendation['service'], projectId?: string): McpRecommendation {
  const command = service === 'coderecorder' ? '/usr/bin/node' : '/home/user/.local/bin/serena';
  const args = service === 'coderecorder'
    ? ['/workspace/dist/index.js']
    : [
        'start-mcp-server',
        '--context',
        target === 'codex' ? 'codex' : 'ide',
        '--project',
        '/workspace',
        '--enable-web-dashboard',
        'false',
        '--open-web-dashboard',
        'false',
        '--enable-gui-log-window',
        'false'
      ];
  const isJson = target === 'vscode' || target === 'cursor';
  const json = target === 'vscode'
    ? { servers: { [service]: { type: 'stdio', command, args } } }
    : { mcpServers: { [service]: { command, args } } };
  const clientCommand = target === 'codex' ? 'codex' : 'claude';
  const cliTokens = [clientCommand, 'mcp', 'add', ...(target === 'claude-code' ? ['--scope', 'user'] : []), service, '--', command, ...args];
  return {
    target,
    service,
    title: `${target} · ${service}`,
    format: isJson ? 'json' : 'shell',
    configPath: target === 'vscode'
      ? '.vscode/mcp.json'
      : target === 'cursor'
        ? '~/.cursor/mcp.json'
        : target === 'claude-code'
          ? '~/.claude.json（通过 CLI）'
          : '~/.codex/config.toml（通过 CLI）',
    content: isJson ? `${JSON.stringify(json, null, 2)}\n` : cliTokens.join(' '),
    notes: ['不会自动覆盖现有客户端配置。', '恢复与删除工具不要设置为无条件自动批准。'],
    endpoint: service === 'serena' && projectId ? 'http://127.0.0.1:19123/mcp' : null,
    endpointIsTemporary: service === 'serena' && Boolean(projectId)
  };
}

function unavailableApi(): CodeRecoderDesktopApi {
  const unavailable = async <T = unknown>(): Promise<DesktopResult<T>> => ({ success: false, message: '桌面桥接不可用', error: '请通过 Electron 启动 CodeRecoder Desktop' });
  return {
    bootstrap: async () => await unavailable<DesktopDashboard>(),
    chooseDirectory: async () => await unavailable<{ path: string | null }>(),
    registerProject: async () => await unavailable<{ projectId: string }>(),
    selectProject: async () => await unavailable<DesktopDashboard>(),
    startProject: async () => await unavailable(),
    stopProject: async () => await unavailable(),
    removeProject: async () => await unavailable(),
    openProjectWindow: async () => await unavailable(),
    refresh: async () => await unavailable<DesktopDashboard>(),
    createSnapshot: async () => await unavailable(),
    verifySnapshot: async () => await unavailable<VerificationOutcome>(),
    previewRestore: async () => await unavailable<RestorePreview>(),
    restoreSnapshot: async () => await unavailable<RestoreOutcome>(),
    restartSerena: async () => await unavailable(),
    inspectMcpEnvironment: async () => await unavailable(),
    getMcpRecommendation: async () => await unavailable(),
    copyMcpRecommendation: async () => await unavailable(),
    onStateChanged: () => () => undefined
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
