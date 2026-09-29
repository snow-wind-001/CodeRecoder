import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const releaseDirectory = path.join(repositoryRoot, 'release');
const requiredDependencies = [
  'libgtk-3-0',
  'libnotify4',
  'libnss3',
  'libxss1',
  'libxtst6',
  'xdg-utils',
  'libatspi2.0-0',
  'libuuid1',
  'libsecret-1-0',
  'libdrm2',
  'libgbm1',
  'libasound2',
  'libx11-xcb1',
  'libcups2'
];

async function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const hasInput = options.input !== undefined;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      shell: false,
      stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${String(code)}\n${stderr || stdout}`));
    });
    if (hasInput && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(options.input);
    }
  });
}

async function findDebPackage() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const candidates = (await fs.readdir(releaseDirectory))
    .filter(name => name.startsWith(`CodeRecoder-${packageJson.version}-`) && name.endsWith('.deb'));
  assert.equal(candidates.length, 1, `Expected one CodeRecoder ${packageJson.version} deb, found: ${candidates.join(', ') || 'none'}`);
  return path.join(releaseDirectory, candidates[0]);
}

async function writeChecksum(debPath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(debPath)) hash.update(chunk);
  const digest = hash.digest('hex');
  const checksumPath = `${debPath}.sha256`;
  await fs.writeFile(checksumPath, `${digest}  ${path.basename(debPath)}\n`, { mode: 0o644 });
  return { digest, checksumPath };
}

async function main() {
  const debPath = await findDebPackage();
  const control = (await run('dpkg-deb', ['--field', debPath])).stdout;
  assert.match(control, /^Package: coderecoder$/m);
  assert.match(control, /^Architecture: amd64$/m);
  for (const dependency of requiredDependencies) {
    assert.match(control, new RegExp(`\\b${dependency.replaceAll('.', '\\.')}(?:\\s|,|$)`), `Missing Debian dependency: ${dependency}`);
  }

  const contents = (await run('dpkg-deb', ['--contents', debPath])).stdout;
  assert.match(contents, /opt\/CodeRecoder\/coderecoder$/m);
  assert.match(contents, /opt\/CodeRecoder\/resources\/bin\/coderecoder-mcp$/m);
  assert.match(contents, /opt\/CodeRecoder\/resources\/app\.asar$/m);
  assert.match(contents, /opt\/CodeRecoder\/resources\/mcp\/index\.mjs$/m);
  assert.match(contents, /usr\/share\/applications\/coderecoder\.desktop$/m);
  assert.match(contents, /-rwxr-xr-x .*opt\/CodeRecoder\/chrome-sandbox$/m);

  const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coderecoder-deb-'));
  try {
    await run('dpkg-deb', ['--extract', debPath, extractionRoot]);
    const applicationRoot = path.join(extractionRoot, 'opt', 'CodeRecoder');
    const executable = path.join(applicationRoot, 'coderecoder');
    const launcher = path.join(applicationRoot, 'resources', 'bin', 'coderecoder-mcp');
    const desktopFile = path.join(extractionRoot, 'usr', 'share', 'applications', 'coderecoder.desktop');
    const controlRoot = path.join(extractionRoot, 'DEBIAN');
    await run('dpkg-deb', ['--control', debPath, controlRoot]);
    const postInstall = await fs.readFile(path.join(controlRoot, 'postinst'), 'utf8');
    assert.match(postInstall, /chmod 4755 .*chrome-sandbox/);
    assert.match(postInstall, /apparmor-profile/);
    const launcherMode = (await fs.stat(launcher)).mode & 0o777;
    assert.equal(launcherMode, 0o755, 'Bundled MCP launcher must be executable');

    const linkedLibraries = (await run('ldd', [executable])).stdout;
    assert.doesNotMatch(linkedLibraries, /not found/);
    await run('desktop-file-validate', [desktopFile]);

    const messages = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'coderecorder-deb-verifier', version: '1.0.0' }
        }
      },
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }
    ];
    const smoke = await run(launcher, [], {
      input: `${messages.map(message => JSON.stringify(message)).join('\n')}\n`,
      timeoutMs: 10_000
    });
    const responses = smoke.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    assert.equal(responses.find(response => response.id === 1)?.result?.serverInfo?.name, 'coderecoder-mcp');
    assert.equal(responses.find(response => response.id === 2)?.result?.tools?.length, 9);
    assert.match(smoke.stderr, /running on stdio/);
  } finally {
    await fs.rm(extractionRoot, { recursive: true, force: true });
  }

  const checksum = await writeChecksum(debPath);
  process.stdout.write(`Verified Debian package: ${debPath}\n`);
  process.stdout.write(`SHA-256: ${checksum.digest}\n`);
  process.stdout.write(`Checksum file: ${checksum.checksumPath}\n`);
  process.stdout.write('Control metadata, runtime libraries, desktop entry, permissions, and bundled MCP handshake passed.\n');
}

await main();
