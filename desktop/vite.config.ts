import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const desktopRoot = resolve(process.cwd(), 'desktop');

export default defineConfig({
  root: resolve(desktopRoot, 'renderer'),
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    strictPort: true
  },
  build: {
    outDir: resolve(desktopRoot, '../dist-desktop/renderer'),
    emptyOutDir: true
  }
});
