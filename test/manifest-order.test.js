import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupManager } from '../dist/backupManager.js';

test('mixed-case, punctuation and Unicode paths survive snapshot rereads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-manifest-order-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  for (const name of ['README.md', 'agent.py', 'agent_baselines.py', 'Möbius.md', '围棋.md']) {
    await fs.writeFile(path.join(project, name), name);
  }
  const manager = new BackupManager();
  await manager.initialize(project, { storageRoot: path.join(root, 'storage') });
  const first = await manager.createBackup({ name: 'first' });
  assert.equal(first.success, true);
  const verified = await manager.verifyBackup(first.data.snapshot.id);
  assert.equal(verified.success, true, verified.error);
  await fs.writeFile(path.join(project, 'agent.py'), 'changed');
  const second = await manager.createBackup({ name: 'second' });
  assert.equal(second.success, true, second.error);
  assert.equal((await manager.verifyBackup(second.data.snapshot.id)).success, true);
});
