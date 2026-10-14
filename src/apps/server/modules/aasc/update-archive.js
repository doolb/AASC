'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const { Readable } = require('node:stream');

function safePath(raw, kind, seen) {
    const name = raw.replace(/\/$/, '');
    const parts = name.split('/');
    const allowed = kind === 'code' ? ['src', 'package.json', 'package-lock.json'].includes(name) || name.startsWith('src/') :
        ['node_modules', 'dependency-manifest.json', 'dependency-group.json'].includes(name) || name.startsWith('node_modules/');
    if (!allowed || name.includes('\\') || name.includes(':') || /[\x00-\x1f]/.test(name) ||
        parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)) ||
        seen.has(name.toLowerCase()) || seen.size >= 100000 ||
        (kind === 'code' && /^src\/apps\/(android-display|voice-display-node\/node_modules)(\/|$)/.test(name))) throw new Error(`ZIP包含危险/重复/非组件路径：${raw}`);
    seen.add(name.toLowerCase()); return name;
}
/** 流式展开受限ZIP，拒绝符号链接、设备、加密、重复和Windows路径别名。 */
async function extractZip(archive, destination, kind) {
    const handle = await fs.promises.open(archive, 'r');
    // 旧fd-slicer自行改写destroyed标志，会在Node26背压下提前丢弃压缩流末块。
    // 中央目录仍由yauzl解析，但范围读取与文件描述符生命周期交给Node原生实现。
    class FileRangeReader extends yauzl.RandomAccessReader {
        read(buffer, offset, length, position, callback) { fs.read(handle.fd, buffer, offset, length, position, callback); }
        createReadStream({ start, end }) {
            if (start === end) return Readable.from([]);
            return fs.createReadStream(archive, { start, end: end - 1 });
        }
        close(callback) { handle.close().then(() => callback(), callback); }
    }
    let zip;
    try {
        const stat = await handle.stat();
        zip = await new Promise((resolve, reject) => yauzl.fromRandomAccessReader(new FileRangeReader(), stat.size,
            { lazyEntries: true, decodeStrings: true }, (error, value) => error ? reject(error) : resolve(value)));
    } catch (error) { await handle.close(); throw error; }
    let bytes = 0; const seen = new Set();
    await fs.promises.mkdir(destination, { recursive: true });
    try {
        await new Promise((resolve, reject) => {
            zip.once('error', reject); zip.once('end', resolve);
            zip.on('entry', async entry => {
                try {
                    const name = safePath(entry.fileName, kind, seen);
                    const type = (entry.externalFileAttributes >>> 16) & 0o170000;
                    const directory = entry.fileName.endsWith('/');
                    if ((entry.generalPurposeBitFlag & 1) || (type && type !== (directory ? 0o040000 : 0o100000))) throw new Error('ZIP包含链接/特殊文件/加密项');
                    bytes += entry.uncompressedSize;
                    if (!Number.isSafeInteger(bytes) || bytes > 2 * 1024 ** 3) throw new Error('ZIP展开大小超限');
                    const target = path.join(destination, name);
                    if (directory) await fs.promises.mkdir(target, { recursive: true });
                    else {
                        await fs.promises.mkdir(path.dirname(target), { recursive: true });
                        const stream = await new Promise((done, fail) => zip.openReadStream(entry, (error, value) => error ? fail(error) : done(value)));
                        await pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o644 }));
                    }
                    zip.readEntry();
                } catch (error) { reject(error); zip.close(); }
            });
            zip.readEntry();
        });
    } finally { zip.close(); }
    return bytes;
}
const { hashFile, treeFiles, contentHash, mergeTree } = require('./dependency-tree');
module.exports = { safePath, extractZip, hashFile, treeFiles, contentHash, mergeTree };
