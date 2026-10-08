import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../web-dist/js/blender-engine');

export default defineConfig({
  root,
  worker: { format: 'es' },
  resolve: { dedupe: ['three'] },
  build: {
    outDir: output,
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    rollupOptions: {
      input: path.join(root, 'workbench.mjs'),
      output: {
        entryFileNames: 'workbench.mjs',
        chunkFileNames: 'chunk-[hash].mjs',
        assetFileNames: 'asset-[hash][extname]',
      },
    },
  },
});
