import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectSessionRegistry } from '../desktop/electron/projectSessionRegistry.js';
import { ProjectSession } from '../desktop/electron/projectSession.js';
import { OperationScheduler } from '../desktop/electron/operationScheduler.js';
import { BackupManager } from '../src/backupManager.js';
import { SerenaProcessManager } from '../desktop/electron/serenaManager.js';
import { McpIntegrationService } from '../desktop/electron/mcpIntegrationService.js';
import { PreferenceStore } from '../desktop/electron/preferenceStore.js';
import type { DesktopPreferences } from '../desktop/electron/preferenceStore.js';
import { SerenaInstaller } from '../desktop/electron/serenaInstaller.js';
import {
  assertMainWindow,
  assertProjectAccess,
  resolveProjectForScope
} from '../desktop/electron/windowAuthorization.js';
import type {
  DesktopDashboard,
  DesktopResult,
  ProjectDashboard,
  RestorePreview,
  SnapshotSummary
} from '../desktop/shared/contracts.js';

const mainScope = { kind: 'main' as const, projectId: null };

function requireData<T>(response: DesktopResult<T>): T {
  assert.equal(response.success, true, response.error ?? response.message);
  assert.ok(response.data);
  return response.data;
}

async function dashboardFor(registry: ProjectSessionRegistry, projectId?: string): Promise<DesktopDashboard> {
  return requireData(await registry.dashboard(mainScope, projectId, true));
}

test('multi-project registry isolates backups, restore state, and stop lifecycle', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-desktop-registry-'));
  const projectA = path.join(fixtureRoot, 'project-a');
  const projectB = path.join(fixtureRoot, 'project-b');
  const storageRoot = path.join(fixtureRoot, 'storage');
  const preferencePath = path.join(fixtureRoot, 'preferences', 'desktop.json');
  await Promise.all([
    fs.mkdir(projectA, { recursive: true }),
    fs.mkdir(projectB, { recursive: true }),
    fs.mkdir(storageRoot, { recursive: true })
  ]);
  await fs.writeFile(path.join(projectA, 'source.ts'), 'export const version = 1;\n');
  await fs.writeFile(path.join(projectB, 'source.ts'), 'export const version = 10;\n');

  const registry = new ProjectSessionRegistry({
    appVersion: 'test',
    defaultStorageRoot: storageRoot,
    preferencePath,
    serenaCommandPath: null
  });
  t.after(async () => {
    await registry.shutdown();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  await registry.initialize();

  const register = async (projectPath: string): Promise<string> => {
    const response = await registry.registerProject({
      projectPath,
      storageRoot,
      autoCheckpoint: false,
      maxBackups: 20,
      startOnLaunch: true,
      serenaEnabled: true,
      serenaAutoConfigure: true
    });
    return requireData(response).projectId;
  };
  const projectAId = await register(projectA);
  const projectBId = await register(projectB);

  let all = await dashboardFor(registry, projectAId);
  assert.equal(all.projects.length, 2);
  assert.equal(all.selectedProject?.project.id, projectAId);
  assert.equal(all.selectedProject?.snapshots.length, 1);
  assert.equal(all.selectedProject?.project.protectionState, 'running');
  assert.equal(all.selectedProject?.project.serena.state, 'degraded');
  assert.equal(all.selectedProject?.project.lastError, null, 'Serena failure must not degrade backup health');
  const baselineA = all.selectedProject?.snapshots[0] as SnapshotSummary;

  await fs.writeFile(path.join(projectA, 'source.ts'), 'export const version = 2;\n');
  await fs.writeFile(path.join(projectB, 'source.ts'), 'export const version = 11;\n');
  requireData(await registry.createSnapshot(projectAId, { name: 'project A v2' }));
  requireData(await registry.createSnapshot(projectBId, { name: 'project B v11' }));

  const dashboardA = (await dashboardFor(registry, projectAId)).selectedProject as ProjectDashboard;
  const dashboardB = (await dashboardFor(registry, projectBId)).selectedProject as ProjectDashboard;
  assert.equal(dashboardA.snapshots.length, 2);
  assert.equal(dashboardB.snapshots.length, 2);
  assert.notEqual(dashboardA.project.storageRoot, dashboardB.project.storageRoot);

  const preview = requireData<RestorePreview>(await registry.previewRestore(projectAId, {
    snapshotId: baselineA.id,
    mode: 'exact'
  }));
  requireData(await registry.restoreSnapshot(projectAId, {
    snapshotId: baselineA.id,
    confirmationToken: preview.confirmationToken
  }));
  assert.equal(await fs.readFile(path.join(projectA, 'source.ts'), 'utf8'), 'export const version = 1;\n');
  assert.equal(await fs.readFile(path.join(projectB, 'source.ts'), 'utf8'), 'export const version = 11;\n');
  assert.equal((await dashboardFor(registry, projectAId)).selectedProject?.recovery.state, 'restored');

  requireData(await registry.stopProject(projectAId, false));
  all = await dashboardFor(registry, projectBId);
  assert.equal(all.projects.find(project => project.id === projectAId)?.protectionState, 'stopped');
  assert.equal(all.projects.find(project => project.id === projectBId)?.protectionState, 'running');
  assert.equal((await registry.createSnapshot(projectAId, {})).success, false);
  requireData(await registry.createSnapshot(projectBId, { name: 'still running' }));

  assert.equal((await fs.stat(preferencePath)).mode & 0o777, 0o600);
  const saved = JSON.parse(await fs.readFile(preferencePath, 'utf8')) as { schemaVersion: number; projects: Array<{ id: string; startOnLaunch: boolean }> };
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.projects.find(project => project.id === projectAId)?.startOnLaunch, false);
  assert.equal(saved.projects.find(project => project.id === projectBId)?.startOnLaunch, true);
});

