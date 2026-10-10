'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
const { prepare, stageVendor } = require('../../scripts/ops/mmd-mpl-assets');

function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error(`MPL共享构建缺少唯一入口：${anchor}`);
  return source.replace(anchor, replacement);
}

async function stage(root, { webMode = false } = {}) {
  if (!webMode) return;
  await stageVendor(root);
  const folder = path.join(root, 'js');
  const version = async name => (await hashFile(path.join(folder, name))).sha256.slice(0, 12);
  // 使用正式源码已复制的共享模块，先按依赖顺序计算内容指纹。
  const morphsFile = path.join(folder, 'mmd-mpl-morphs.mjs');
  await fs.writeFile(morphsFile, once(await fs.readFile(morphsFile, 'utf8'),
    './vendor/three/libs/mmdparser.module.js', `./vendor/three/libs/mmdparser.module.js?v=${await version('vendor/three/libs/mmdparser.module.js')}`));
  const morphsUrl = `./mmd-mpl-morphs.mjs?v=${await version('mmd-mpl-morphs.mjs')}`;
  const workerFile = path.join(folder, 'mmd-mpl-worker.mjs');
  await fs.writeFile(workerFile, once(await fs.readFile(workerFile, 'utf8'), './mmd-mpl-morphs.mjs', morphsUrl));
  const uiFile = path.join(folder, 'mmd-mpl-ui.mjs');
  let ui = once(await fs.readFile(uiFile, 'utf8'), './mmd-mpl-morphs.mjs', morphsUrl);
  ui = once(ui, './mmd-mpl-worker.mjs', `./mmd-mpl-worker.mjs?v=${await version('mmd-mpl-worker.mjs')}`);
  // MPL在此转换为独立本地资源模块，必须与runtime复用同一个注册表实例。
  ui = once(ui, './mmd-local-assets.mjs', `./web-local-assets.mjs?v=${await version('web-local-assets.mjs')}`);
  await fs.writeFile(uiFile, ui);
  const displayFile = path.join(folder, 'display-mmd.js');
  await fs.writeFile(displayFile, once(await fs.readFile(displayFile, 'utf8'),
    "import('./mmd-mpl-ui.mjs')", `import('./mmd-mpl-ui.mjs?v=${await version('mmd-mpl-ui.mjs')}')`));
}

module.exports = { prepare, stage };
if (require.main === module) prepare().then(cache => {
  process.stdout.write(`[mmd-ar-mpl] MPL编译器已校验：${cache}\n`);
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
