const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/linux');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
for (const action of ['install', 'remove']) {
  const standard = fs.readFileSync(path.join(templates, `after-${action}.tpl`), 'utf8');
  const additions = fs.readFileSync(path.join(root, `desktop/linux/after-${action}.sh`), 'utf8');
  fs.writeFileSync(path.join(root, `build/after-${action}.sh`), `${standard}\n${additions}\n`, { mode: 0o755 });
}