test('registry rejects duplicate, nested, and unsafe storage paths', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-desktop-overlap-'));
  const parentProject = path.join(fixtureRoot, 'parent');
  const childProject = path.join(parentProject, 'packages', 'child');
  const independentProject = path.join(fixtureRoot, 'independent');
  const storageRoot = path.join(fixtureRoot, 'storage');
  await Promise.all([
    fs.mkdir(childProject, { recursive: true }),
    fs.mkdir(independentProject, { recursive: true }),
    fs.mkdir(storageRoot, { recursive: true })
  ]);
  await fs.writeFile(path.join(parentProject, 'index.ts'), 'export {};\n');
  await fs.writeFile(path.join(childProject, 'index.ts'), 'export {};\n');
  await fs.writeFile(path.join(independentProject, 'index.ts'), 'export {};\n');
  const registry = new ProjectSessionRegistry({
    appVersion: 'test',
    defaultStorageRoot: storageRoot,
    preferencePath: path.join(fixtureRoot, 'desktop.json'),
    serenaCommandPath: null
  });
  t.after(async () => {
    await registry.shutdown();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  await registry.initialize();
  const input = {
    projectPath: parentProject,
    storageRoot,
    autoCheckpoint: false,
    maxBackups: 20,
    startOnLaunch: false,
    serenaEnabled: false,
    serenaAutoConfigure: false
  };
  requireData(await registry.registerProject(input));
  const duplicate = await registry.registerProject(input);
  assert.equal(duplicate.success, false);
  assert.match(duplicate.error ?? '', /已经注册/);
  const nested = await registry.registerProject({ ...input, projectPath: childProject });
  assert.equal(nested.success, false);
  assert.match(nested.error ?? '', /父子嵌套/);
  const unsafeStorage = await registry.registerProject({
    ...input,
    projectPath: independentProject,
    storageRoot: path.join(independentProject, 'backups')
  });
  assert.equal(unsafeStorage.success, false);
  assert.match(unsafeStorage.error ?? '', /备份根目录/);
});

test('legacy single-project preferences migrate to schema v2 without auto-starting', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-desktop-migration-'));
  const projectRoot = path.join(fixtureRoot, 'project');
  const storageRoot = path.join(fixtureRoot, 'storage');
  const preferencePath = path.join(fixtureRoot, 'desktop.json');
  await Promise.all([fs.mkdir(projectRoot), fs.mkdir(storageRoot)]);
  await fs.writeFile(path.join(projectRoot, 'index.ts'), 'export {};\n');
  await fs.writeFile(preferencePath, `${JSON.stringify({
    projectPath: projectRoot,
    storageRoot,
    autoCheckpoint: true,
    maxBackups: 50
  }, null, 2)}\n`, { mode: 0o600 });

  const registry = new ProjectSessionRegistry({
    appVersion: 'test',
    defaultStorageRoot: storageRoot,
    preferencePath,
    serenaCommandPath: null
  });
  t.after(async () => {
    await registry.shutdown();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  await registry.initialize();
  const dashboard = await dashboardFor(registry);
  assert.equal(dashboard.projects.length, 1);
  assert.equal(dashboard.projects[0]?.protectionState, 'stopped');
  assert.equal(dashboard.projects[0]?.startOnLaunch, false);
  const saved = JSON.parse(await fs.readFile(preferencePath, 'utf8')) as { schemaVersion: number; projects: Array<{ serenaEnabled: boolean }> };
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.projects[0]?.serenaEnabled, true);
});

test('Serena manager creates missing config and preserves a broken config before repair', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-serena-repair-'));
  const projectRoot = path.join(fixtureRoot, 'project');
  const fakeSerena = path.join(fixtureRoot, 'serena');
  await fs.mkdir(projectRoot);
  await fs.writeFile(fakeSerena, `#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'project' && args[1] === 'create') {
  // Model Serena's optional-language prompt: EOF without an answer must abort.
  const answer = fs.readFileSync(0, 'utf8');
  if (!answer.startsWith('n\\n')) process.exit(4);
  const root = args[2];
  fs.mkdirSync(path.join(root, '.serena'), { recursive: true });
  fs.writeFileSync(path.join(root, '.serena', 'project.yml'), 'project_name: repaired\\nlanguage_servers: []\\n');
  process.exit(0);
}
if (args[0] !== 'start-mcp-server') process.exit(3);
const root = args[args.indexOf('--project') + 1];
const config = fs.readFileSync(path.join(root, '.serena', 'project.yml'), 'utf8');
if (config.includes('invalid')) {
  process.stderr.write('Error loading configuration: validation error\\n');
  process.exit(2);
}
const port = Number(args[args.indexOf('--port') + 1]);
const server = http.createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-serena', version: '1' } } }));
  });
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`, { mode: 0o700 });

  const first = new SerenaProcessManager({
    projectRoot,
    enabled: true,
    autoConfigure: true,
    commandPath: fakeSerena,
    startupTimeoutMs: 4_000
  });
  t.after(async () => {
    await first.stop();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  const created = await first.start();
  assert.equal(created.state, 'ready', created.lastError ?? 'Serena did not become ready');
  assert.match(await fs.readFile(path.join(projectRoot, '.serena', 'project.yml'), 'utf8'), /project_name/);
  await first.stop();

  await fs.writeFile(path.join(projectRoot, '.serena', 'project.yml'), 'invalid: [configuration\n');
  const repaired = await first.start();
  assert.equal(repaired.state, 'ready', repaired.lastError ?? 'Serena repair did not recover');
  assert.ok(repaired.repairedConfigBackup);
  assert.equal(await fs.readFile(repaired.repairedConfigBackup as string, 'utf8'), 'invalid: [configuration\n');
  assert.match(await fs.readFile(path.join(projectRoot, '.serena', 'project.yml'), 'utf8'), /repaired/);
});

test('MCP advisor uses an independent Node executable and valid client schemas', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const advisor = new McpIntegrationService(repositoryRoot);
  const report = await advisor.inspect(null);
  assert.deepEqual(report.items.map(item => item.id), [
    'node',
    'server-build',
    'serena',
    'serena-project',
    'vscode',
    'cursor',
    'claude-code',
    'codex'
  ]);
  const node = report.items.find(item => item.id === 'node');
  assert.equal(node?.status, 'available');
  assert.match(node?.path ?? '', /node$/);

  const vscode = await advisor.recommendation('vscode', 'coderecoder', null);
  const vscodeConfig = JSON.parse(vscode.content) as { servers: { coderecoder: { command: string; args: string[] } } };
  assert.match(vscodeConfig.servers.coderecoder.command, /node$/);
  assert.equal(vscodeConfig.servers.coderecoder.args[0], path.join(repositoryRoot, 'dist', 'index.js'));

  const cursor = await advisor.recommendation('cursor', 'coderecoder', null);
  const cursorConfig = JSON.parse(cursor.content) as { mcpServers: { coderecoder: unknown } };
  assert.ok(cursorConfig.mcpServers.coderecoder);

  const project = advisor.projectContext(
    'af420000-0000-4000-8000-00000000c91a',
    repositoryRoot,
    {
      state: 'ready',
      enabled: true,
      autoConfigure: true,
      cliPath: '/opt/serena/bin/serena',
      configPath: path.join(repositoryRoot, '.serena', 'project.yml'),
      endpoint: 'http://127.0.0.1:19123/mcp',
      pid: 1234,
      startedAt: Date.now(),
      lastCheckedAt: Date.now(),
      lastError: null,
      lastLog: null,
      repairedConfigBackup: null
    }
  );
  for (const target of ['vscode', 'cursor', 'claude-code', 'codex'] as const) {
    const codeRecoder = await advisor.recommendation(target, 'coderecoder', project);
    const serena = await advisor.recommendation(target, 'serena', project);
    assert.equal(codeRecoder.endpointIsTemporary, false);
    assert.equal(serena.endpointIsTemporary, true);
    assert.equal(serena.endpoint, project.serena.endpoint);
    assert.match(serena.content, /\/opt\/serena\/bin\/serena/);
    assert.match(serena.content, /start-mcp-server/);
    assert.doesNotMatch(serena.content, new RegExp(`${repositoryRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dist/index\\.js`));
    if (target === 'vscode' || target === 'cursor') {
      const parsed = JSON.parse(serena.content) as Record<string, Record<string, { command: string; args: string[]; type?: string }>>;
      const rootKey = target === 'vscode' ? 'servers' : 'mcpServers';
      assert.equal(parsed[rootKey]?.serena?.command, '/opt/serena/bin/serena');
      assert.ok(parsed[rootKey]?.serena?.args.includes('--project'));
      if (target === 'vscode') assert.equal(parsed[rootKey]?.serena?.type, 'stdio');
    } else {
      assert.match(serena.content, new RegExp(`^${target === 'codex' ? 'codex' : 'claude'} mcp add `));
      if (target === 'claude-code') assert.match(serena.content, /--scope user/);
      if (target === 'codex') assert.match(serena.content, /--context codex/);
    }
  }
});

test('packaged MCP advisor prefers the bundled runtime over a system Node.js', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-bundled-runtime-'));
  const launcher = path.join(fixtureRoot, 'coderecoder-mcp');
  const serverEntry = path.join(fixtureRoot, 'index.mjs');
  await fs.writeFile(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.writeFile(serverEntry, 'export {};\n');
  t.after(async () => await fs.rm(fixtureRoot, { recursive: true, force: true }));

  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const advisor = new McpIntegrationService(repositoryRoot, {
    bundledMcpLauncher: launcher,
    bundledNodeVersion: '24.14.0',
    serverEntry
  });
  const report = await advisor.inspect(null);
  const runtime = report.items.find(item => item.id === 'node');
  assert.equal(runtime?.label, '内置 MCP 运行时');
  assert.equal(runtime?.status, 'available');
  assert.equal(runtime?.version, '24.14.0');
  assert.match(runtime?.detail ?? '', /无需系统 Node\.js/);
  assert.equal(report.items.find(item => item.id === 'server-build')?.path, serverEntry);

  const vscode = await advisor.recommendation('vscode', 'coderecoder', null);
  const config = JSON.parse(vscode.content) as {
    servers: { coderecoder: { command: string; args: string[] } };
  };
  assert.equal(config.servers.coderecoder.command, await fs.realpath(launcher));
  assert.deepEqual(config.servers.coderecoder.args, []);
  assert.match(vscode.notes.join('\n'), /安装包已内置 MCP 运行时/);
});

test('packaged MCP recommendations use the installed launcher without source arguments', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-packaged-advisor-'));
  t.after(async () => await fs.rm(fixture, { recursive: true, force: true }));
  const launcher = path.join(fixture, 'coderecoder-mcp');
  await fs.writeFile(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const advisor = new McpIntegrationService(path.resolve(import.meta.dirname, '..'), { bundledMcpLauncher: launcher });
  const report = await advisor.inspect(null);
  assert.equal(report.ready, true);
  const recommendation = await advisor.recommendation('cursor', 'coderecoder', null);
  const config = JSON.parse(recommendation.content);
  assert.equal(config.mcpServers.coderecoder.command, launcher);
  assert.deepEqual(config.mcpServers.coderecoder.args, []);
});

test('Serena installer shares one download and preserves failure diagnostics', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-installer-'));
  const script = path.join(fixture, 'installer.sh');
  const installer = new SerenaInstaller(script, fixture);
  t.after(async () => { installer.stop(); await fs.rm(fixture, { recursive: true, force: true }); });
  await fs.writeFile(script, '#!/bin/sh\nprintf "simulated download failure\\n" >&2\nexit 17\n');
  const first = installer.install();
  assert.equal(installer.install(), first);
  await assert.rejects(first, /Serena 安装未完成/);
  const log = await fs.readFile(path.join(fixture, 'serena-install.log'), 'utf8');
  assert.match(log, /simulated download failure/);
  assert.equal(log.match(/Installing Serena/g)?.length, 1);
});

