'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const VERSION = '3.29.5';
const URL = `https://registry.npmjs.org/pinyin-pro/-/pinyin-pro-${VERSION}.tgz`;
const INTEGRITY = 'Fk5YoRmtdHqJWqAuzYVG/NzvzeCbaG+ZEwbY6Nbps3QAIrvQQEtcm49frcyCM8i2b5najnzPDtYqrHRYTTiuwQ==';
const CACHE = path.resolve(__dirname, '../../build/third_party/mmd-ar-lipsync', `pinyin-pro-${VERSION}.tgz`);
const verify = bytes => crypto.createHash('sha512').update(bytes).digest('base64') === INTEGRITY;

async function prepare() {
    let bytes;
    try { bytes = await fs.readFile(CACHE); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!bytes || !verify(bytes)) {
        const response = await fetch(URL, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`拼音资源下载失败 HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (!verify(bytes)) throw new Error('拼音资源SHA-512与固定版本不一致');
        await fs.mkdir(path.dirname(CACHE), { recursive: true });
        const temporary = `${CACHE}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, CACHE); }
        finally { await fs.rm(temporary, { force: true }); }
    }
    // 仅读取已通过整体完整性校验的归档；不解包链接、不执行代码、不接受越界路径。
    const tar = zlib.gunzipSync(bytes, { maxOutputLength: 4 * 1024 * 1024 });
    const files = [];
    const field = (block, start, size) => block.subarray(start, start + size).toString('utf8').split('\0')[0].trim();
    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        const name = field(header, 0, 100), prefix = field(header, 345, 155);
        if (!name) break;
        const size = Number.parseInt(field(header, 124, 12) || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('拼音归档长度无效');
        const fullName = prefix ? `${prefix}/${name}` : name;
        const regular = header[156] === 0 || header[156] === 48;
        if (regular && (fullName.startsWith('package/dist/esm/') || fullName === 'package/LICENSE')) {
            const relative = fullName.slice('package/'.length);
            if (path.posix.normalize(relative) !== relative || relative.startsWith('../') || relative.includes('\\')) throw new Error('拼音归档路径无效');
            files.push({ name: relative, bytes: Buffer.from(tar.subarray(offset + 512, offset + 512 + size)) });
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (files.length !== 30 || !files.some(file => file.name === 'dist/esm/index.mjs') || !files.some(file => file.name === 'LICENSE')) {
        throw new Error('固定拼音归档的ESM依赖/许可证数量不一致');
    }
    return files;
}

// 同一套固定拼音资源供正式源码和独立网页使用；完整ESM依赖及许可证一起复制。
async function stageVendor(root) {
    const vendor = `vendor/pinyin-pro/${VERSION}`;
    const files = await prepare();
    const folder = path.join(root, 'js', vendor);
    for (const file of files) {
        const target = path.join(folder, file.name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.bytes);
    }
    await fs.writeFile(path.join(folder, 'SOURCE.json'), JSON.stringify({ name: 'pinyin-pro', version: VERSION,
        license: 'MIT', source: 'https://github.com/zh-lx/pinyin-pro', archive: URL, integrity: `sha512-${INTEGRITY}`,
        files: files.map(file => ({ name: file.name, bytes: file.bytes.length,
            sha256: crypto.createHash('sha256').update(file.bytes).digest('hex') })) }, null, 2) + '\n');
    return vendor;
}
module.exports = { prepare, stageVendor, VERSION };
