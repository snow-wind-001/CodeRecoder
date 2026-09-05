import { spawn } from 'node:child_process';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  EnvironmentCheckItem,
  McpClientTarget,
  McpEnvironmentReport,
  McpRecommendation,
  McpServiceTarget,
  ProjectId,
  SerenaStatus
} from '../shared/contracts.js';

interface McpProjectContext {
  id: ProjectId;
  root: string;
  serena: SerenaStatus;
}

interface ToolDescriptor {
  id: EnvironmentCheckItem['id'];
  label: string;
  executable: string;
  versionArgs: string[];
}

const CLIENT_TOOLS: ToolDescriptor[] = [
  { id: 'vscode', label: 'Visual Studio Code', executable: 'code', versionArgs: ['--version'] },
  { id: 'cursor', label: 'Cursor', executable: 'cursor', versionArgs: ['--version'] },
  { id: 'claude-code', label: 'Claude Code', executable: 'claude', versionArgs: ['--version'] },
  { id: 'codex', label: 'Codex CLI', executable: 'codex', versionArgs: ['--version'] }
];

export class McpIntegrationService {
  private readonly repositoryRoot: string;
  private readonly serverEntry: string;

  constructor(repositoryRoot: string) {
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.serverEntry = path.join(this.repositoryRoot, 'dist', 'index.js');
  }

  async inspect(project: McpProjectContext | null): Promise<McpEnvironmentReport> {
    const nodePath = await this.findExecutable('node');
    const nodeVersionOutput = nodePath ? await this.readVersion(nodePath, ['--version']) : null;
    const nodeVersion = nodeVersionOutput?.replace(/^v/, '') ?? null;
    const nodeReady = nodePath !== null
      && nodeVersion !== null
      && this.compareVersions(nodeVersion, '22.12.0') >= 0;
    const serverReady = await this.isFile(this.serverEntry);
    const serenaPath = project?.serena.cliPath ?? await this.findExecutable('serena');
    const serenaVersion = serenaPath ? await this.readVersion(serenaPath, ['--version']) : null;
    const serenaConfig = project ? path.join(project.root, '.serena', 'project.yml') : null;
    const serenaConfigReady = serenaConfig ? await this.isFile(serenaConfig) : false;

    const items: EnvironmentCheckItem[] = [
      {
        id: 'node',
        label: 'Node.js',
        status: nodeReady ? 'available' : 'warning',
        required: true,
        path: nodePath,
        version: nodeVersion,
        detail: nodeReady
          ? '满足 Node.js 22.12+ 要求'
          : nodePath ? '版本低于 22.12.0，可能无法运行当前构建' : 'PATH 中缺少独立 node 可执行文件'
      },
      {
        id: 'server-build',
        label: 'CodeRecoder MCP 构建',
        status: serverReady ? 'available' : 'missing',
        required: true,
        path: this.serverEntry,
        version: null,
        detail: serverReady ? 'stdio 服务入口可用' : '缺少 dist/index.js，请先运行 npm run build'
      },
      {
        id: 'serena',
        label: 'Serena CLI',
        status: serenaPath ? 'available' : 'missing',
        required: false,
        path: serenaPath,
        version: serenaVersion,
        detail: serenaPath ? 'CLI 可用于客户端连接和桌面 sidecar' : '未在安全候选路径或 PATH 中找到 serena'
      },
      {
        id: 'serena-project',
        label: 'Serena 工程配置',
        status: !project ? 'warning' : serenaConfigReady ? 'available' : 'missing',
        required: false,
        path: serenaConfig,
        version: null,
        detail: !project
          ? '选择工程后检查 .serena/project.yml'
          : serenaConfigReady
            ? '工程配置文件存在'
            : '配置缺失；启用自动配置后可由桌面端创建'
      }
    ];

    const clientItems = await Promise.all(CLIENT_TOOLS.map(async tool => {
      const executable = await this.findExecutable(tool.executable);
      return {
        id: tool.id,
        label: tool.label,
        status: executable ? 'available' : 'missing',
        required: false,
        path: executable,
        version: executable ? await this.readVersion(executable, tool.versionArgs) : null,
        detail: executable ? '本机客户端可用' : `未在 PATH 中找到 ${tool.executable}`
      } satisfies EnvironmentCheckItem;
    }));
    items.push(...clientItems);

    return {
      checkedAt: Date.now(),
      projectId: project?.id ?? null,
      ready: items.filter(item => item.required).every(item => item.status === 'available'),
      items
    };
  }