test('Serena installer stops a downloader that ignores SIGTERM', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-installer-stop-'));
  const script = path.join(fixture, 'installer.sh');
  const installer = new SerenaInstaller(script, fixture);
  t.after(async () => { installer.stop(); await fs.rm(fixture, { recursive: true, force: true }); });
  await fs.writeFile(script, '#!/bin/sh\ntrap "" TERM\nprintf "downloader ready\\n"\nsleep 30\n');
  const installation = installer.install();
  const rejected = assert.rejects(installation, /Serena 安装未完成/);
  const deadline = Date.now() + 5_000;
  while (!(await fs.readFile(path.join(fixture, 'serena-install.log'), 'utf8').catch(() => '')).includes('downloader ready')) {
    assert.ok(Date.now() < deadline, 'downloader did not start');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  installer.stop();
  await rejected;
  await assert.rejects(installer.install(), /已取消/);
});

test('project windows are bound to one session while the main window may coordinate all', () => {
  const projectA = 'af420000-0000-4000-8000-00000000c91a';
  const projectB = 'bb190000-0000-4000-8000-0000000072ef';
  const projectScope = { kind: 'project' as const, projectId: projectA };
  assert.equal(assertProjectAccess(projectScope, projectA), projectA);
  assert.throws(() => assertProjectAccess(projectScope, projectB), /different project session/);
  assert.throws(() => assertMainWindow(projectScope), /main window/);
  assert.equal(resolveProjectForScope(projectScope, undefined, projectB), projectA);
  assert.throws(() => resolveProjectForScope(projectScope, projectB, projectB), /different project session/);

  const main = { kind: 'main' as const, projectId: null };
  assert.doesNotThrow(() => assertMainWindow(main));
  assert.equal(assertProjectAccess(main, projectB), projectB);
  assert.equal(resolveProjectForScope(main, undefined, projectA), projectA);
});


