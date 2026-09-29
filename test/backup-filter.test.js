import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupManager } from '../dist/backupManager.js';
import { AutoCheckpointManager } from '../dist/autoCheckpointManager.js';
import { normalizeBackupFilter } from '../dist/backupFilter.js';

function data(response) {
  assert.equal(response.success, true, response.error ?? response.message);
  return response.data;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder_filter_'));
  const project = path.join(root, 'project');
  const storageRoot = path.join(root, 'storage');
  await fs.mkdir(project);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (name, content = name) => {
    await fs.mkdir(path.dirname(path.join(project, name)), { recursive: true });
    await fs.writeFile(path.join(project, name), content);
  };
  const open = async options => {
    const manager = new BackupManager();
    await manager.initialize(project, { storageRoot, ...options });
    return manager;
  };
  const manifest = async (manager, id) => JSON.parse(await fs.readFile(
    path.join(manager.getStorageRoot(), 'snapshots', id, 'manifest.json'), 'utf8'
  ));
  return { project, write, open, manifest };
}

test('opt-in scope keeps source, configuration and documents, and prunes excluded content', async t => {
  const f = await fixture(t);
  const kept = ['src/main.ts', 'src/output/helper.py', 'Dockerfile', '.gitignore', 'package.json',
    'docs/Guide.MD', 'docs/paper.pdf', 'docs/diagram.SVG', 'docs/lesson.ipynb'];
  const skipped = ['model.safetensors', 'data/samples.csv', 'media/video.mp4', 'archive.zip',
    'output/generated.py', 'output/report.json', 'output/diagram.svg', '.env.local'];
  for (const name of [...kept, ...skipped]) await f.write(name);
  await fs.symlink('src/main.ts', path.join(f.project, 'link.ts'));
  await fs.symlink('model.safetensors', path.join(f.project, 'link.bin'));
  const all = await f.open();
  const allId = data(await all.createBackup()).snapshot.id;
  assert.ok((await f.manifest(all, allId)).entries.some(entry => entry.path === 'model.safetensors'));

  const manager = await f.open({ backupScope: 'code-and-docs', excludePaths: ['output/'], includeExtensions: ['.SVG'] });
  const id = data(await manager.createBackup()).snapshot.id;
  const entries = (await f.manifest(manager, id)).entries;
  assert.deepEqual(entries.filter(entry => entry.kind !== 'directory').map(entry => entry.path).sort(), [...kept, 'link.ts'].sort());
  assert.equal(entries.some(entry => ['data', 'media', 'output'].includes(entry.path)), false);
  data(await manager.verifyBackup(id));
  await f.write('model.safetensors', 'new generated weights');
  await f.write('output/generated.py', 'new generated source');
  assert.equal(data(await manager.getStatus()).hasUncheckpointedChanges, false);
  assert.equal(data(await manager.createBackup({ skipIfUnchanged: true })).skipped, true);
});

for (const mode of ['exact', 'overlay']) {
  test(`${mode} restore of a broader old snapshot preserves currently excluded files`, async t => {
    const f = await fixture(t);
    for (const name of ['src/main.ts', 'docs/readme.md', 'model.pt', 'output/result.json']) await f.write(name, 'old');
    const all = await f.open();
    const target = data(await all.createBackup()).snapshot.id;
    for (const name of ['src/main.ts', 'docs/readme.md', 'model.pt', 'output/result.json']) await f.write(name, 'new');
    await f.write('extra.md', 'added source');
    await f.write('generated/extra.bin', 'keep generated content');
    const manager = await f.open({ backupScope: 'code-and-docs', excludePaths: ['output'] });
    const preview = data(await manager.previewRestore(target, mode));
    assert.equal(JSON.stringify(preview.changes).includes('model.pt'), false);
    assert.equal(JSON.stringify(preview.changes).includes('output'), false);
    data(await manager.restoreBackup(target, preview.confirmationToken));
    for (const name of ['src/main.ts', 'docs/readme.md']) assert.equal(await fs.readFile(path.join(f.project, name), 'utf8'), 'old');
    for (const name of ['model.pt', 'output/result.json']) assert.equal(await fs.readFile(path.join(f.project, name), 'utf8'), 'new');
    assert.equal(await fs.readFile(path.join(f.project, 'generated/extra.bin'), 'utf8'), 'keep generated content');
    assert.equal(await fs.stat(path.join(f.project, 'extra.md')).then(() => true, () => false), mode === 'overlay');
  });
}

