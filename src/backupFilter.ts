export type BackupScope = 'all' | 'code-and-docs';

export interface BackupFilterOptions {
  backupScope?: BackupScope;
  excludePaths?: string[];
  includeExtensions?: string[];
}

export interface BackupFilter {
  backupScope: BackupScope;
  excludePaths: string[];
  includeExtensions: string[];
}

// This is an explicit, opt-in file-name policy, not content or Git classification.
const CODE_AND_DOCUMENT_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl', 'py', 'pyi', 'pyx', 'pxd',
  'ipynb', 'rb', 'php', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx',
  'cs', 'fs', 'fsx', 'vb', 'java', 'kt', 'kts', 'scala', 'swift', 'm', 'mm',
  'dart', 'lua', 'r', 'jl', 'pl', 'pm', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'psm1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'thrift', 'prisma',
  'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs', 'clj', 'cljs', 'cljc', 'edn', 'elm',
  'ml', 'mli', 'nim', 'zig', 'v', 'sv', 'vhd', 'vhdl', 'cu', 'cuh', 's', 'asm',
  'f', 'f90', 'f95', 'sol', 'groovy', 'gradle', 'cmake', 'mk', 'make', 'nix',
  'tf', 'tfvars', 'hcl', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini',
  'cfg', 'conf', 'config', 'xml', 'xsd', 'xsl', 'xslt', 'properties', 'lock',
  'md', 'mdx', 'markdown', 'rst', 'txt', 'text', 'adoc', 'asciidoc', 'org',
  'tex', 'bib', 'sty', 'cls', 'typ', 'pdf', 'doc', 'docx', 'odt', 'rtf',
  'ppt', 'pptx', 'odp', 'drawio', 'excalidraw', 'puml', 'plantuml', 'mermaid'
]);

const CODE_AND_DOCUMENT_NAMES = new Set([
  'makefile', 'gnumakefile', 'dockerfile', 'containerfile', 'justfile',
  'rakefile', 'gemfile', 'procfile', 'vagrantfile', 'jenkinsfile', 'brewfile',
  'license', 'licence', 'copying', 'notice', 'authors', 'readme', 'changelog',
  '.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.editorconfig',
  '.npmrc', '.yarnrc', '.nvmrc', '.prettierignore', '.prettierrc', '.eslintrc',
  '.eslintignore', '.browserslistrc', '.python-version', '.tool-versions'
]);

export function normalizeBackupFilter(options: BackupFilterOptions = {}): BackupFilter {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid backup filters');
  const backupScope = options.backupScope === undefined ? 'all' : options.backupScope;
  if (backupScope !== 'all' && backupScope !== 'code-and-docs') {
    throw new Error('Invalid backup scope');
  }
  const excludePaths = normalizeList(options.excludePaths, 'excludePaths', 4096).map(value => {
    const normalized = value.replace(/\/+$/, '');
    if (!normalized || /[\\:*?\[\]{}\x00-\x1f]/.test(normalized)
      || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
      throw new Error(`Excluded paths must be literal project-relative paths: ${value}`);
    }
    return normalized;
  });
  const includeExtensions = normalizeList(options.includeExtensions, 'includeExtensions', 32).map(value => {
    const extension = value.replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9_+-]*$/.test(extension)) {
      throw new Error(`Invalid included extension: ${value}`);
    }
    return extension;
  });
  return {
    backupScope,
    excludePaths: [...new Set(excludePaths)].sort(),
    includeExtensions: [...new Set(includeExtensions)].sort()
  };
}

export function includesBackupFile(relativePath: string, filter: BackupFilter): boolean {
  if (filter.backupScope === 'all') return true;
  const name = relativePath.split('/').pop()!.toLowerCase();
  if (CODE_AND_DOCUMENT_NAMES.has(name) || /^(dockerfile|containerfile)\./.test(name)) return true;
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1) : '';
  return CODE_AND_DOCUMENT_EXTENSIONS.has(extension) || filter.includeExtensions.includes(extension);
}

function normalizeList(value: unknown, label: string, maxLength: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100
    || value.some(item => typeof item !== 'string' || !item.trim() || item.length > maxLength)) {
    throw new Error(`Invalid ${label}: expected up to 100 non-empty strings`);
  }
  return value.map((item: string) => item.trim());
}
