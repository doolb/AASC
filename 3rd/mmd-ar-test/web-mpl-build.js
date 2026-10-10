'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashFile } = require('./apk-artifact');

// 固定同一提交的 JS/WASM 配对，避免上游 main 更新后构建不可复现。
const COMMIT = '2d3b1c7e3429b508443500801e94c41fd47c9f31';
const VERSION = '0.3.6';
const FILES = Object.freeze([
  ['mmd_mpl.js', 21994, '600718929cf5506306fcf911d5b058f5d98d6b592cf12dd28506f7e5cc786f78'],
  ['mmd_mpl_bg.wasm', 577320, '53edf963d74920db3692b31e824b68d3dfd47ecff7489edd1727a9114983b6e4'],
  ['LICENSE', 35149, '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986'],
]);
const CACHE = path.resolve(__dirname, '../../build/third_party/mmd-ar-mpl', COMMIT);
const verify = (buffer, size, hash) => buffer.length === size
  && crypto.createHash('sha256').update(buffer).digest('hex') === hash;

async function prepare() {
  await fs.mkdir(CACHE, { recursive: true });
  await Promise.all(FILES.map(async ([name, size, hash]) => {
    const file = path.join(CACHE, name);
    try {
      if (verify(await fs.readFile(file), size, hash)) return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const url = `https://raw.githubusercontent.com/AmyangXYZ/MMD-MPL/${COMMIT}/pkg/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`MPL 编译器下载失败：${name} HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!verify(buffer, size, hash)) throw new Error(`MPL 编译器大小/SHA-256不一致：${name}`);
    // 文件完整校验之后才覆盖缓存，下载失败不留下半个 WASM。
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, buffer);
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }));
  return CACHE;
}

async function stage(root, { webMode = false } = {}) {
  if (!webMode) return;
  await prepare();
  const folder = path.join(root, 'js');
  const relativeVendor = `vendor/mmd-mpl/${VERSION}-${COMMIT.slice(0, 12)}`;
  const vendor = path.join(folder, relativeVendor);
  await fs.mkdir(vendor, { recursive: true });
  for (const [name] of FILES) await fs.copyFile(path.join(CACHE, name), path.join(vendor, name));
  await fs.writeFile(path.join(vendor, 'SOURCE.json'), JSON.stringify({
    name: 'MMD-MPL', version: VERSION, commit: COMMIT, license: 'GPL-3.0',
    source: `https://github.com/AmyangXYZ/MMD-MPL/tree/${COMMIT}`,
    files: FILES.map(([name, bytes, sha256]) => ({ name, bytes, sha256 })),
  }, null, 2) + '\n');
  // 表情编码复用网页实际VMD解析器，依赖指纹一路传到Worker/UI及入口。
  const parserHash = (await hashFile(path.join(folder, 'vendor/three/libs/mmdparser.module.js'))).sha256.slice(0, 12);
  const morphsFile = path.join(folder, 'web-mpl-morphs.mjs');
  const morphs = (await fs.readFile(path.join(__dirname, 'web-mpl-morphs.mjs'), 'utf8'))
    .replace('__MPL_CHARSET_URL__', `./vendor/three/libs/mmdparser.module.js?v=${parserHash}`);
  await fs.writeFile(morphsFile, morphs);
  const morphsHash = (await hashFile(morphsFile)).sha256.slice(0, 12);
  const workerFile = path.join(folder, 'web-mpl-worker.mjs');
  const worker = (await fs.readFile(path.join(__dirname, 'web-mpl-worker.mjs'), 'utf8'))
    .replace('__MPL_COMPILER_URL__', `./${relativeVendor}/mmd_mpl.js`)
    .replace('__MPL_MORPHS_URL__', `./web-mpl-morphs.mjs?v=${morphsHash}`);
  await fs.writeFile(workerFile, worker);
  const workerHash = (await hashFile(workerFile)).sha256.slice(0, 12);
  const localHash = (await hashFile(path.join(folder, 'web-local-assets.mjs'))).sha256.slice(0, 12);
  const uiFile = path.join(folder, 'web-mpl-ui.mjs');
  const ui = (await fs.readFile(path.join(__dirname, 'web-mpl-ui.mjs'), 'utf8'))
    .replace('__MPL_WORKER_URL__', `./web-mpl-worker.mjs?v=${workerHash}`)
    .replace('__MPL_MORPHS_URL__', `./web-mpl-morphs.mjs?v=${morphsHash}`)
    .replace('./web-local-assets.mjs', `./web-local-assets.mjs?v=${localHash}`);
  await fs.writeFile(uiFile, ui);
  const uiHash = (await hashFile(uiFile)).sha256.slice(0, 12);
  await fs.appendFile(path.join(folder, 'display-mmd.js'), `\nimport('./web-mpl-ui.mjs?v=${uiHash}');\n`);
}

module.exports = { prepare, stage };
if (require.main === module) prepare().then(cache => {
  process.stdout.write(`[mmd-ar-mpl] MMD-MPL ${VERSION} 已校验：${cache}\n`);
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
