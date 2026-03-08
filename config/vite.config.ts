import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './', // パッケージ版で file:// から読むため相対パスにする（省略時は / で真っ白になる）
  root: path.resolve(__dirname, '../renderer'),
  build: {
    outDir: path.resolve(__dirname, '../dist/renderer'),
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
