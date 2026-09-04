import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

test('compiled stdio entrypoint completes MCP initialization without stdout noise', async t => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-stdio-'));
  const stdinPath = path.join(fixtureRoot, 'stdin.jsonl');
  const stdoutPath = path.join(fixtureRoot, 'stdout.jsonl');
  const stderrPath = path.join(fixtureRoot, 'stderr.log');
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'stdio-smoke', version: '1.0.0' }
      }
    },
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    }
  ];
  await fs.writeFile(stdinPath, `${messages.map(message => JSON.stringify(message)).join('\n')}\n`);

  const stdinFd = openSync(stdinPath, 'r');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const entrypoint = path.resolve(testDirectory, '..', 'dist', 'index.js');
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [entrypoint], {
    stdio: [stdinFd, stdoutFd, stderrFd],
    env: childEnvironment
  });
  closeSync(stdinFd);
  closeSync(stdoutFd);
  closeSync(stderrFd);

  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('stdio server did not exit after EOF')), 5_000);
    child.once('close', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  const stderr = await fs.readFile(stderrPath, 'utf8');
  assert.equal(exitCode, 0, stderr);
  assert.match(stderr, /running on stdio/);

  const outputLines = (await fs.readFile(stdoutPath, 'utf8')).split('\n').filter(Boolean);
  const responses = outputLines.map(line => JSON.parse(line));
  assert.equal(responses.length, 2);
  const initialized = responses.find(response => response.id === 1);
  const tools = responses.find(response => response.id === 2);
  assert.equal(initialized.result.serverInfo.name, 'coderecoder-mcp');
  assert.match(initialized.result.instructions, /not a replacement for Git/);
  assert.equal(tools.result.tools.length, 9);
  assert.ok(tools.result.tools.every(tool => tool.outputSchema?.type === 'object'));
});
