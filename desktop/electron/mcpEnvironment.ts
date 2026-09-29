import os from 'node:os';
import path from 'node:path';

/** Desktop sessions may not inherit the user's shell profile. */
export function mcpEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [...new Set([
      path.join(os.homedir(), '.local', 'bin'),
      ...(process.env.PATH ?? '').split(path.delimiter).filter(directory => path.isAbsolute(directory))
    ])].join(path.delimiter)
  };
}
