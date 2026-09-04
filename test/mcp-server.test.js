import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CodeRecoderServer } from '../dist/index.js';

test('MCP lifecycle advertises and executes the production backup surface', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-mcp-'));
  const projectRoot = path.join(fixtureRoot, 'project');
  const storageRoot = path.join(fixtureRoot, 'storage');
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(storageRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'index.ts'), 'export const ready = true;\n');

  const server = new CodeRecoderServer();
  const client = new Client({ name: 'coderecorder-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.match(client.getInstructions(), /not a replacement for Git/);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map(tool => tool.name).sort(),
    [
      'activate_project',
      'create_project_snapshot',
      'deactivate_project',
      'delete_project_snapshot',
      'get_backup_status',
      'list_project_snapshots',
      'preview_project_restore',
      'restore_project_snapshot',
      'verify_project_snapshot'
    ]
  );
  assert.ok(listed.tools.every(tool => tool.outputSchema?.type === 'object'));
  assert.equal(
    listed.tools.find(tool => tool.name === 'restore_project_snapshot')?.annotations?.destructiveHint,
    true
  );

  const inactiveStatus = await client.callTool({ name: 'get_backup_status', arguments: {} });
  assert.equal(inactiveStatus.isError, true);
  assert.equal(inactiveStatus.structuredContent?.success, false);

  const activation = await client.callTool({
    name: 'activate_project',
    arguments: {
      projectPath: projectRoot,
      storageRoot,
      autoCheckpoint: false
    }
  });
  assert.equal(activation.isError, false);
  assert.equal(activation.structuredContent?.success, true);

  const snapshots = await client.callTool({
    name: 'list_project_snapshots',
    arguments: {}
  });
  assert.equal(snapshots.isError, false);
  assert.equal(snapshots.structuredContent?.data?.total, 1);

  const invalid = await client.callTool({
    name: 'verify_project_snapshot',
    arguments: { snapshotId: 'not-a-uuid' }
  });
  assert.equal(invalid.isError, true);

  const deactivation = await client.callTool({
    name: 'deactivate_project',
    arguments: { createFinalCheckpoint: false }
  });
  assert.equal(deactivation.isError, false);
  assert.equal(deactivation.structuredContent?.data?.state, 'inactive');
});
