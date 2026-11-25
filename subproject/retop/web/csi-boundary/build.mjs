import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
let html = await readFile(path.join(root, 'index.html'), 'utf8');
const read = relative => readFile(path.join(root, relative), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + await read('styles.css') + '</style>');
const shoulder = (await read('../contour-lab-3d/reference/shoulder.json')).replaceAll('<', '\\u003c');
html = html.replace('<script src="../contour-lab-3d/engine.js"></script>', '<script>window.CSI_SHOULDER=' + shoulder + ';</script><script>' + (await read('../contour-lab-3d/engine.js')).replaceAll('</script', '<\\/script') + '</script>');
for (const file of ['../contour-lab-3d/boundary-guides.js', '../contour-lab-3d/structure-grid.js', '../contour-lab-3d/contour-check.js', '../contour-lab-3d/viewer.js', 'texture-evidence.js', 'partition.js', 'postprocess.js', 'app.js']) {
  html = html.replace(`<script src="${file}"></script>`, '<script>' + (await read(file)).replaceAll('</script', '<\\/script') + '</script>');
}
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/index.html'), html);
console.log('已生成 CSI 分区单文件网页：' + path.join(root, 'dist/index.html'));
