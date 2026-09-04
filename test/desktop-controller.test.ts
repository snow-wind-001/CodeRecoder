import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DesktopBackupController } from '../desktop/electron/backupController.js';
import type {
  DesktopDashboard,
  RestorePreview,
  SnapshotSummary
} from '../desktop/shared/contracts.js';

function requireData<T>(response: { success: boolean; message: string; error?: string; data?: T }): T {
  assert.equal(response.success, true, response.error ?? response.message);
  assert.ok(response.data);
  return response.data;
}

test('desktop controller activates, backs up, restores, and reports recovery evidence', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-desktop-controller-'));
  const projectRoot = path.join(fixtureRoot, 'project');
  const storageRoot = path.join(fixtureRoot, 'storage');
  const preferencePath = path.join(fixtureRoot, 'preferences', 'desktop.json');
  const sourcePath = path.join(projectRoot, 'source.ts');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(storageRoot, { recursive: true });
  await fs.writeFile(sourcePath, 'export const version = 1;\n');

  const controller = new DesktopBackupController({
    appVersion: 'test',
    defaultStorageRoot: storageRoot,
    preferencePath
  });
  t.after(async () => {
    await controller.shutdown();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  await controller.initialize();
  const invalid = await controller.activate({
    projectPath: '',
    storageRoot,
    autoCheckpoint: false,
    maxBackups: 20
  });
  assert.equal(invalid.success, false);

  requireData(await controller.bootstrap());
  requireData(await controller.activate({
    projectPath: projectRoot,
    storageRoot,
    autoCheckpoint: false,
    maxBackups: 20
  }));

  const initialDashboard = requireData<DesktopDashboard>(await controller.refresh());
  assert.equal(initialDashboard.active, true);
  assert.equal(initialDashboard.automaticCheckpoint.state, 'stopped');
  assert.equal(initialDashboard.status?.externalStorage, true);
  assert.equal(initialDashboard.snapshots.length, 1);
  const baseline = initialDashboard.snapshots[0] as SnapshotSummary;

  await fs.writeFile(sourcePath, 'export const version = 2;\n');
  requireData(await controller.createSnapshot({ name: 'version two' }));
  const changedDashboard = requireData<DesktopDashboard>(await controller.refresh());
  assert.equal(changedDashboard.snapshots.length, 2);

  const preview = requireData<RestorePreview>(await controller.previewRestore({
    snapshotId: baseline.id,
    mode: 'exact'
  }));
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.counts.modified, 1);

  requireData(await controller.restoreSnapshot({
    snapshotId: baseline.id,
    confirmationToken: preview.confirmationToken
  }));
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'export const version = 1;\n');

  const restoredDashboard = requireData<DesktopDashboard>(await controller.refresh());
  assert.equal(restoredDashboard.recovery.state, 'restored');
  assert.equal(restoredDashboard.recovery.snapshotId, baseline.id);
  assert.ok(restoredDashboard.recovery.preRestoreSnapshotId);
  requireData(await controller.verifySnapshot(baseline.id));

  assert.equal((await fs.stat(preferencePath)).mode & 0o777, 0o600);
  requireData(await controller.deactivate(false));
  assert.equal(requireData<DesktopDashboard>(await controller.refresh()).active, false);
});
