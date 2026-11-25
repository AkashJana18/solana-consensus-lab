
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  // Relative base so the build can be served from a GitHub Pages sub-path.
  base: './',
  plugins: [react(), wasm(), topLevelAwait()],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  server: { port: 5173, strictPort: true },
  build: {
    target: 'esnext',
    sourcemap: false,
    rollupOptions: {
      input: {
        // The consensus simulator at /, and the SVM lab at /svm/.
        main: resolve(__dirname, 'index.html'),
        svm: resolve(__dirname, 'svm/index.html'),
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
