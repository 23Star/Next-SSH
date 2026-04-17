import { defineConfig } from 'vite';
import path from 'path';

// Two renderer entries coexist during the Phase 2+ refactor:
//   renderer/index.html     — legacy app (unchanged while we migrate)
//   renderer/v2/index.html  — new iOS+Claude panel UI (WIP)
// The main process picks which one to load via the NEXT_SSH_V2 env flag.
export default defineConfig({
  base: './', // パッケージ版で file:// から読むため相対パスにする（省略時は / で真っ白になる）
  root: path.resolve(__dirname, '../renderer'),
  build: {
    outDir: path.resolve(__dirname, '../dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, '../renderer/index.html'),
        v2: path.resolve(__dirname, '../renderer/v2/index.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

