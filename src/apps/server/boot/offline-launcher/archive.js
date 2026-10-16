'use strict';

// 复用现有Node min的ZIP32/Deflate校验器；引导阶段不能依赖yauzl或服务node_modules。
const fs = require('node:fs');
const path = require('node:path');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createInflateRaw } = require('node:zlib');
const MAX_ZIP_ARCHIVE_BYTES = 512 * 1024 ** 2;
const MAX_ZIP_DIRECTORY_BYTES = 64 * 1024 ** 2;
const MAX_ZIP_ENTRIES = 250000;
const MAX_UNCOMPRESSED_BYTES = 8 * 1024 ** 3;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_value, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    return crc >>> 0;
});

function crc32Buffer(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function decodeZipName(nameBytes, flags, extraBytes) {
    if (flags & 0x800) return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    if (![...nameBytes].some((byte) => byte > 0x7f)) return nameBytes.toString('ascii');

    for (let offset = 0; offset + 4 <= extraBytes.length;) {
        const fieldId = extraBytes.readUInt16LE(offset);
        const fieldLength = extraBytes.readUInt16LE(offset + 2);
        const fieldStart = offset + 4;
        if (fieldStart + fieldLength > extraBytes.length) throw new Error('ZIP 文件名扩展字段损坏');
        if (fieldId === 0x7075 && fieldLength >= 5 && extraBytes[fieldStart] === 1 &&
            extraBytes.readUInt32LE(fieldStart + 1) === crc32Buffer(nameBytes)) {
            return new TextDecoder('utf-8', { fatal: true }).decode(extraBytes.subarray(fieldStart + 5, fieldStart + fieldLength));
        }
        offset = fieldStart + fieldLength;
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch (error) {
        throw new Error(`ZIP 非 ASCII 文件名缺少有效 UTF-8 编码: ${error.message}`, { cause: error });
    }
}

function findZipDirectoryEnd(archive) {
    const minimum = Math.max(0, archive.length - 22 - 0xffff);
    for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
        if (archive.readUInt32LE(offset) !== 0x06054b50) continue;
        const commentLength = archive.readUInt16LE(offset + 20);
        if (offset + 22 + commentLength === archive.length) return offset;
    }
    throw new Error('代码 ZIP 缺少有效 End of Central Directory');
}

function parseZipEntries(archive) {
    if (archive.length < 22 || archive.length > MAX_ZIP_ARCHIVE_BYTES) {
        throw new Error(`代码 ZIP 大小超出支持范围: ${archive.length}`);
    }
    const eocdOffset = findZipDirectoryEnd(archive);
    const diskNumber = archive.readUInt16LE(eocdOffset + 4);
    const directoryDisk = archive.readUInt16LE(eocdOffset + 6);
    const diskEntries = archive.readUInt16LE(eocdOffset + 8);
    const totalEntries = archive.readUInt16LE(eocdOffset + 10);
    const directorySize = archive.readUInt32LE(eocdOffset + 12);
    const directoryOffset = archive.readUInt32LE(eocdOffset + 16);
    if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries ||
        diskEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
        throw new Error('不支持 ZIP64 或多卷代码 ZIP');
    }
    if (totalEntries > MAX_ZIP_ENTRIES || directorySize > MAX_ZIP_DIRECTORY_BYTES ||
        directoryOffset + directorySize > eocdOffset) {
        throw new Error('代码 ZIP 中央目录无效或超出限制');
    }

    const entries = [];
    const seenEntries = new Set();
    let expandedBytes = 0;
    let offset = directoryOffset;
    const directoryEnd = directoryOffset + directorySize;
    while (offset < directoryEnd) {
        if (offset + 46 > directoryEnd || archive.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error('代码 ZIP 中央目录条目损坏');
        }
        const versionMadeBy = archive.readUInt16LE(offset + 4);
        const flags = archive.readUInt16LE(offset + 8);
        const compressionMethod = archive.readUInt16LE(offset + 10);
        const crc32 = archive.readUInt32LE(offset + 16);
        const compressedSize = archive.readUInt32LE(offset + 20);
        const uncompressedSize = archive.readUInt32LE(offset + 24);
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        const diskStart = archive.readUInt16LE(offset + 34);
        const externalAttributes = archive.readUInt32LE(offset + 38);
        const localHeaderOffset = archive.readUInt32LE(offset + 42);
        const recordLength = 46 + nameLength + extraLength + commentLength;
        if (offset + recordLength > directoryEnd || compressedSize === 0xffffffff ||
            uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff || diskStart !== 0) {
            throw new Error('不支持 ZIP64 或损坏的 ZIP 中央目录条目');
        }
        if ((flags & (0x0001 | 0x0040 | 0x2000)) !== 0 || ![0, 8].includes(compressionMethod)) {
            throw new Error('代码 ZIP 使用了加密或不支持的压缩格式');
        }
        const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
        const extraBytes = archive.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
        const fileName = decodeZipName(nameBytes, flags, extraBytes);
        if (!fileName || fileName.includes('\\') || fileName.includes('\0')) {
            throw new Error(`ZIP 条目名称无效: ${fileName}`);
        }
        const isDirectory = fileName.endsWith('/');
        const normalizedName = isDirectory ? fileName.slice(0, -1) : fileName;
        const segments = normalizedName.split('/');
        if (!normalizedName || normalizedName.startsWith('/') || /^[A-Za-z]:/.test(normalizedName) ||
            segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':') ||
                /[<>"|?*]/.test(segment) || /[. ]$/.test(segment) ||
                /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
            throw new Error(`ZIP 条目路径不安全或不兼容 Windows: ${fileName}`);
        }
        const relativePath = segments.join('/');
        if (seenEntries.has(relativePath)) throw new Error(`ZIP 包含重复路径: ${relativePath}`);
        seenEntries.add(relativePath);

        const creatorOs = versionMadeBy >>> 8;
        const unixMode = creatorOs === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
        const fileType = unixMode & 0o170000;
        if (fileType === 0o120000) throw new Error(`ZIP 不允许符号链接: ${relativePath}`);
        if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
            throw new Error(`ZIP 包含特殊文件: ${relativePath}`);
        }
        if ((isDirectory && fileType === 0o100000) || (!isDirectory && fileType === 0o040000)) {
            throw new Error(`ZIP 文件类型标记不匹配: ${relativePath}`);
        }
        if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) {
            throw new Error(`ZIP 目录条目包含文件数据: ${relativePath}`);
        }
        expandedBytes += uncompressedSize;
        if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_UNCOMPRESSED_BYTES) {
            throw new Error('代码 ZIP 解压后大小超过限制');
        }
        entries.push({ fileName, nameBytes, flags, compressionMethod, crc32, compressedSize,
            uncompressedSize, localHeaderOffset, isDirectory, relativePath, segments });
        offset += recordLength;
    }
    if (offset !== directoryEnd || entries.length !== totalEntries) throw new Error('代码 ZIP 中央目录长度不匹配');
    return { entries, directoryOffset };
}

