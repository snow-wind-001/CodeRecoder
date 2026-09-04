import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const desktopRoot = resolve(process.cwd(), 'desktop');

export default defineConfig({
  main: {
    root: desktopRoot,
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(desktopRoot, '../dist-desktop/main'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(desktopRoot, 'electron/main.ts'),
        output: {
          entryFileNames: 'index.js',
          format: 'es'
        }
      }
    }
  },
  preload: {
    root: desktopRoot,
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(desktopRoot, '../dist-desktop/preload'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(desktopRoot, 'electron/preload.ts'),
        output: {
          entryFileNames: 'index.cjs',
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(desktopRoot, 'renderer'),
    plugins: [vue()],
    build: {
      outDir: resolve(desktopRoot, '../dist-desktop/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(desktopRoot, 'renderer/index.html')
      }
    }
  }
});