test('backup filters persist per project and apply on the next protection start', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder_desktop_filter_'));
  const projectPath = path.join(fixtureRoot, 'project');
  const preferencePath = path.join(fixtureRoot, 'preferences.json');
  const options = { appVersion: 'test', defaultStorageRoot: path.join(fixtureRoot, 'storage'), preferencePath, serenaCommandPath: null };
  const registry = new ProjectSessionRegistry(options);
  await fs.mkdir(path.join(projectPath, 'output'), { recursive: true });
  await fs.writeFile(path.join(projectPath, 'main.ts'), 'source');
  await fs.writeFile(path.join(projectPath, 'model.pt'), 'weights');
  await fs.writeFile(path.join(projectPath, 'diagram.svg'), '<svg/>');
  await fs.writeFile(path.join(projectPath, 'output', 'result.json'), '{}');
  t.after(async () => {
    await registry.shutdown();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  await registry.initialize();
  const { projectId } = requireData(await registry.registerProject({
    projectPath, autoCheckpoint: false, maxBackups: 10, startOnLaunch: false,
    serenaEnabled: false, serenaAutoConfigure: false
  }));
  const before = (await dashboardFor(registry, projectId)).selectedProject!;
  assert.equal(before.config.backupScope, 'all');
  assert.equal(before.snapshots[0].totalFiles, 4);
  const rejected = await registry.updateBackupFilter(projectId, { excludePaths: ['../outside'] });
  assert.equal(rejected.success, false);
  const filter = { backupScope: 'code-and-docs', excludePaths: ['output/'], includeExtensions: ['.SVG'] };
  assert.equal((await registry.updateBackupFilter(projectId, filter)).success, true);
  const active = (await dashboardFor(registry, projectId)).selectedProject!;
  assert.equal(active.project.protectionState, 'running');
  assert.equal(active.status?.hasUncheckpointedChanges, false, 'running manager retains its original scope');
  assert.equal(active.config.backupScope, 'code-and-docs');
  assert.deepEqual(active.config.excludePaths, ['output']);
  assert.deepEqual(active.config.includeExtensions, ['svg']);
  await registry.stopProject(projectId, false);
  const restarted = new ProjectSessionRegistry(options);
  await restarted.initialize();
  try {
    assert.equal((await restarted.startProject(projectId)).success, true);
    const after = (await dashboardFor(restarted, projectId)).selectedProject!;
    assert.equal(after.config.backupScope, 'code-and-docs');
    assert.equal(after.snapshots[0].totalFiles, 2);
    assert.equal(after.snapshots.length, 2, 'old snapshot remains');
    const store = new PreferenceStore(preferencePath);
    assert.equal((await store.load()).preferences.projects[0].backupScope, 'code-and-docs');
  } finally {
    await restarted.shutdown();
  }
});

test('old schema-v2 project preferences still load with the original backup scope', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder_filter_compat_'));
  const projectPath = path.join(fixtureRoot, 'project');
  const preferencePath = path.join(fixtureRoot, 'preferences.json');
  const projectId = 'bc98ef01-0f73-4c45-b1d0-a8f0df2f7bbc';
  await fs.mkdir(projectPath);
  await fs.writeFile(preferencePath, JSON.stringify({
    schemaVersion: 2, selectedProjectId: projectId,
    projects: [{ id: projectId, registeredAt: 1, projectPath, autoCheckpoint: false,
      maxBackups: 10, startOnLaunch: false, serenaEnabled: false, serenaAutoConfigure: false }]
  }));
  const registry = new ProjectSessionRegistry({ appVersion: 'test', preferencePath,
    defaultStorageRoot: path.join(fixtureRoot, 'storage'), serenaCommandPath: null });
  t.after(async () => { await registry.shutdown(); await fs.rm(fixtureRoot, { recursive: true, force: true }); });
  await registry.initialize();
  const dashboard = await dashboardFor(registry, projectId);
  assert.equal(dashboard.projects.length, 1);
  assert.equal(dashboard.selectedProject?.config.backupScope, 'all');
  assert.deepEqual(dashboard.selectedProject?.config.excludePaths, []);
});