  async recommendation(
    target: McpClientTarget,
    service: McpServiceTarget,
    project: McpProjectContext | null
  ): Promise<McpRecommendation> {
    if (service === 'serena' && !project) {
      throw new Error('生成 Serena 配置前必须选择一个工程');
    }
    const command = service === 'coderecorder'
      ? await this.findExecutable('node') ?? 'node'
      : project?.serena.cliPath ?? await this.findExecutable('serena') ?? 'serena';
    const args = service === 'coderecorder'
      ? [this.serverEntry]
      : [
          'start-mcp-server',
          '--context',
          target === 'codex' ? 'codex' : 'ide',
          '--project',
          project?.root as string,
          '--enable-web-dashboard',
          'false',
          '--open-web-dashboard',
          'false',
          '--enable-gui-log-window',
          'false'
        ];
    const serverName = service;
    const endpoint = service === 'serena' ? project?.serena.endpoint ?? null : null;
    const notes = service === 'coderecorder'
      ? [
          '连接后由客户端调用 activate_project 选择工程；恢复与删除工具不要设置为无条件自动批准。',
          '修改 TypeScript 源码后先运行 npm run build，配置不应指向 src/index.ts。'
        ]
      : [
          '推荐使用 stdio 配置；Electron 显示的 HTTP endpoint 只在当前工程会话存活期间有效。',
          '若出现 Error loading configuration，请在桌面端查看 Serena 状态并使用“重新检测/启动”。'
        ];

    if (target === 'vscode' || target === 'cursor') {
      const content = target === 'vscode'
        ? JSON.stringify({
            servers: {
              [serverName]: { type: 'stdio', command, args }
            }
          }, null, 2)
        : JSON.stringify({
            mcpServers: {
              [serverName]: { command, args }
            }
          }, null, 2);
      return {
        target,
        service,
        title: `${target === 'vscode' ? 'VS Code' : 'Cursor'} · ${this.serviceLabel(service)}`,
        format: 'json',
        configPath: target === 'vscode' ? '.vscode/mcp.json' : '~/.cursor/mcp.json',
        content: `${content}\n`,
        notes,
        endpoint,
        endpointIsTemporary: endpoint !== null
      };
    }

    const clientCommand = target === 'claude-code' ? 'claude' : 'codex';
    const scope = target === 'claude-code' ? ['--scope', 'user'] : [];
    const tokens = [clientCommand, 'mcp', 'add', ...scope, serverName, '--', command, ...args];
    return {
      target,
      service,
      title: `${target === 'claude-code' ? 'Claude Code' : 'Codex'} · ${this.serviceLabel(service)}`,
      format: 'shell',
      configPath: target === 'claude-code' ? '~/.claude.json（通过 CLI）' : '~/.codex/config.toml（通过 CLI）',
      content: tokens.map(token => this.shellQuote(token)).join(' '),
      notes,
      endpoint,
      endpointIsTemporary: endpoint !== null
    };
  }

  projectContext(id: ProjectId, root: string, serena: SerenaStatus): McpProjectContext {
    return { id, root, serena };
  }

  private async findExecutable(name: string): Promise<string | null> {
    const executableName = process.platform === 'win32' ? `${name}.exe` : name;
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', executableName),
      ...((process.env.PATH ?? '').split(path.delimiter)
        .filter(directory => directory && path.isAbsolute(directory))
        .map(directory => path.join(directory, executableName))),
      path.join('/usr/local/bin', executableName),
      path.join('/usr/bin', executableName)
    ];
    for (const candidate of [...new Set(candidates)]) {
      try {
        await nodeFs.access(candidate, fsConstants.X_OK);
        const stat = await nodeFs.stat(candidate);
        if (stat.isFile()) return await nodeFs.realpath(candidate);
      } catch {
        // Keep searching fixed locations without invoking a shell.
      }
    }
    return null;
  }

  private async readVersion(command: string, args: string[]): Promise<string | null> {
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: this.repositoryRoot,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        let value = '';
        let settled = false;
        const append = (chunk: unknown): void => {
          value = `${value}${String(chunk)}`.slice(-2_000);
        };
        child.stdout?.on('data', append);
        child.stderr?.on('data', append);
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill('SIGKILL');
          reject(new Error('version check timed out'));
        }, 4_000);
        child.once('error', error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', code => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (code === 0) resolve(value.trim());
          else reject(new Error(value.trim()));
        });
      });
      return output.split(/\r?\n/)[0]?.trim().slice(0, 120) || null;
    } catch {
      return null;
    }
  }

  private async isFile(filePath: string): Promise<boolean> {
    try {
      return (await nodeFs.stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  private compareVersions(first: string, second: string): number {
    const a = first.split('.').map(value => Number.parseInt(value, 10));
    const b = second.split('.').map(value => Number.parseInt(value, 10));
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (a[index] ?? 0) - (b[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  private serviceLabel(service: McpServiceTarget): string {
    return service === 'coderecorder' ? 'CodeRecoder' : 'Serena';
  }

  private shellQuote(value: string): string {
    if (/^[a-zA-Z0-9_./:@=+-]+$/.test(value)) return value;
    return `'${value.replaceAll("'", "'\\''")}'`;
  }
}