test('explicit exclusions also preserve nested generated files during full-scope restore', async t => {
  const f = await fixture(t);
  await f.write('main.ts', 'old');
  const manager = await f.open({ excludePaths: ['artifacts/generated'] });
  const target = data(await manager.createBackup()).snapshot.id;
  await f.write('main.ts', 'new');
  await f.write('artifacts/generated/report.json', 'must survive');
  const preview = data(await manager.previewRestore(target));
  data(await manager.restoreBackup(target, preview.confirmationToken));
  assert.equal(await fs.readFile(path.join(f.project, 'artifacts/generated/report.json'), 'utf8'), 'must survive');
});

test('a restore preview cannot be reused after filter changes even when the current tree is unchanged', async t => {
  const f = await fixture(t);
  await f.write('main.ts');
  const all = await f.open();
  const target = data(await all.createBackup()).snapshot.id;
  const preview = data(await all.previewRestore(target));
  const filtered = await f.open({ backupScope: 'code-and-docs' });
  const response = await filtered.restoreBackup(target, preview.confirmationToken);
  assert.equal(response.success, false);
  assert.match(response.error, /filters changed/);
});

test('startup recovery uses the safety snapshot scope when new settings are narrower', async t => {
  const f = await fixture(t);
  await f.write('main.ts', 'before restore');
  await f.write('model.pt', 'original model');
  const all = await f.open();
  const safetyId = data(await all.createBackup({ tags: ['protected'] })).snapshot.id;
  await f.write('main.ts', 'interrupted');
  await f.write('model.pt', 'partially restored');
  await fs.writeFile(path.join(all.getStorageRoot(), 'restore-recovery.json'), JSON.stringify({
    schemaVersion: 1, projectRoot: await fs.realpath(f.project), snapshotId: crypto.randomUUID(),
    preRestoreSnapshotId: safetyId, mode: 'exact', startedAt: Date.now(), state: 'applying',
    backupFilter: normalizeBackupFilter(), excludeNames: []
  }));
  const recovered = await f.open({ backupScope: 'code-and-docs' });
  assert.equal(await fs.readFile(path.join(f.project, 'model.pt'), 'utf8'), 'original model');
  const id = data(await recovered.createBackup()).snapshot.id;
  assert.equal((await f.manifest(recovered, id)).entries.some(entry => entry.path === 'model.pt'), false);
});

test('watcher ignores excluded changes but checkpoints included documents', async t => {
  const f = await fixture(t);
  await f.write('readme.md', 'before');
  await f.write('model.pt', 'before');
  await f.write('output/data.json', 'before');
  const manager = await f.open({ backupScope: 'code-and-docs', excludePaths: ['output'] });
  data(await manager.createBackup());
  const responses = [];
  const watcher = new AutoCheckpointManager(manager, {
    debounceMs: 100, reconciliationIntervalMs: 60_000, onCheckpoint: result => responses.push(result)
  });
  t.after(() => watcher.stop());
  await watcher.start();
  await f.write('model.pt', 'changed weights');
  await f.write('output/data.json', 'changed data');
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(responses.length, 0);
  await f.write('readme.md', 'new documentation');
  const deadline = Date.now() + 5000;
  while (!responses.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(responses.length > 0, 'included document change must produce a checkpoint');
  assert.equal(responses[0].success, true);
  assert.equal(data(await manager.listBackups()).total, 2);
  await watcher.stop();
});

test('invalid exclusion paths and extensions are rejected before backup creation', async t => {
  const f = await fixture(t);
  for (const excluded of ['../outside', '/tmp', '.', 'a/../../b', 'a\\b', 'output/*', 'a//b']) {
    await assert.rejects(() => f.open({ excludePaths: [excluded] }), /project-relative/);
  }
  await assert.rejects(() => f.open({ backupScope: 'unknown' }), /scope/);
  await assert.rejects(() => f.open({ includeExtensions: ['*'] }), /extension/);
  await assert.rejects(() => f.open({ excludePaths: Array(101).fill('output') }), /100/);
});
