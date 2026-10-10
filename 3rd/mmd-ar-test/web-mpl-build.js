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
  // 调试模块只从独立源码复制，不再要求正式静态目录携带MPL模块和编译器。
  for (const kind of ['morphs', 'worker', 'ui']) {
    await fs.copyFile(path.join(__dirname, `web-mpl-${kind}.mjs`), path.join(folder, `mmd-mpl-${kind}.mjs`));
  }
  // 按依赖顺序计算指纹，保留既有生成文件名，支持子目录部署。
  const morphsFile = path.join(folder, 'mmd-mpl-morphs.mjs');
  await fs.writeFile(morphsFile, once(await fs.readFile(morphsFile, 'utf8'),
    './vendor/three/libs/mmdparser.module.js', `./vendor/three/libs/mmdparser.module.js?v=${await version('vendor/three/libs/mmdparser.module.js')}`));
  const morphsUrl = `./mmd-mpl-morphs.mjs?v=${await version('mmd-mpl-morphs.mjs')}`;
  const workerFile = path.join(folder, 'mmd-mpl-worker.mjs');
  await fs.writeFile(workerFile, once(await fs.readFile(workerFile, 'utf8'), './web-mpl-morphs.mjs', morphsUrl));
  const uiFile = path.join(folder, 'mmd-mpl-ui.mjs');
  let ui = once(await fs.readFile(uiFile, 'utf8'), './web-mpl-morphs.mjs', morphsUrl);
  ui = once(ui, './web-mpl-worker.mjs', `./mmd-mpl-worker.mjs?v=${await version('mmd-mpl-worker.mjs')}`);
  // MPL在此转换为独立本地资源模块，必须与runtime复用同一个注册表实例。
  ui = once(ui, './web-local-assets.mjs', `./web-local-assets.mjs?v=${await version('web-local-assets.mjs')}`);
  await fs.writeFile(uiFile, ui);
  const displayFile = path.join(folder, 'display-mmd.js');
  const display = await fs.readFile(displayFile, 'utf8');
  if (!display.includes('getMplModelState:')) throw new Error('独立显示模块缺少MPL模型快照接口');
  await fs.writeFile(displayFile, `${display}\n// MPL仅在独立网页生成副本加入，点击编译才加载WASM。\nimport('./mmd-mpl-ui.mjs?v=${await version('mmd-mpl-ui.mjs')}').catch(error => console.warn('[MMD] MPL面板加载失败:', error));\n`);
}

module.exports = { prepare, stage };
if (require.main === module) prepare().then(cache => {
  process.stdout.write(`[mmd-ar-mpl] MPL编译器已校验：${cache}\n`);
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
