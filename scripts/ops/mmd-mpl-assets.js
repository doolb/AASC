'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

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

async function stageVendor(root) {
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
  return relativeVendor;
}

module.exports = { prepare, stageVendor, COMMIT, VERSION, FILES };
