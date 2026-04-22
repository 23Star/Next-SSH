import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// v2 is now the only maintained renderer entry.
export default defineConfig({
  base: './', // パッケージ版で file:// から読むため相対パスにする（省略時は / で真っ白になる）
  plugins: [react()],
  root: path.resolve(__dirname, '../renderer'),
  build: {
    outDir: path.resolve(__dirname, '../dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, '../renderer/v2/index.html'),
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
