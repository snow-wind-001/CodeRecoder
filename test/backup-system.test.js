import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupManager } from '../dist/backupManager.js';
import { AutoCheckpointManager } from '../dist/autoCheckpointManager.js';

async function createFixture(t, prefix) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), `coderecoder-${prefix}-`));
  const projectRoot = path.join(fixtureRoot, 'project');
  const storageRoot = path.join(fixtureRoot, 'storage');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(storageRoot, { recursive: true });
  t.after(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });
  return { fixtureRoot, projectRoot, storageRoot };
}

function requireData(response) {
  assert.equal(response.success, true, response.error ?? response.message);
  assert.ok(response.data);
  return response.data;
}

function snapshotId(response) {
  const data = requireData(response);
  assert.equal(typeof data.snapshot?.id, 'string');
  return data.snapshot.id;
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Condition was not met within ${timeoutMs}ms`);
}

test('verified backups capture changes and restore exact bytes safely', async t => {
  const { projectRoot, storageRoot } = await createFixture(t, 'restore');
  await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'src', 'app.ts'), 'export const value = 1;\n');
  await fs.writeFile(path.join(projectRoot, 'src', 'rename-me.ts'), 'export const stable = true;\n');
  await fs.writeFile(path.join(projectRoot, 'obsolete.txt'), 'keep in first backup\n');
  await fs.writeFile(path.join(projectRoot, 'binary.dat'), Buffer.from([0, 1, 2, 3, 254, 255]));
  await fs.writeFile(path.join(projectRoot, 'run.sh'), '#!/bin/sh\necho safe\n');
  await fs.chmod(path.join(projectRoot, 'run.sh'), 0o755);
  await fs.symlink('app.ts', path.join(projectRoot, 'src', 'app-link.ts'));
  await fs.writeFile(path.join(projectRoot, '.env'), 'TOKEN=initial\n');

  const manager = new BackupManager();
  await manager.initialize(projectRoot, { storageRoot, maxBackups: 20 });
  assert.equal(await fs.stat(path.join(projectRoot, '.CodeRecoder')).then(() => true, () => false), false);

  const firstId = snapshotId(await manager.createBackup({ name: 'first', trigger: 'manual' }));
  const firstSnapshotRoot = path.join(manager.getStorageRoot(), 'snapshots', firstId);
  assert.equal((await fs.stat(firstSnapshotRoot)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(firstSnapshotRoot, 'manifest.json'))).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(manager.getStorageRoot(), 'index.json'))).mode & 0o777, 0o600);
  assert.equal(
    (await fs.stat(path.join(firstSnapshotRoot, 'tree', 'run.sh'))).mode & 0o777,
    0o600
  );
  assert.equal(
    (await fs.stat(path.join(firstSnapshotRoot, 'tree'))).mode & 0o777,
    0o700
  );
  assert.equal(
    (await fs.stat(path.join(firstSnapshotRoot, 'tree', 'src'))).mode & 0o777,
    0o700
  );

  await fs.writeFile(path.join(projectRoot, 'src', 'app.ts'), 'export const value = 2;\n');
  await fs.rename(
    path.join(projectRoot, 'src', 'rename-me.ts'),
    path.join(projectRoot, 'src', 'renamed.ts')
  );
  await fs.rm(path.join(projectRoot, 'obsolete.txt'));
  await fs.writeFile(path.join(projectRoot, 'added.txt'), 'new code\n');
  await fs.writeFile(path.join(projectRoot, 'binary.dat'), Buffer.from([9, 8, 7, 6]));
  await fs.writeFile(path.join(projectRoot, '.env'), 'TOKEN=must-survive-restore\n');

  const secondId = snapshotId(await manager.createBackup({ name: 'second', trigger: 'manual' }));
  const secondManifest = JSON.parse(await fs.readFile(
    path.join(manager.getStorageRoot(), 'snapshots', secondId, 'manifest.json'),
    'utf8'
  ));
  assert.ok(secondManifest.changes.added.includes('added.txt'));
  assert.ok(secondManifest.changes.deleted.includes('obsolete.txt'));
  assert.ok(secondManifest.changes.modified.includes('src/app.ts'));
  assert.deepEqual(
    secondManifest.changes.renamed.find(change => change.from === 'src/rename-me.ts'),
    { from: 'src/rename-me.ts', to: 'src/renamed.ts' }
  );

  requireData(await manager.verifyBackup(firstId));
  requireData(await manager.verifyBackup(secondId));

  const previewData = requireData(await manager.previewRestore(firstId, 'exact'));
  assert.equal(previewData.requiresConfirmation, true);
  assert.equal(typeof previewData.confirmationToken, 'string');
  const restoreData = requireData(await manager.restoreBackup(
    firstId,
    previewData.confirmationToken
  ));
  assert.equal(restoreData.verification, 'verified');
  assert.equal(await fs.readFile(path.join(projectRoot, 'src', 'app.ts'), 'utf8'), 'export const value = 1;\n');
  assert.deepEqual(
    await fs.readFile(path.join(projectRoot, 'binary.dat')),
    Buffer.from([0, 1, 2, 3, 254, 255])
  );
  assert.equal(await fs.readFile(path.join(projectRoot, 'obsolete.txt'), 'utf8'), 'keep in first backup\n');
  assert.equal(await fs.readFile(path.join(projectRoot, '.env'), 'utf8'), 'TOKEN=must-survive-restore\n');
  assert.equal(await fs.readlink(path.join(projectRoot, 'src', 'app-link.ts')), 'app.ts');
  assert.equal((await fs.stat(path.join(projectRoot, 'run.sh'))).mode & 0o777, 0o755);
  assert.equal(await fs.stat(path.join(projectRoot, 'added.txt')).then(() => true, () => false), false);
  assert.equal(await fs.stat(path.join(projectRoot, 'src', 'renamed.ts')).then(() => true, () => false), false);

  const replayed = await manager.restoreBackup(firstId, previewData.confirmationToken);
  assert.equal(replayed.success, false);
  assert.match(replayed.error, /already consumed/);

  const changedPreview = requireData(await manager.previewRestore(secondId, 'exact'));
  await fs.appendFile(path.join(projectRoot, 'src', 'app.ts'), '// changed after preview\n');
  const rejectedForChange = await manager.restoreBackup(secondId, changedPreview.confirmationToken);
  assert.equal(rejectedForChange.success, false);
  assert.match(rejectedForChange.error, /changed after the preview/);
  assert.match(await fs.readFile(path.join(projectRoot, 'src', 'app.ts'), 'utf8'), /changed after preview/);

  const expiringPreview = requireData(await manager.previewRestore(secondId, 'overlay'));
  const pendingPath = path.join(
    manager.getStorageRoot(),
    'pending',
    `${expiringPreview.confirmationToken}.json`
  );
  const pending = JSON.parse(await fs.readFile(pendingPath, 'utf8'));
  pending.expiresAt = Date.now() - 1;
  await fs.writeFile(pendingPath, `${JSON.stringify(pending)}\n`);
  const rejectedForExpiry = await manager.restoreBackup(secondId, expiringPreview.confirmationToken);
  assert.equal(rejectedForExpiry.success, false);
  assert.match(rejectedForExpiry.error, /expired/);

  await fs.writeFile(
    path.join(manager.getStorageRoot(), 'snapshots', firstId, 'tree', 'obsolete.txt'),
    'corrupt\n'
  );
  const corrupt = await manager.verifyBackup(firstId);
  assert.equal(corrupt.success, false);
  assert.match(corrupt.error, /failed verification/);
});

test('concurrent managers preserve an atomic index', async t => {
  const { projectRoot, storageRoot } = await createFixture(t, 'concurrency');
  await fs.writeFile(path.join(projectRoot, 'main.txt'), 'concurrent content\n');

  const first = new BackupManager();
  const second = new BackupManager();
  await Promise.all([
    first.initialize(projectRoot, { storageRoot }),
    second.initialize(projectRoot, { storageRoot })
  ]);

  const results = await Promise.all([
    first.createBackup({ name: 'one' }),
    second.createBackup({ name: 'two' })
  ]);
  assert.ok(results.every(result => result.success));

  const list = requireData(await first.listBackups());
  assert.equal(list.total, 2);
  assert.equal(new Set(list.snapshots.map(snapshot => snapshot.id)).size, 2);
  const index = JSON.parse(await fs.readFile(path.join(first.getStorageRoot(), 'index.json'), 'utf8'));
  assert.equal(index.snapshots.length, 2);
});

test('initialization rolls back an uncommitted snapshot deletion', async t => {
  const { projectRoot, storageRoot } = await createFixture(t, 'delete-recovery');
  await fs.writeFile(path.join(projectRoot, 'keep.txt'), 'recover deletion\n');
  const first = new BackupManager();
  await first.initialize(projectRoot, { storageRoot });
  const id = snapshotId(await first.createBackup({ name: 'keep-me' }));
  const snapshotRoot = path.join(first.getStorageRoot(), 'snapshots', id);
  const deletingRoot = path.join(first.getStorageRoot(), 'snapshots', `.deleting-${id}`);
  await fs.rename(snapshotRoot, deletingRoot);

  const recovered = new BackupManager();
  await recovered.initialize(projectRoot, { storageRoot });
  requireData(await recovered.verifyBackup(id));
  const status = requireData(await recovered.getStatus());
  assert.equal(status.lastRecovery.rolledBackInterruptedDeletes, 1);

  const rejected = await recovered.deleteBackup(id, crypto.randomUUID());
  assert.equal(rejected.success, false);
  requireData(await recovered.verifyBackup(id));
  const deleted = requireData(await recovered.deleteBackup(id, id));
  assert.equal(deleted.state, 'deleted');
  assert.equal(deleted.cleanupPending, false);
  assert.equal((requireData(await recovered.listBackups())).total, 0);
});

test('initialization rebuilds a corrupt index from verified manifests', async t => {
  const { projectRoot, storageRoot } = await createFixture(t, 'index-recovery');
  const sourcePath = path.join(projectRoot, 'source.txt');
  await fs.writeFile(sourcePath, 'first\n');
  const first = new BackupManager();
  await first.initialize(projectRoot, { storageRoot });
  const firstId = snapshotId(await first.createBackup({ name: 'first' }));
  await fs.writeFile(sourcePath, 'second\n');
  const secondId = snapshotId(await first.createBackup({ name: 'second' }));
  await fs.writeFile(path.join(first.getStorageRoot(), 'index.json'), '{not valid json\n');

  const recovered = new BackupManager();
  await recovered.initialize(projectRoot, { storageRoot });
  const list = requireData(await recovered.listBackups());
  assert.deepEqual(
    new Set(list.snapshots.map(snapshot => snapshot.id)),
    new Set([firstId, secondId])
  );
  const status = requireData(await recovered.getStatus());
  assert.equal(status.lastRecovery.rebuiltIndex, true);
  assert.match(path.basename(status.lastRecovery.preservedCorruptIndex), /^index\.corrupt-/);
  assert.equal(
    await fs.stat(status.lastRecovery.preservedCorruptIndex).then(() => true, () => false),
    true
  );
});

test('pre-restore retention preserves the selected oldest backup', async t => {
  const { projectRoot, storageRoot } = await createFixture(t, 'retention');
  const sourcePath = path.join(projectRoot, 'state.txt');
  await fs.writeFile(sourcePath, 'oldest\n');

  const manager = new BackupManager();
  await manager.initialize(projectRoot, { storageRoot, maxBackups: 2 });
  const oldestId = snapshotId(await manager.createBackup({ name: 'oldest' }));
  await fs.writeFile(sourcePath, 'newest\n');
  snapshotId(await manager.createBackup({ name: 'newest' }));

  const preview = requireData(await manager.previewRestore(oldestId, 'exact'));
  requireData(await manager.restoreBackup(oldestId, preview.confirmationToken));
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'oldest\n');
  requireData(await manager.verifyBackup(oldestId));
});

test('project operation lock serializes restores across different storage roots', async t => {
  const { fixtureRoot, projectRoot } = await createFixture(t, 'cross-storage-lock');
  const sourcePath = path.join(projectRoot, 'state.txt');
  const storageA = path.join(fixtureRoot, 'storage-a');
  const storageB = path.join(fixtureRoot, 'storage-b');
  await fs.mkdir(storageA);
  await fs.mkdir(storageB);

  await fs.writeFile(sourcePath, 'state-a\n');
  const managerA = new BackupManager();
  await managerA.initialize(projectRoot, { storageRoot: storageA });
  const snapshotA = snapshotId(await managerA.createBackup({ name: 'state-a' }));

  await fs.writeFile(sourcePath, 'state-b\n');
  const managerB = new BackupManager();
  await managerB.initialize(projectRoot, { storageRoot: storageB });
  const snapshotB = snapshotId(await managerB.createBackup({ name: 'state-b' }));

  await fs.writeFile(sourcePath, 'current\n');
  const previewA = requireData(await managerA.previewRestore(snapshotA, 'exact'));
  const previewB = requireData(await managerB.previewRestore(snapshotB, 'exact'));
  const results = await Promise.all([
    managerA.restoreBackup(snapshotA, previewA.confirmationToken),
    managerB.restoreBackup(snapshotB, previewB.confirmationToken)
  ]);

  assert.equal(results.filter(result => result.success).length, 1);
  assert.equal(results.filter(result => !result.success).length, 1);
  assert.ok(['state-a\n', 'state-b\n'].includes(await fs.readFile(sourcePath, 'utf8')));
});

test('initialization rolls back an interrupted restore journal', async t => {
  const { projectRoot, storageRoot } = await createFixture(t, 'recovery');
  await fs.writeFile(path.join(projectRoot, 'important.txt'), 'known-good\n');

  const first = new BackupManager();
  await first.initialize(projectRoot, { storageRoot });
  const safetyId = snapshotId(await first.createBackup({
    name: 'safety',
    tags: ['protected']
  }));

  await fs.writeFile(path.join(projectRoot, 'important.txt'), 'partially-restored\n');
  await fs.writeFile(path.join(projectRoot, 'unexpected.txt'), 'partial file\n');
  await fs.writeFile(
    path.join(first.getStorageRoot(), 'restore-recovery.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      projectRoot: await fs.realpath(projectRoot),
      snapshotId: crypto.randomUUID(),
      preRestoreSnapshotId: safetyId,
      mode: 'exact',
      startedAt: Date.now(),
      state: 'applying'
    })}\n`
  );

  const recovered = new BackupManager();
  await recovered.initialize(projectRoot, { storageRoot });
  assert.equal(await fs.readFile(path.join(projectRoot, 'important.txt'), 'utf8'), 'known-good\n');
  assert.equal(await fs.stat(path.join(projectRoot, 'unexpected.txt')).then(() => true, () => false), false);
  assert.equal(
    await fs.stat(path.join(recovered.getStorageRoot(), 'restore-recovery.json')).then(() => true, () => false),
    false
  );
  const status = requireData(await recovered.getStatus());
  assert.equal(status.lastRecovery.interruptedRestore.preRestoreSnapshotId, safetyId);
});

