import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProjectSessionRegistry } from '../desktop/electron/projectSessionRegistry.js';
import { SerenaProcessManager } from '../desktop/electron/serenaManager.js';
import { McpIntegrationService } from '../desktop/electron/mcpIntegrationService.js';
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

  const vscode = await advisor.recommendation('vscode', 'coderecorder', null);
  const vscodeConfig = JSON.parse(vscode.content) as { servers: { coderecorder: { command: string; args: string[] } } };
  assert.match(vscodeConfig.servers.coderecorder.command, /node$/);
  assert.equal(vscodeConfig.servers.coderecorder.args[0], path.join(repositoryRoot, 'dist', 'index.js'));

  const cursor = await advisor.recommendation('cursor', 'coderecorder', null);
  const cursorConfig = JSON.parse(cursor.content) as { mcpServers: { coderecorder: unknown } };
  assert.ok(cursorConfig.mcpServers.coderecorder);

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
    const codeRecoder = await advisor.recommendation(target, 'coderecorder', project);
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