function createZipEntryVerifier(entry) {
    let crc = 0xffffffff;
    let actualSize = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            actualSize += chunk.length;
            if (actualSize > entry.uncompressedSize) {
                callback(new Error(`ZIP 条目解压后超过声明大小: ${entry.relativePath}`));
                return;
            }
            for (const byte of chunk) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
            callback(null, chunk);
        },
        flush(callback) {
            const actualCrc = (crc ^ 0xffffffff) >>> 0;
            if (actualSize !== entry.uncompressedSize || actualCrc !== entry.crc32) {
                callback(new Error(`ZIP 条目大小或 CRC32 不匹配: ${entry.relativePath}`));
                return;
            }
            callback();
        }
    });
}

async function extractZipSafely(archivePath, destinationRoot, kind, select = () => true) {
    const archiveStat = await fs.promises.stat(archivePath);
    if (!archiveStat.isFile() || archiveStat.size > MAX_ZIP_ARCHIVE_BYTES) {
        throw new Error(`代码 ZIP 文件类型或大小无效: ${archiveStat.size}`);
    }
    const archive = await fs.promises.readFile(archivePath);
    if (archive.length !== archiveStat.size) throw new Error('代码 ZIP 在读取期间发生变化');
    const { entries, directoryOffset } = parseZipEntries(archive);
    for (const entry of entries) {
        const name = entry.relativePath.replace(/\/$/, '');
        const first = name.split('/')[0];
        const allowed = {
            code: () => ['src', 'package.json', 'package-lock.json'].includes(first) && !/^src\/apps\/(android-display|voice-display-node)(\/|$)/.test(name),
            dependencies: () => ['node_modules', 'dependency-group.json', 'dependency-manifest.json'].includes(first),
            seeds: () => ['config', 'userconfig', 'task'].includes(first),
            taskCode: () => first === 'tasks' || name === 'task-code-manifest.json',
            dataRepair: () => name === 'repair.js'
        }[kind];
        if (kind && (!allowed || !allowed())) throw new Error('ZIP包含非组件路径: ' + name);
    }
    let parent = path.dirname(destinationRoot);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    require('./files').space(parent, entries.filter(entry => select(entry.relativePath)).reduce((sum, entry) => sum + entry.uncompressedSize, 0));
    await fs.promises.mkdir(destinationRoot, { recursive: false });
    const resolvedRoot = path.resolve(destinationRoot);

    for (const entry of entries) {
        if (!select(entry.relativePath)) continue;
        const targetPath = path.resolve(resolvedRoot, ...entry.segments);
        const relativeTarget = path.relative(resolvedRoot, targetPath);
        if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeTarget)) {
            throw new Error(`ZIP 条目路径越界: ${entry.relativePath}`);
        }
        if (entry.isDirectory) {
            await fs.promises.mkdir(targetPath, { recursive: true });
            continue;
        }

        const localOffset = entry.localHeaderOffset;
        if (localOffset + 30 > directoryOffset || archive.readUInt32LE(localOffset) !== 0x04034b50) {
            throw new Error(`ZIP 本地文件头损坏: ${entry.relativePath}`);
        }
        const localFlags = archive.readUInt16LE(localOffset + 6);
        const localMethod = archive.readUInt16LE(localOffset + 8);
        const localNameLength = archive.readUInt16LE(localOffset + 26);
        const localExtraLength = archive.readUInt16LE(localOffset + 28);
        const localNameStart = localOffset + 30;
        const dataStart = localNameStart + localNameLength + localExtraLength;
        const dataEnd = dataStart + entry.compressedSize;
        if (localFlags !== entry.flags || localMethod !== entry.compressionMethod ||
            localNameLength !== entry.nameBytes.length ||
            !archive.subarray(localNameStart, localNameStart + localNameLength).equals(entry.nameBytes) ||
            dataEnd > directoryOffset) {
            throw new Error(`ZIP 本地文件头与中央目录不匹配: ${entry.relativePath}`);
        }

        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        const compressed = archive.subarray(dataStart, dataEnd);
        const input = Readable.from(compressed.length ? [compressed] : []);
        const output = fs.createWriteStream(targetPath, { flags: 'wx', mode: 0o600 });
        const verifier = createZipEntryVerifier(entry);
        if (entry.compressionMethod === 8) {
            await pipeline(input, createInflateRaw(), verifier, output);
        } else {
            await pipeline(input, verifier, output);
        }
    }
}


module.exports = { extractZipSafely, parseZipEntries };