test('slow baselines do not block dashboard reads or independent Serena startup', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder_startup_'));
  const projectPath = path.join(root, 'project');
  await fs.mkdir(projectPath);
  await fs.writeFile(path.join(projectPath, 'main.ts'), 'source');
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const baselineEntered = new Promise<void>(resolve => { entered = resolve; });
  const original = BackupManager.prototype.createBackup;
  t.mock.method(BackupManager.prototype, 'createBackup', async function (this: BackupManager, options: Parameters<BackupManager['createBackup']>[0]) {
    entered(); await gate; return await original.call(this, options);
  });
  const serenaStart = t.mock.method(SerenaProcessManager.prototype, 'start');
  const session = new ProjectSession({ id: '11111111-1111-4111-8111-111111111111', registeredAt: Date.now(),
    config: { projectPath, storageRoot: path.join(root, 'storage'), autoCheckpoint: false,
      maxBackups: 10, startOnLaunch: false, serenaEnabled: true, serenaAutoConfigure: true },
    scheduler: new OperationScheduler(1), serenaCommandPath: null });
  const starting = session.start();
  try {
    await baselineEntered;
    const result = await Promise.race([session.dashboard(true), new Promise<null>(resolve => setTimeout(() => resolve(null), 250))]);
    assert.ok(result, 'dashboard must not wait behind a baseline');
    assert.equal(result.project.protectionState, 'starting');
    assert.equal(result.project.automaticCheckpoint.state, 'stopped');
    assert.equal(serenaStart.mock.callCount(), 1, 'Serena must start before the baseline completes');
    release();
    assert.equal((await starting).success, true);
  } finally {
    release(); await starting; await session.stop(false);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('dashboard refresh scans are coalesced and expose their freshness without blocking', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder_dashboard_'));
  const projectPath = path.join(root, 'project');
  await fs.mkdir(projectPath);
  await fs.writeFile(path.join(projectPath, 'main.ts'), 'source');
  const session = new ProjectSession({ id: '22222222-2222-4222-8222-222222222222', registeredAt: Date.now(),
    config: { projectPath, storageRoot: path.join(root, 'storage'), autoCheckpoint: false,
      maxBackups: 10, startOnLaunch: false, serenaEnabled: false, serenaAutoConfigure: false },
    scheduler: new OperationScheduler(1) });
  assert.equal((await session.start()).success, true);
  const before = await session.dashboard(false);
  assert.ok(before.statusCheckedAt);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const scanning = new Promise<void>(resolve => { entered = resolve; });
  const original = BackupManager.prototype.getStatus;
  const probe = t.mock.method(BackupManager.prototype, 'getStatus', async function (this: BackupManager) {
    entered(); await gate; return await original.call(this);
  });
  Reflect.set(session, 'lastCacheAttemptAt', 0);
  try {
    const refreshing = await session.dashboard(true);
    assert.equal(refreshing.statusRefreshing, true);
    await scanning;
    const cached = await session.dashboard(true);
    assert.equal(cached.statusCheckedAt, before.statusCheckedAt);
    assert.equal(probe.mock.callCount(), 1);
    release();
    const deadline = Date.now() + 3000;
    while ((await session.dashboard(false)).statusRefreshing) {
      assert.ok(Date.now() < deadline, 'background refresh did not settle');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await session.dashboard(true);
    assert.equal(probe.mock.callCount(), 1, 'state events must not create a scan loop');
  } finally {
    release(); await session.stop(false);
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('simultaneous preference writes are serialized and retain the newest settings', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder_preference_queue_'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PreferenceStore(path.join(root, 'preferences.json'));
  t.mock.method(Date, 'now', () => 1000);
  const base: DesktopPreferences = { schemaVersion: 2, selectedProjectId: null, projects: [{
    id: '33333333-3333-4333-8333-333333333333', registeredAt: 1, projectPath: path.join(root, 'project'),
    autoCheckpoint: true, maxBackups: 2, startOnLaunch: false, serenaEnabled: false, serenaAutoConfigure: false
  }] };
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.save({
    ...base, projects: [{ ...base.projects[0], maxBackups: index + 2 }]
  })));
  assert.equal((await store.load()).preferences.projects[0].maxBackups, 21);
  assert.deepEqual(await fs.readdir(root), ['preferences.json']);
});
