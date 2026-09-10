import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const launcher = path.resolve(process.argv[2]);
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder_packaged_mcp_'));
const { version } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const client = new Client({ name: 'coderecoder-package-check', version: '1.0.0' });
let diagnostics = '';
try {
  // An external node command must not be needed by the installed MCP launcher.
  await fs.writeFile(path.join(fixture, 'node'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  const transport = new StdioClientTransport({
    command: launcher,
    cwd: fixture,
    env: { PATH: `${fixture}:/usr/bin:/bin`, HOME: fixture },
    stderr: 'pipe'
  });
  transport.stderr?.on('data', chunk => { diagnostics += String(chunk); });
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, version);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 9);
  assert.ok(tools.tools.some(tool => tool.name === 'activate_project'));
  console.log(`PASS: packaged MCP ${version}, ${tools.tools.length} tools, no source checkout or external Node`);
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  await client.close();
  await fs.rm(fixture, { recursive: true, force: true });
}
