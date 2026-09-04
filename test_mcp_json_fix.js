#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const build = spawnSync('npm', ['run', 'build'], {
  cwd: repositoryRoot,
  stdio: 'inherit'
});
if (build.status !== 0) process.exit(build.status ?? 1);

const smokeTest = spawnSync(
  process.execPath,
  ['--test', 'test/stdio-smoke.test.js'],
  {
    cwd: repositoryRoot,
    stdio: 'inherit'
  }
);

process.exit(smokeTest.status ?? 1);
