import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SerenaInstallation {
  path: string;
  logPath: string;
}

export class SerenaInstaller {
  private pending: Promise<SerenaInstallation> | undefined;
  private child: ChildProcess | undefined;
  private stopped = false;

  constructor(private readonly scriptPath: string, private readonly logDirectory: string) {}

  install(): Promise<SerenaInstallation> {
    if (this.stopped) return Promise.reject(new Error('应用正在退出，已取消 Serena 安装。'));
    if (!this.pending) {
      this.pending = this.run().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  stop(): void {
    this.stopped = true;
    if (this.child) this.terminate(this.child);
  }

  private terminate(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
  }

  private async run(): Promise<SerenaInstallation> {
    if (process.platform !== 'linux') throw new Error('内置 Serena 安装器目前支持 Linux。');
    await fs.access(this.scriptPath, constants.R_OK);
    await fs.mkdir(this.logDirectory, { recursive: true });
    if (this.stopped) throw new Error('应用正在退出，已取消 Serena 安装。');
    const logPath = path.join(this.logDirectory, 'serena-install.log');
    const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
    log.write(`\n[${new Date().toISOString()}] Installing Serena\n`);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/bin/bash', [this.scriptPath], {
          cwd: os.homedir(),
          shell: false,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        this.child = child;
        let failure: Error | undefined;
        let killTimer: NodeJS.Timeout | undefined;
        const cancel = (): void => {
          this.terminate(child);
          killTimer ??= setTimeout(() => this.terminate(child, 'SIGKILL'), 2_000);
          killTimer.unref();
        };
        const timer = setTimeout(() => {
          failure = new Error(`Serena 安装超时，日志：${logPath}`);
          cancel();
        }, 15 * 60_000);
        // stop() may be called while a downloader ignores SIGTERM.
        const stoppingCheck = setInterval(() => { if (this.stopped) cancel(); }, 250);
        log.once('error', error => { failure = error; cancel(); });
        child.stdout?.on('data', chunk => log.write(chunk));
        child.stderr?.on('data', chunk => log.write(chunk));
        child.once('error', error => { failure = error; });
        child.once('close', code => {
          clearTimeout(timer);
          clearTimeout(killTimer);
          clearInterval(stoppingCheck);
          if (failure) reject(failure);
          else if (code === 0) resolve();
          else reject(new Error(`Serena 安装未完成，请检查网络。日志：${logPath}`));
        });
      });
      const executable = path.join(os.homedir(), '.local', 'bin', 'serena');
      await fs.access(executable, constants.X_OK);
      return { path: executable, logPath };
    } finally {
      this.child = undefined;
      await new Promise<void>(resolve => {
        if (log.destroyed) resolve();
        else log.end(() => resolve());
      });
    }
  }
}
