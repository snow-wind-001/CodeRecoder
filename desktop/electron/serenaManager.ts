import { spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { SerenaStatus } from '../shared/contracts.js';

const MAX_LOG_LENGTH = 12_000;

export interface SerenaManagerOptions {
  projectRoot: string;
  enabled: boolean;
  autoConfigure: boolean;
  commandPath?: string | null;
  startupTimeoutMs?: number;
  onChange?: (status: SerenaStatus) => void;
}

export class SerenaProcessManager {
  private readonly projectRoot: string;
  private readonly enabled: boolean;
  private readonly autoConfigure: boolean;
  private readonly preferredCommandPath: string | null | undefined;
  private readonly startupTimeoutMs: number;
  private readonly onChange?: SerenaManagerOptions['onChange'];
  private child?: ChildProcess;
  private commandPath: string | null = null;
  private endpoint: string | null = null;
  private state: SerenaStatus['state'];
  private startedAt: number | null = null;
  private lastCheckedAt: number | null = null;
  private lastError: string | null = null;
  private logBuffer = '';
  private repairedConfigBackup: string | null = null;
  private stopping = false;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: SerenaManagerOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.enabled = options.enabled;
    this.autoConfigure = options.autoConfigure;
    this.preferredCommandPath = options.commandPath;
    this.startupTimeoutMs = Math.max(1_000, options.startupTimeoutMs ?? 15_000);
    this.onChange = options.onChange;
    this.state = options.enabled ? 'stopped' : 'disabled';
  }

  async start(): Promise<SerenaStatus> {
    return await this.serialize(async () => await this.startInternal(true));
  }

  async restart(): Promise<SerenaStatus> {
    return await this.serialize(async () => {
      await this.stopInternal(false);
      return await this.startInternal(true);
    });
  }

  async stop(): Promise<void> {
    await this.serialize(async () => await this.stopInternal(true));
  }

  getStatus(): SerenaStatus {
    return {
      state: this.state,
      enabled: this.enabled,
      autoConfigure: this.autoConfigure,
      cliPath: this.commandPath,
      configPath: path.join(this.projectRoot, '.serena', 'project.yml'),
      endpoint: this.endpoint,
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastCheckedAt: this.lastCheckedAt,
      lastError: this.lastError,
      lastLog: this.lastLogLine(),
      repairedConfigBackup: this.repairedConfigBackup
    };
  }

  private async startInternal(allowRepair: boolean): Promise<SerenaStatus> {
    if (!this.enabled) {
      this.state = 'disabled';
      this.emitChange();
      return this.getStatus();
    }

    if (this.child && this.state === 'ready') return this.getStatus();
    await this.stopChild();
    this.state = 'checking';
    this.lastError = null;
    this.logBuffer = '';
    this.endpoint = null;
    this.startedAt = null;
    this.emitChange();

    try {
      this.commandPath = await this.resolveCommandPath();
      if (!this.commandPath) {
        throw new Error('未找到 Serena CLI；请安装 Serena，或将 serena 加入 PATH');
      }

      await this.ensureProjectConfiguration();
      await this.launchServer();
      if (!this.child || this.child.exitCode !== null) {
        throw new Error(`Serena 在握手后退出${this.lastLogLine() ? `：${this.lastLogLine()}` : ''}`);
      }
      this.state = 'ready';
      this.startedAt = Date.now();
      this.lastCheckedAt = Date.now();
      this.lastError = null;
      this.emitChange();
      return this.getStatus();
    } catch (error) {
      const message = this.errorMessage(error);
      if (allowRepair && this.autoConfigure && this.isConfigurationFailure(message)) {
        try {
          await this.repairProjectConfiguration();
          return await this.startInternal(false);
        } catch (repairError) {
          this.appendLog(`Automatic Serena configuration repair failed: ${this.errorMessage(repairError)}`);
        }
      }
      await this.stopChild();
      this.state = 'degraded';
      this.lastCheckedAt = Date.now();
      this.lastError = message;
      this.emitChange();
      return this.getStatus();
    }
  }

  private async stopInternal(updateState: boolean): Promise<void> {
    await this.stopChild();
    this.endpoint = null;
    this.startedAt = null;
    if (updateState) {
      this.state = this.enabled ? 'stopped' : 'disabled';
      this.emitChange();
    }
  }

  private async ensureProjectConfiguration(): Promise<void> {
    const configPath = path.join(this.projectRoot, '.serena', 'project.yml');
    try {
      const stat = await nodeFs.stat(configPath);
      if (!stat.isFile()) throw new Error('Serena 工程配置不是普通文件');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    if (!this.autoConfigure) {
      throw new Error(`缺少 Serena 工程配置：${configPath}`);
    }
    this.state = 'configuring';
    this.emitChange();
    await this.runCli(['project', 'create', this.projectRoot], 60_000);
  }

  private async repairProjectConfiguration(): Promise<void> {
    const configPath = path.join(this.projectRoot, '.serena', 'project.yml');
    const stat = await nodeFs.lstat(configPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('拒绝自动替换非普通文件或符号链接形式的 Serena 配置');
    }

    await this.stopChild();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.coderecoder-invalid-${stamp}.bak`;
    await nodeFs.rename(configPath, backupPath);
    try {
      this.state = 'configuring';
      this.emitChange();
      await this.runCli(['project', 'create', this.projectRoot], 60_000);
      this.repairedConfigBackup = backupPath;
      this.appendLog(`Invalid Serena project configuration preserved at ${backupPath}`);
    } catch (error) {
      await nodeFs.rename(backupPath, configPath).catch(() => undefined);
      throw error;
    }
  }

  private async launchServer(): Promise<void> {
    if (!this.commandPath) throw new Error('Serena CLI is unavailable');
    const port = await this.reservePort();
    this.endpoint = `http://127.0.0.1:${port}/mcp`;
    this.state = 'starting';
    this.emitChange();

    const args = [
      'start-mcp-server',
      '--project',
      this.projectRoot,
      '--context',
      'codex',
      '--transport',
      'streamable-http',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--enable-web-dashboard',
      'false',
      '--open-web-dashboard',
      'false',
      '--enable-gui-log-window',
      'false'
    ];

    const child = spawn(this.commandPath, args, {
      cwd: this.projectRoot,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;
    this.stopping = false;
    child.stdout?.on('data', chunk => this.appendLog(String(chunk)));
    child.stderr?.on('data', chunk => this.appendLog(String(chunk)));
    child.once('error', error => {
      this.appendLog(this.errorMessage(error));
      if (this.child === child) this.child = undefined;
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.endpoint = null;
      this.startedAt = null;
      if (!this.stopping) {
        this.state = 'degraded';
        this.lastCheckedAt = Date.now();
        this.lastError = `Serena 进程意外退出（code=${String(code)}, signal=${String(signal)}）${this.lastLogLine() ? `：${this.lastLogLine()}` : ''}`;
        this.emitChange();
      }
    });

    await this.waitForReady(child);
  }

  private async waitForReady(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (this.child !== child || child.exitCode !== null) {
        throw new Error(`Serena 启动失败${this.lastLogLine() ? `：${this.lastLogLine()}` : ''}`);
      }
      if (await this.probeEndpoint()) return;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error(`Serena MCP initialize 握手超时${this.lastLogLine() ? `：${this.lastLogLine()}` : ''}`);
  }

  private async probeEndpoint(): Promise<boolean> {
    if (!this.endpoint) return false;
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'coderecoder-desktop', version: '3.0.0' }
          }
        }),
        signal: AbortSignal.timeout(1_000)
      });
      const contentType = response.headers.get('content-type') ?? '';
      const body = await response.text();
      this.lastCheckedAt = Date.now();
      if (!response.ok) return false;
      const payloads = contentType.includes('text/event-stream')
        ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
        : [body];
      return payloads.some(payload => {
        try {
          const parsed = JSON.parse(payload) as { result?: unknown; error?: unknown };
          return parsed.result !== undefined && parsed.error === undefined;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  private async runCli(args: string[], timeoutMs: number): Promise<string> {
    if (!this.commandPath) throw new Error('Serena CLI is unavailable');
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(this.commandPath as string, args, {
        cwd: this.projectRoot,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      let settled = false;
      const append = (chunk: unknown): void => {
        output = `${output}${String(chunk)}`.slice(-MAX_LOG_LENGTH);
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Serena command timed out: ${output.trim()}`));
      }, timeoutMs);
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
        this.appendLog(output);
        if (code === 0) resolve(output);
        else reject(new Error(`Serena command failed (${String(code)}): ${output.trim()}`));
      });
    });
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.child = undefined;
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise<void>(resolve => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      child.once('exit', finish);
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        finish();
      }, 2_000);
    });
    this.stopping = false;
  }

  private async reservePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('无法分配 Serena 本地端口'));
          return;
        }
        const port = address.port;
        server.close(error => error ? reject(error) : resolve(port));
      });
    });
  }

  private async resolveCommandPath(): Promise<string | null> {
    if (this.preferredCommandPath === null) return null;
    const candidates: string[] = [];
    if (this.preferredCommandPath) candidates.push(this.preferredCommandPath);
    const configured = process.env.CODERECODER_SERENA_PATH;
    if (configured && path.isAbsolute(configured)) candidates.push(configured);
    candidates.push(path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'serena.exe' : 'serena'));
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      if (directory && path.isAbsolute(directory)) {
        candidates.push(path.join(directory, process.platform === 'win32' ? 'serena.exe' : 'serena'));
      }
    }
    candidates.push('/usr/local/bin/serena', '/usr/bin/serena');

    for (const candidate of [...new Set(candidates)]) {
      if (!path.isAbsolute(candidate)) continue;
      try {
        await nodeFs.access(candidate, fsConstants.X_OK);
        const stat = await nodeFs.stat(candidate);
        if (stat.isFile()) return await nodeFs.realpath(candidate);
      } catch {
        // Continue through the fixed candidate list.
      }
    }
    return null;
  }

  private isConfigurationFailure(message: string): boolean {
    const combined = `${message}\n${this.logBuffer}`.toLowerCase();
    const globalConfig = path.join(os.homedir(), '.serena', 'serena_config.yml').toLowerCase();
    const projectConfig = path.join(this.projectRoot, '.serena', 'project.yml').toLowerCase();
    if (combined.includes(globalConfig) && !combined.includes(projectConfig)) return false;
    return combined.includes('error loading configuration')
      || combined.includes('project configuration')
      || combined.includes('validation error');
  }

  private appendLog(value: string): void {
    const normalized = value.replace(/\u001b\[[0-9;]*m/g, '');
    this.logBuffer = `${this.logBuffer}${normalized}`.slice(-MAX_LOG_LENGTH);
  }

  private lastLogLine(): string | null {
    const lines = this.logBuffer.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const line = lines.at(-1);
    return line ? line.slice(0, 600) : null;
  }

  private emitChange(): void {
    this.onChange?.(this.getStatus());
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.operationTail.then(operation, operation);
    this.operationTail = scheduled.then(() => undefined, () => undefined);
    return await scheduled;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
