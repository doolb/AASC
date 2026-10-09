import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../web-dist/js/blender-engine');
const browserPackage = path.resolve(root, 'node_modules/@volter/blender-engine/browser');

function replaceExactly(source, before, after, file) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Blender 子目录兼容补丁锚点数量异常：${file} (${count})`);
  return source.replace(before, after);
}

function subdirectoryRoutes() {
  const engineFile = path.join(browserPackage, 'blender-engine.mts');
  const workerFile = path.join(browserPackage, 'worker.ts');
  const workerPatches = [
    [
      'fetch(`/__editor/blender-document?${query}`, {',
      'fetch(editorRoute(`blender-document?${query}`), {',
    ],
    [
      'fetch(`/__editor/blender-document-chunk?${query}&hash=${chunk.hash}`, {',
      'fetch(editorRoute(`blender-document-chunk?${query}&hash=${chunk.hash}`), {',
    ],
    [
      "const url = '/__editor/blender-wasm/status';",
      "const url = editorRoute('blender-wasm/status');",
    ],
    [
      "fetch('/__editor/blender-project-index')",
      "fetch(editorRoute('blender-project-index'))",
    ],
    [
      '`/__editor/blender-project-index answered ${answer.status}`',
      "`${editorRoute('blender-project-index')} answered ${answer.status}`",
    ],
    [
      '`/__editor/blender-project-file?path=${encodeURIComponent(file.path)}`',
      'editorRoute(`blender-project-file?path=${encodeURIComponent(file.path)}`)',
    ],
  ];

  return {
    name: 'mmd-ar-blender-subdirectory-routes',
    enforce: 'pre',
    transform(source, id) {
      const file = path.resolve(id.split('?')[0]);
      if (file === engineFile) {
        return replaceExactly(
          source,
          "export const ARTIFACT_BASE = '/__editor/blender-wasm';",
          "export const ARTIFACT_BASE = new URL(`${'../'.repeat(3)}__editor/blender-wasm`, import.meta.url).pathname;",
          'blender-engine.mts',
        );
      }
      if (file !== workerFile) return null;
      let patched = source;
      for (const [before, after] of workerPatches)
        patched = replaceExactly(patched, before, after, 'worker.ts');
      return [
        'const editorRoute = route => {',
        '  const url = new URL(import.meta.url);',
        "  const [path, query] = route.split('?', 2);",
        "  url.pathname = `${url.pathname.split('/').slice(0, -4).join('/')}/__editor/${path}`;",
        "  url.search = query ? `?${query}` : '';",
        "  url.hash = '';",
        '  return url.href;',
        '};',
        patched,
      ].join('\n');
    },
  };
}

export default defineConfig({
  root,
  base: './',
  worker: { format: 'es', plugins: () => [subdirectoryRoutes()] },
  resolve: { dedupe: ['three'] },
  plugins: [subdirectoryRoutes()],
  build: {
    outDir: output,
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    rollupOptions: {
      input: path.join(root, 'workbench.mjs'),
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: 'workbench.mjs',
        chunkFileNames: 'chunk-[hash].mjs',
        assetFileNames: 'asset-[hash][extname]',
      },
    },
  },
});