test('automatic checkpoints debounce bursts and discard paused events', async t => {
  const { projectRoot, storageRoot } = await createFixture(t, 'watcher');
  const sourcePath = path.join(projectRoot, 'watched.txt');
  await fs.writeFile(sourcePath, 'baseline\n');

  const manager = new BackupManager();
  await manager.initialize(projectRoot, { storageRoot });
  snapshotId(await manager.createBackup({ name: 'baseline' }));

  const watcher = new AutoCheckpointManager(manager, {
    debounceMs: 150,
    reconciliationIntervalMs: 10_000
  });
  await watcher.start();
  t.after(async () => {
    await watcher.stop();
  });

  await fs.writeFile(sourcePath, 'one\n');
  await fs.writeFile(sourcePath, 'two\n');
  await fs.writeFile(sourcePath, 'three\n');
  await waitFor(() => watcher.getStatus().lastCheckpointResult === 'created');
  const afterBurst = requireData(await manager.listBackups());
  assert.equal(afterBurst.total, 2);
  assert.equal(watcher.getStatus().state, 'running');

  await watcher.pause(true);
  await fs.writeFile(sourcePath, 'while paused\n');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(requireData(await manager.listBackups()).total, 2);
  assert.equal(watcher.getStatus().state, 'paused');
  watcher.resume(true);
  assert.equal(watcher.getStatus().state, 'running');
});

test('internal backup storage is excluded from automatic checkpoints', async t => {
  const { projectRoot } = await createFixture(t, 'internal-storage');
  const sourcePath = path.join(projectRoot, 'source.txt');
  await fs.writeFile(sourcePath, 'baseline\n');

  const manager = new BackupManager();
  await manager.initialize(projectRoot);
  const baselineId = snapshotId(await manager.createBackup({ name: 'baseline' }));
  const baselineManifest = JSON.parse(await fs.readFile(
    path.join(manager.getStorageRoot(), 'snapshots', baselineId, 'manifest.json'),
    'utf8'
  ));
  assert.ok(baselineManifest.entries.every(entry => !entry.path.startsWith('.CodeRecoder')));

  const watcher = new AutoCheckpointManager(manager, {
    debounceMs: 150,
    reconciliationIntervalMs: 10_000
  });
  await watcher.start();
  t.after(async () => {
    await watcher.stop();
  });

  await fs.writeFile(sourcePath, 'changed\n');
  await waitFor(() => watcher.getStatus().lastCheckpointResult === 'created');
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(requireData(await manager.listBackups()).total, 2);
});
