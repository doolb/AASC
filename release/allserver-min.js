'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createInflateRaw } = require('node:zlib');

const ENTRYPOINT = path.join('src', 'apps', 'server', 'boot', 'server-app.js');
const MANIFEST_RELATIVE_PATH = 'manifest.json';
const SIGNATURE_ALGORITHM = 'SHA256withRSA';
// 部署建议使用当前 Node.js 24 LTS；开发机记录于 2026-09-26。
const RECOMMENDED_NODE_MAJOR = 24;
const RECOMMENDED_NODE_VERSION_AT_RECORD = '24.21.0';
const DEVELOPMENT_NODE_VERSION = '26.8.1';
// 最低兼容线来自当前 package dependencies 的 engines 要求，不代表推荐部署版本。
const MIN_NODE_VERSION = [20, 18, 1];
const MANIFEST_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const SERVER_READY_TIMEOUT_MS = 120_000;
const SERVER_STOP_TIMEOUT_MS = 12_000;
const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 100_000;
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const UPDATE_BASE_URLS = Object.freeze([
    'http://192.168.1.39/mnt/aasc-offline/',
    'http://10.221.70.87/mnt/aasc-offline/',
    'http://120.79.245.103/mnt/aasc-offline/'
]);
const SCRIPT_DIRECTORY = path.resolve(__dirname);
const DEFAULT_PROJECT_ROOT = path.basename(SCRIPT_DIRECTORY).toLowerCase() === 'release'
    ? path.dirname(SCRIPT_DIRECTORY)
    : SCRIPT_DIRECTORY;
const MAX_RELEASE_SEED_ARCHIVE_BYTES = 64 * 1024 * 1024;

// Offline 更新公钥是公开校验材料；私钥只保留在签名出包机。
const OFFLINE_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAqoSGGeF8nGNdIfC8I/jP
K5Jb0Rsk56+yAy1Cs+xlUGQ9oyTaXBzhxNZORUVS/EiXyQ9FuKRLGYnTo4hplNa8
4GzFANgz2/TOPlgHtgqPntOYPsw3DqySiWuRn5K9A96+EMPhoqi0gGaSU1jlAPXV
Hnw6xXYE3Eb5VL55cAzVOW2IJagSc/rR4cQil3uxOaOhZfEK0GHs2w9QnzqSAEF/
hAck3/njAIxAPIH5y+wuHOzNo/+AxuUou9v+ZkzjX2tsY1/n8K4fV/oINhhacJvc
YJto+kc8ia/XOcXuSkHNmiiIy/yo6qewVR+gUUmyGpYh+hNloiHNhWsaHNvbnpiO
3hDziUQnvFyclcsPsYb0JCpSzkhyUJs1SMYVvTSyhVFyxomgSXM7SJYvRqlMqYI9
gVo5FX3kx+tH3wee/CWPu1VhI+l/xm+dI6Znb5yy2FfKfdvHyEkzXD0xej4AGU0c
WQH09xffI1ABdZep6ug19dcjUUiF+FfgaB79aOLm8sARAgMBAAE=
-----END PUBLIC KEY-----`;

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
    }
    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
}

function assertSupportedNodeVersion(version = process.versions.node) {
    const actual = version.split('.').map((part) => Number(part));
    const older = actual[0] < MIN_NODE_VERSION[0] ||
        (actual[0] === MIN_NODE_VERSION[0] && actual[1] < MIN_NODE_VERSION[1]) ||
        (actual[0] === MIN_NODE_VERSION[0] && actual[1] === MIN_NODE_VERSION[1] && actual[2] < MIN_NODE_VERSION[2]);
    if (older) {
        throw new Error(`需要 Node.js ${MIN_NODE_VERSION.join('.')} 或更新版本，当前为 ${version}`);
    }
}

function parseArguments(argv = process.argv.slice(2)) {
    const configuredInterval = process.env.AASC_NODE_MIN_UPDATE_INTERVAL_MS;
    const initialInterval = configuredInterval === undefined || configuredInterval.trim() === ''
        ? DEFAULT_UPDATE_INTERVAL_MS
        : Number(configuredInterval);
    if (!Number.isSafeInteger(initialInterval) || initialInterval < 0) {
        throw new Error('AASC_NODE_MIN_UPDATE_INTERVAL_MS 必须是大于或等于 0 的整数');
    }
    const options = {
        projectRoot: DEFAULT_PROJECT_ROOT,
        intervalMs: initialInterval,
        checkOnly: false,
        help: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--check-only') {
            options.checkOnly = true;
            continue;
        }
        if (argument === '--help' || argument === '-h') {
            options.help = true;
            continue;
        }
        const [rawName, inlineValue] = argument.split(/=(.*)/s, 2);
        const name = rawName === '--root' ? 'projectRoot' : rawName === '--interval-ms' ? 'intervalMs' : null;
        if (!name) throw new Error(`不支持的参数: ${argument}`);
        const value = inlineValue === undefined ? argv[++index] : inlineValue;
        if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`${rawName} 缺少参数值`);
        if (name === 'projectRoot') {
            options.projectRoot = path.resolve(value);
        } else {
            options.intervalMs = Number(value);
            if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 0) {
                throw new Error('--interval-ms 必须是大于或等于 0 的整数');
            }
        }
    }
    return options;
}

function printHelp() {
    process.stdout.write([
        '用法: node <allserver-min.js 路径> [选项]',
        '',
        '  --root <目录>       AASC 数据根目录，默认是脚本所在目录（脚本放在 release/ 时取其上级目录）',
        '  --interval-ms <毫秒> 更新检查间隔，默认 300000；0 表示只在启动时检查',
        '  --check-only        只读取并验签当前清单，不下载或启动服务',
        `  建议部署 Node.js ${RECOMMENDED_NODE_MAJOR} LTS (记录版本 v${RECOMMENDED_NODE_VERSION_AT_RECORD})；开发机当前为 v${DEVELOPMENT_NODE_VERSION}`,
        `  最低兼容版本: Node.js ${MIN_NODE_VERSION.join('.')}`,
        '  --help              显示此帮助'
    ].join('\n') + '\n');
}

function isSha256(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateRelativeArtifactPath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' ||
        relativePath.startsWith('/') || relativePath.includes('\\') ||
        relativePath.includes('?') || relativePath.includes('#') ||
        relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`Offline 清单制品路径不安全: ${relativePath}`);
    }
}

function validateCodeManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || !manifest.payload || !manifest.signature) {
        throw new Error('Offline 更新清单格式无效');
    }
    if (manifest.signature.algorithm !== SIGNATURE_ALGORITHM ||
        typeof manifest.signature.value !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature.value)) {
        throw new Error('Offline 更新清单签名字段无效');
    }
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalJson(manifest.payload), 'utf8');
    verifier.end();
    if (!verifier.verify(OFFLINE_UPDATE_PUBLIC_KEY, manifest.signature.value, 'base64')) {
        throw new Error('Offline 更新清单签名验证失败');
    }

    const payload = manifest.payload;
    const code = payload.components?.code;
    if (payload.schemaVersion !== 1 || !code || typeof code !== 'object' || Array.isArray(code)) {
        throw new Error('Offline 更新清单 schemaVersion/components.code 无效');
    }
    if (!Number.isSafeInteger(code.version) || code.version < 1 ||
        !Number.isSafeInteger(code.requiredDependencyVersion) || code.requiredDependencyVersion < 1 ||
        !isSha256(code.requiredLockSha256) || !isSha256(code.sha256) ||
        !Number.isSafeInteger(code.size) || code.size < 1 || code.size > MAX_ZIP_ARCHIVE_BYTES) {
        throw new Error('Offline 更新清单代码版本、锁文件指纹或资源校验字段无效');
    }
    validateRelativeArtifactPath(code.relativeUrl);
    return code;
}

function validateNodeMinSeeds(manifest) {
    const seeds = manifest.payload.components?.nodeMinSeeds;
    if (seeds === undefined) return null;
    if (!seeds || typeof seeds !== 'object' || Array.isArray(seeds) ||
        !Number.isSafeInteger(seeds.version) || seeds.version < 1 ||
        !isSha256(seeds.sha256) || !Number.isSafeInteger(seeds.size) ||
        seeds.size < 1 || seeds.size > MAX_RELEASE_SEED_ARCHIVE_BYTES) {
        throw new Error('Offline 清单 nodeMinSeeds 版本、大小或 SHA-256 字段无效');
    }
    validateRelativeArtifactPath(seeds.relativeUrl);
    return seeds;
}

function resolveBaseUrls() {
    const configured = process.env.AASC_OFFLINE_UPDATE_BASE_URLS;
    const values = configured
        ? configured.split(',').map((value) => value.trim()).filter(Boolean)
        : [...UPDATE_BASE_URLS];
    const normalized = values.map((value) => new URL(value.endsWith('/') ? value : `${value}/`));
    const unique = [...new Map(normalized.map((url) => [url.href, url])).values()];
    if (unique.length === 0 || unique.some((url) => !['http:', 'https:'].includes(url.protocol))) {
        throw new Error('Offline 更新源必须至少包含一个 HTTP/HTTPS 地址');
    }
    return unique.map((url) => url.href);
}

async function fetchManifestFromSources(baseUrls = resolveBaseUrls()) {
    const candidates = [];
    const errors = [];
    let notFoundCount = 0;
    for (const baseUrl of baseUrls) {
        try {
            const response = await fetch(new URL(MANIFEST_RELATIVE_PATH, baseUrl), {
                signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS)
            });
            if (response.status === 404) {
                notFoundCount += 1;
                continue;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length === 0 || buffer.length > MAX_MANIFEST_BYTES) {
                throw new Error(`manifest.json 大小无效: ${buffer.length}`);
            }
            const manifest = JSON.parse(buffer.toString('utf8'));
            const code = validateCodeManifest(manifest);
            const seeds = validateNodeMinSeeds(manifest);
            candidates.push({ baseUrl, manifest, code, seeds });
        } catch (error) {
            errors.push(`${baseUrl}: ${error.message}`);
        }
    }
    if (candidates.length === 0) {
        if (notFoundCount === baseUrls.length) return null;
        if (errors.length > 0) throw new Error(`无法读取有效 Offline 清单: ${errors.join('；')}`);
        return null;
    }
    candidates.sort((left, right) => right.code.version - left.code.version);
    const newest = candidates[0];
    const sameVersion = candidates.filter((candidate) => candidate.code.version === newest.code.version);
    if (sameVersion.some((candidate) => candidate.code.sha256 !== newest.code.sha256)) {
        throw new Error(`多个 Offline 更新源的 code v${newest.code.version} 内容不一致`);
    }
    const seedDigestsByVersion = new Map();
    for (const candidate of sameVersion) {
        if (!candidate.seeds) continue;
        const digest = seedDigestsByVersion.get(candidate.seeds.version);
        if (digest && digest !== candidate.seeds.sha256) {
            throw new Error(`多个 Offline 更新源的 nodeMinSeeds v${candidate.seeds.version} 内容不一致`);
        }
        seedDigestsByVersion.set(candidate.seeds.version, candidate.seeds.sha256);
    }
    const newestSeeds = sameVersion
        .filter((candidate) => candidate.seeds)
        .sort((left, right) => right.seeds.version - left.seeds.version)[0] || null;
    return {
        ...newest,
        seeds: newestSeeds?.seeds || null,
        seedBaseUrl: newestSeeds?.baseUrl || null
    };
}

async function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function downloadComponentArchive(candidate, component, destinationPath, baseUrls, label) {
    const preferredBaseUrl = candidate.seeds === component && candidate.seedBaseUrl
        ? candidate.seedBaseUrl
        : candidate.baseUrl;
    const urls = [preferredBaseUrl, ...baseUrls.filter((url) => url !== preferredBaseUrl)];
    const errors = [];
    for (const baseUrl of urls) {
        const temporaryPath = `${destinationPath}.part-${process.pid}-${Date.now()}`;
        try {
            const url = new URL(component.relativeUrl, baseUrl);
            const base = new URL(baseUrl);
            if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
                throw new Error(`${label} URL 越出配置更新源`);
            }
            const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (!response.body) throw new Error(`${label}响应缺少数据流`);

            let receivedBytes = 0;
            const hash = crypto.createHash('sha256');
            const hasher = new Transform({
                transform(chunk, _encoding, callback) {
                    receivedBytes += chunk.length;
                    if (receivedBytes > component.size) {
                        callback(new Error(`${label}实际大小超过签名清单`));
                        return;
                    }
                    hash.update(chunk);
                    callback(null, chunk);
                }
            });
            await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
            await pipeline(
                Readable.fromWeb(response.body),
                hasher,
                fs.createWriteStream(temporaryPath, { flags: 'wx' })
            );
            const actualHash = hash.digest('hex');
            if (receivedBytes !== component.size || actualHash !== component.sha256) {
                throw new Error(`${label}大小/SHA-256 不匹配，实际 ${receivedBytes}/${actualHash}`);
            }
            await fs.promises.rename(temporaryPath, destinationPath);
            return destinationPath;
        } catch (error) {
            errors.push(`${baseUrl}: ${error.message}`);
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
        }
    }
    throw new Error(`下载${label}失败: ${errors.join('；')}`);
}

async function downloadCodeArchive(candidate, destinationPath, baseUrls) {
    return downloadComponentArchive(candidate, candidate.code, destinationPath, baseUrls, '代码包');
}

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

async function extractZipSafely(archivePath, destinationRoot) {
    const archiveStat = await fs.promises.stat(archivePath);
    if (!archiveStat.isFile() || archiveStat.size > MAX_ZIP_ARCHIVE_BYTES) {
        throw new Error(`代码 ZIP 文件类型或大小无效: ${archiveStat.size}`);
    }
    const archive = await fs.promises.readFile(archivePath);
    if (archive.length !== archiveStat.size) throw new Error('代码 ZIP 在读取期间发生变化');
    const { entries, directoryOffset } = parseZipEntries(archive);
    await fs.promises.mkdir(destinationRoot, { recursive: false });
    const resolvedRoot = path.resolve(destinationRoot);

    for (const entry of entries) {
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
        const output = fs.createWriteStream(targetPath, { flags: 'wx' });
        const verifier = createZipEntryVerifier(entry);
        if (entry.compressionMethod === 8) {
            await pipeline(input, createInflateRaw(), verifier, output);
        } else {
            await pipeline(input, verifier, output);
        }
    }
}

function resolveManagedPath(projectRoot, relativePath, label) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
        throw new Error(`${label} 相对路径无效`);
    }
    const resolvedRoot = path.resolve(projectRoot);
    const resolved = path.resolve(resolvedRoot, relativePath);
    const pathFromRoot = path.relative(resolvedRoot, resolved);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(pathFromRoot)) {
        throw new Error(`${label} 路径越出项目根目录`);
    }
    return resolved;
}

async function writeJsonAtomically(filePath, value) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.writeFile(temporaryPath, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    try {
        await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
        if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code) || !fs.existsSync(filePath)) {
            await fs.promises.rm(temporaryPath, { force: true });
            throw error;
        }
        const backupPath = `${filePath}.previous-${process.pid}-${Date.now()}`;
        await fs.promises.rename(filePath, backupPath);
        try {
            await fs.promises.rename(temporaryPath, filePath);
        } catch (replaceError) {
            await fs.promises.rename(backupPath, filePath).catch(() => {});
            await fs.promises.rm(temporaryPath, { force: true });
            throw replaceError;
        }
        await fs.promises.rm(backupPath, { force: true });
    }
}

function resolveSeedPath(releaseRoot, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' ||
        relativePath.startsWith('/') || relativePath.includes('\\') ||
        relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error(`下载的 release 种子路径无效: ${relativePath}`);
    }
    const resolved = path.resolve(releaseRoot, ...relativePath.split('/'));
    const fromRoot = path.relative(releaseRoot, resolved);
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
        throw new Error(`下载的 release 种子路径越界: ${relativePath}`);
    }
    return resolved;
}

async function ensureSeedDirectory(releaseRoot, targetDirectory) {
    const relativePath = path.relative(releaseRoot, targetDirectory);
    if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error(`release 种子目录越界: ${targetDirectory}`);
    }
    const rootStat = await fs.promises.lstat(releaseRoot).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (!rootStat) await fs.promises.mkdir(releaseRoot, { recursive: true });
    else if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`release 数据根必须是普通目录: ${releaseRoot}`);

    let currentPath = releaseRoot;
    for (const segment of relativePath ? relativePath.split(path.sep) : []) {
        currentPath = path.join(currentPath, segment);
        const stat = await fs.promises.lstat(currentPath).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (!stat) await fs.promises.mkdir(currentPath);
        else if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`release 种子目录包含非普通目录: ${currentPath}`);
    }
}

function isLatestSeedPath(relativePath) {
    return /^task\/[^/]+\/results\/latest$/.test(relativePath);
}

async function mergeSeedEntry(stagingRoot, releaseRoot, relativePath, copied) {
    const sourcePath = path.join(stagingRoot, ...relativePath.split('/'));
    const targetPath = resolveSeedPath(releaseRoot, relativePath);
    const sourceStat = await fs.promises.lstat(sourcePath);
    if (sourceStat.isSymbolicLink()) throw new Error(`下载的 release 种子 ZIP 不允许符号链接: ${relativePath}`);
    if (sourceStat.isDirectory()) {
        await ensureSeedDirectory(releaseRoot, targetPath);
        for (const child of (await fs.promises.readdir(sourcePath)).sort()) {
            await mergeSeedEntry(stagingRoot, releaseRoot, `${relativePath}/${child}`, copied);
        }
        return;
    }
    if (!sourceStat.isFile()) throw new Error(`下载的 release 种子包含特殊文件: ${relativePath}`);

    const existing = await fs.promises.lstat(targetPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    if (existing) return;

    if (isLatestSeedPath(relativePath)) {
        const instanceId = (await fs.promises.readFile(sourcePath, 'utf8')).trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(instanceId)) {
            throw new Error(`release 任务 latest marker 无效: ${relativePath}`);
        }
        const resultsDirectory = path.dirname(targetPath);
        const instanceDirectory = path.join(resultsDirectory, instanceId);
        await ensureSeedDirectory(releaseRoot, instanceDirectory);
        if (process.platform === 'win32') await fs.promises.symlink(instanceDirectory, targetPath, 'junction');
        else await fs.promises.symlink(instanceId, targetPath);
        copied.links += 1;
        return;
    }

    await ensureSeedDirectory(releaseRoot, path.dirname(targetPath));
    try {
        await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
        copied.files += 1;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

async function hasReleaseRuntimeSeeds(projectRoot) {
    const releaseRoot = path.join(projectRoot, 'release');
    const [config, userConfig, tasks] = await Promise.all([
        fs.promises.lstat(path.join(releaseRoot, 'config', 'config.json')).catch(() => null),
        fs.promises.lstat(path.join(releaseRoot, 'userconfig')).catch(() => null),
        fs.promises.lstat(path.join(releaseRoot, 'task')).catch(() => null)
    ]);
    return Boolean(config?.isFile() && !config.isSymbolicLink() &&
        userConfig?.isDirectory() && !userConfig.isSymbolicLink() &&
        tasks?.isDirectory() && !tasks.isSymbolicLink());
}

async function seedReleaseRuntimeFiles(projectRoot, candidate, baseUrls) {
    const updateRoot = path.join(projectRoot, 'updates', 'allserver-min');
    const seedStatePath = path.join(updateRoot, 'release-seeds.json');
    let previousState = null;
    try {
        previousState = JSON.parse(await fs.promises.readFile(seedStatePath, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`读取 release 种子状态失败: ${error.message}`);
    }
    if (!candidate?.seeds) {
        if (await hasReleaseRuntimeSeeds(projectRoot)) {
            console.warn('[Node min] 更新清单暂未提供 nodeMinSeeds，继续使用已有 release 配置和任务');
            return;
        }
        throw new Error('更新清单缺少 nodeMinSeeds；请先构建并发布包含 release 配置和任务的 Offline 更新包');
    }
    const seeds = candidate.seeds;
    if (Number.isSafeInteger(previousState?.version) && previousState.version > seeds.version) {
        if (await hasReleaseRuntimeSeeds(projectRoot)) return;
        throw new Error(`当前更新源的 nodeMinSeeds v${seeds.version} 低于本地已应用版本 v${previousState.version}，且本地 release 初始化数据不完整`);
    }
    if (previousState?.schemaVersion === 1 && previousState.version === seeds.version) {
        if (previousState.sha256 !== seeds.sha256) throw new Error(`nodeMinSeeds v${seeds.version} 同版本内容不一致`);
    }

    const archivePath = path.join(updateRoot, 'downloads', `node-min-seeds-v${seeds.version}-${seeds.sha256.slice(0, 12)}.zip`);
    let archiveIsValid = false;
    try {
        const archiveStat = await fs.promises.stat(archivePath);
        archiveIsValid = archiveStat.isFile() && archiveStat.size === seeds.size && await hashFile(archivePath) === seeds.sha256;
    } catch {}
    if (!archiveIsValid) {
        await fs.promises.rm(archivePath, { force: true });
        await downloadComponentArchive(candidate, seeds, archivePath, baseUrls, 'release 初始数据包');
    }

    const stagingRoot = path.join(updateRoot, 'staging', `release-seeds-${seeds.version}-${process.pid}-${Date.now()}`);
    await fs.promises.mkdir(path.dirname(stagingRoot), { recursive: true });
    try {
        await extractZipSafely(archivePath, stagingRoot);
        const allowedRoots = new Set(['config', 'userconfig', 'task']);
        for (const entry of await fs.promises.readdir(stagingRoot)) {
            if (!allowedRoots.has(entry)) throw new Error(`release 种子 ZIP 包含未授权目录: ${entry}`);
        }
        for (const directory of allowedRoots) {
            await fs.promises.mkdir(path.join(stagingRoot, directory), { recursive: true });
        }
        const configStat = await fs.promises.lstat(path.join(stagingRoot, 'config', 'config.json')).catch(() => null);
        if (!configStat?.isFile() || configStat.isSymbolicLink()) throw new Error('release 种子 ZIP 缺少普通文件 config/config.json');
        const taskStat = await fs.promises.lstat(path.join(stagingRoot, 'task'));
        const userConfigStat = await fs.promises.lstat(path.join(stagingRoot, 'userconfig'));
        if (!taskStat.isDirectory() || taskStat.isSymbolicLink() || !userConfigStat.isDirectory() || userConfigStat.isSymbolicLink()) {
            throw new Error('release 种子 ZIP 的 task/userconfig 目录无效');
        }

        const releaseRoot = path.resolve(projectRoot, 'release');
        const copied = { files: 0, links: 0 };
        await ensureSeedDirectory(releaseRoot, releaseRoot);
        for (const directory of allowedRoots) await mergeSeedEntry(stagingRoot, releaseRoot, directory, copied);
        await writeJsonAtomically(seedStatePath, {
            schemaVersion: 1,
            version: seeds.version,
            sha256: seeds.sha256,
            seededAt: new Date().toISOString()
        });
        console.log(`[Node min] 已从服务器初始化 release 配置和任务：新增 ${copied.files} 个文件、${copied.links} 个目录链接`);
    } finally {
        await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
}

function relativeToRoot(projectRoot, targetPath) {
    const relativePath = path.relative(projectRoot, targetPath);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
        throw new Error(`运行目录必须位于项目根目录内: ${targetPath}`);
    }
    return relativePath.split(path.sep).join('/');
}

async function readActiveState(projectRoot, activeFile) {
    let parsed;
    try {
        parsed = JSON.parse(await fs.promises.readFile(activeFile, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw new Error(`读取 Node min 活动版本失败: ${error.message}`);
    }
    if (!parsed || parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.codeVersion) ||
        parsed.codeVersion < 1 || !isSha256(parsed.lockSha256) || typeof parsed.codeDirectory !== 'string' ||
        typeof parsed.nodeModulesDirectory !== 'string') {
        throw new Error('Node min active-release.json 字段无效');
    }
    const codeRoot = resolveManagedPath(projectRoot, parsed.codeDirectory, '代码目录');
    const nodeModulesRoot = resolveManagedPath(projectRoot, parsed.nodeModulesDirectory, '依赖目录');
    const entrypoint = path.join(codeRoot, ENTRYPOINT);
    if (!fs.existsSync(entrypoint) || !fs.existsSync(path.join(codeRoot, 'package-lock.json')) ||
        !fs.existsSync(path.join(nodeModulesRoot, 'express', 'package.json'))) {
        throw new Error('Node min 活动代码或依赖目录不完整');
    }
    return {
        schemaVersion: 1,
        codeVersion: parsed.codeVersion,
        lockSha256: parsed.lockSha256,
        codeSha256: parsed.codeSha256,
        codeDirectory: parsed.codeDirectory,
        nodeModulesDirectory: parsed.nodeModulesDirectory,
        pendingHealth: parsed.pendingHealth === true,
        previous: parsed.previous && typeof parsed.previous === 'object' ? parsed.previous : null,
        codeRoot,
        nodeModulesRoot
    };
}

function createEmptyContext(projectRoot) {
    return {
        schemaVersion: 1,
        codeVersion: 0,
        lockSha256: null,
        codeSha256: null,
        codeDirectory: '.',
        nodeModulesDirectory: 'node_modules',
        pendingHealth: false,
        previous: null,
        codeRoot: projectRoot,
        nodeModulesRoot: path.join(projectRoot, 'node_modules')
    };
}

function contextSnapshot(context) {
    return {
        codeVersion: context.codeVersion,
        lockSha256: context.lockSha256,
        codeSha256: context.codeSha256 || null,
        codeDirectory: context.codeDirectory,
        nodeModulesDirectory: context.nodeModulesDirectory
    };
}

function activeStateFromContext(context, pendingHealth = false, previous = null) {
    if (context.codeVersion < 1) return null;
    return {
        schemaVersion: 1,
        codeVersion: context.codeVersion,
        lockSha256: context.lockSha256,
        codeSha256: context.codeSha256,
        codeDirectory: context.codeDirectory,
        nodeModulesDirectory: context.nodeModulesDirectory,
        pendingHealth,
        previous
    };
}

async function saveActiveState(activeFile, state) {
    if (!state) {
        await fs.promises.rm(activeFile, { force: true });
        return;
    }
    await writeJsonAtomically(activeFile, state);
}

function parsePackageLockVersion(codeRoot) {
    return fs.promises.readFile(path.join(codeRoot, 'package-lock.json'))
        .then((buffer) => ({ buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex') }));
}

function spawnNpmCi(codeRoot) {
    return new Promise((resolve, reject) => {
        const npmArgs = ['ci', '--omit=dev', '--ignore-scripts'];
        const npmExecPath = process.env.npm_execpath;
        const command = npmExecPath ? process.execPath : 'npm';
        const args = npmExecPath ? [npmExecPath, ...npmArgs] : npmArgs;
        const child = spawn(command, args, {
            cwd: codeRoot,
            env: { ...process.env, CI: '1', npm_config_audit: 'false', npm_config_fund: 'false' },
            stdio: 'inherit',
            shell: process.platform === 'win32' && !npmExecPath
        });
        child.once('error', (error) => reject(new Error(`启动 npm ci 失败: ${error.message}`, { cause: error })));
        child.once('exit', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`npm ci 失败: code=${code}, signal=${signal || 'none'}`));
        });
    });
}

async function prepareRelease(options) {
    const { projectRoot, updateRoot, candidate, currentContext } = options;
    const code = candidate.code;
    const codeRelativeDirectory = path.join('updates', 'allserver-min', 'code', `code-v${code.version}`);
    const finalCodeRoot = resolveManagedPath(projectRoot, codeRelativeDirectory, '新代码目录');
    const zipDirectory = path.join(updateRoot, 'downloads');
    const archivePath = path.join(zipDirectory, `code-v${code.version}-${code.sha256.slice(0, 12)}.zip`);
    await fs.promises.mkdir(zipDirectory, { recursive: true });

    if (fs.existsSync(finalCodeRoot)) {
        const markerPath = path.join(finalCodeRoot, '.allserver-min-release.json');
        let marker;
        try { marker = JSON.parse(await fs.promises.readFile(markerPath, 'utf8')); } catch {}
        if (marker?.codeVersion !== code.version || marker?.sha256 !== code.sha256) {
            throw new Error(`Node min 代码版本目录已存在但校验标记不匹配: ${finalCodeRoot}`);
        }
        const lockInfo = await parsePackageLockVersion(finalCodeRoot);
        if (lockInfo.sha256 !== code.requiredLockSha256) throw new Error('已缓存代码包 lock 指纹与签名清单不匹配');
        let nodeModulesRoot = currentContext.lockSha256 === lockInfo.sha256
            ? currentContext.nodeModulesRoot
            : path.join(finalCodeRoot, 'node_modules');
        if (!fs.existsSync(path.join(nodeModulesRoot, 'express', 'package.json'))) {
            await spawnNpmCi(finalCodeRoot);
            nodeModulesRoot = path.join(finalCodeRoot, 'node_modules');
        }
        return createPreparedContext(projectRoot, code, codeRelativeDirectory, nodeModulesRoot, lockInfo.sha256);
    }

    const stageRoot = path.join(updateRoot, 'staging', `code-v${code.version}-${process.pid}-${Date.now()}`);
    await fs.promises.mkdir(path.dirname(stageRoot), { recursive: true });
    await fs.promises.rm(stageRoot, { recursive: true, force: true });
    try {
        let archiveIsValid = false;
        try {
            const archiveStat = await fs.promises.stat(archivePath);
            archiveIsValid = archiveStat.isFile() && archiveStat.size === code.size &&
                await hashFile(archivePath) === code.sha256;
        } catch {}
        if (!archiveIsValid) {
            await fs.promises.rm(archivePath, { force: true });
            await downloadCodeArchive(candidate, archivePath, options.baseUrls);
        }
        await extractZipSafely(archivePath, stageRoot);
        for (const relativePath of [ENTRYPOINT, 'package.json', 'package-lock.json']) {
            const filePath = path.join(stageRoot, relativePath);
            const stat = await fs.promises.lstat(filePath).catch(() => null);
            if (!stat?.isFile() || stat.isSymbolicLink()) {
                throw new Error(`Offline 代码包缺少普通文件: ${relativePath}`);
            }
        }
        const packageJson = JSON.parse(await fs.promises.readFile(path.join(stageRoot, 'package.json'), 'utf8'));
        if (!packageJson.dependencies?.express) throw new Error('Offline 代码包 package.json 缺少 express 生产依赖');
        const lockInfo = await parsePackageLockVersion(stageRoot);
        if (lockInfo.sha256 !== code.requiredLockSha256) {
            throw new Error('代码包 package-lock.json 与签名清单 requiredLockSha256 不一致');
        }

        let nodeModulesRoot;
        if (currentContext.lockSha256 === lockInfo.sha256 &&
            fs.existsSync(path.join(currentContext.nodeModulesRoot, 'express', 'package.json'))) {
            nodeModulesRoot = currentContext.nodeModulesRoot;
        } else {
            console.log(`[Node min] code v${code.version} 的依赖锁文件变化，使用目标机 npm 安装生产依赖`);
            await spawnNpmCi(stageRoot);
            nodeModulesRoot = path.join(finalCodeRoot, 'node_modules');
            if (!fs.existsSync(path.join(stageRoot, 'node_modules', 'express', 'package.json'))) {
                throw new Error('npm ci 完成后仍未找到 express');
            }
        }

        await fs.promises.writeFile(path.join(stageRoot, '.allserver-min-release.json'), JSON.stringify({
            schemaVersion: 1,
            codeVersion: code.version,
            sha256: code.sha256,
            lockSha256: lockInfo.sha256
        }, null, 2) + '\n', { flag: 'wx' });
        await fs.promises.mkdir(path.dirname(finalCodeRoot), { recursive: true });
        await fs.promises.rename(stageRoot, finalCodeRoot);
        return createPreparedContext(projectRoot, code, codeRelativeDirectory, nodeModulesRoot, lockInfo.sha256);
    } catch (error) {
        await fs.promises.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

function createPreparedContext(projectRoot, code, codeRelativeDirectory, nodeModulesRoot, lockSha256) {
    const finalCodeRoot = resolveManagedPath(projectRoot, codeRelativeDirectory, '活动代码目录');
    return {
        schemaVersion: 1,
        codeVersion: code.version,
        lockSha256,
        codeSha256: code.sha256,
        codeDirectory: codeRelativeDirectory.split(path.sep).join('/'),
        nodeModulesDirectory: relativeToRoot(projectRoot, nodeModulesRoot),
        pendingHealth: true,
        previous: null,
        codeRoot: finalCodeRoot,
        nodeModulesRoot
    };
}

function createServerChild(context, projectRoot, onReady, onExit) {
    const entrypoint = path.join(context.codeRoot, ENTRYPOINT);
    const environment = {
        ...process.env,
        AASC_PROJECT_ROOT: projectRoot,
        AASC_SERVER_CHILD: '1',
        AASC_RELEASE_MODE: '1',
        AASC_NODE_MODULES_DIR: context.nodeModulesRoot,
        NODE_PATH: [context.nodeModulesRoot, process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
    };
    const child = fork(entrypoint, ['--no-tui', '--release'], {
        cwd: projectRoot,
        env: environment,
        execArgv: ['--openssl-legacy-provider', '--expose-gc'],
        stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });
    const instance = {
        child,
        context,
        ready: false,
        restartRequested: false,
        intentionalStop: false,
        readyTimer: null,
        readyResolve: null,
        readyReject: null,
        exitResolve: null,
        exitPromise: null
    };
    instance.exitPromise = new Promise((resolve) => { instance.exitResolve = resolve; });
    instance.readyPromise = new Promise((resolve, reject) => {
        instance.readyResolve = resolve;
        instance.readyReject = reject;
        instance.readyTimer = setTimeout(() => reject(new Error('服务在健康等待时间内未报告 serverReady')), SERVER_READY_TIMEOUT_MS);
    });
    // 背景进程退出可能早于调用方 await readyPromise；显式挂上拒绝处理，实际错误仍由 await 接收。
    instance.readyPromise.catch(() => {});
    child.on('message', (message) => {
        if (message?.type === 'restartRequested') {
            instance.restartRequested = true;
            return;
        }
        if (message?.type === 'serverReady' && !instance.ready) {
            instance.ready = true;
            clearTimeout(instance.readyTimer);
            instance.readyResolve();
            onReady(instance);
        }
    });
    child.once('error', (error) => {
        clearTimeout(instance.readyTimer);
        instance.readyReject(new Error(`服务器进程错误: ${error.message}`, { cause: error }));
    });
    child.once('exit', (code, signal) => {
        clearTimeout(instance.readyTimer);
        if (!instance.ready) instance.readyReject(new Error(`服务器在 ready 前退出: code=${code}, signal=${signal || 'none'}`));
        instance.exitResolve({ code, signal });
        onExit(instance, { code, signal });
    });
    return instance;
}

async function waitForExit(instance, timeoutMs = SERVER_STOP_TIMEOUT_MS) {
    let timeoutHandle;
    const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
    });
    const result = await Promise.race([instance.exitPromise, timeout]);
    clearTimeout(timeoutHandle);
    return result;
}

async function stopServer(instance) {
    if (!instance || instance.child.exitCode !== null || instance.child.signalCode !== null) return;
    instance.intentionalStop = true;
    try { instance.child.kill('SIGTERM'); } catch {}
    const exited = await waitForExit(instance);
    if (exited) return;
    try { instance.child.kill('SIGKILL'); } catch {}
    await waitForExit(instance, 3_000);
}

async function setStateForContext(activeFile, context, pendingHealth = false, previous = null) {
    await saveActiveState(activeFile, {
        schemaVersion: 1,
        codeVersion: context.codeVersion,
        lockSha256: context.lockSha256,
        codeSha256: context.codeSha256,
        codeDirectory: context.codeDirectory,
        nodeModulesDirectory: context.nodeModulesDirectory,
        pendingHealth,
        previous
    });
}

async function startManager(options) {
    const { projectRoot, intervalMs } = options;
    const updateRoot = path.join(projectRoot, 'updates', 'allserver-min');
    const activeFile = path.join(updateRoot, 'active-release.json');
    const baseUrls = resolveBaseUrls();
    let startupManifestResult;
    try {
        const candidate = await fetchManifestFromSources(baseUrls);
        startupManifestResult = { candidate };
    } catch (error) {
        if (!await hasReleaseRuntimeSeeds(projectRoot)) {
            throw new Error(`无法从服务器读取用于下载 release 初始数据的签名清单: ${error.message}`, { cause: error });
        }
        startupManifestResult = { error };
        console.warn(`[Node min] 无法读取最新签名清单，继续使用本地 release 数据: ${error.message}`);
    }
    await seedReleaseRuntimeFiles(projectRoot, startupManifestResult.candidate, baseUrls);
    let currentContext = await readActiveState(projectRoot, activeFile);
    let currentInstance = null;
    let stopping = false;
    let transitioning = false;
    let checking = false;
    let crashCount = 0;
    let restartTimer = null;
    let updateTimer = null;

    const onReady = (instance) => {
        if (instance !== currentInstance) return;
        crashCount = 0;
        console.log(`[Node min] 服务已就绪，code v${instance.context.codeVersion}`);
    };
    const onExit = (instance, result) => {
        if (instance !== currentInstance || instance.intentionalStop || transitioning || stopping) return;
        if (!instance.ready) return;
        if (instance.restartRequested) {
            crashCount = 0;
            console.log('[Node min] 服务请求重启，1 秒后重新启动');
            restartTimer = setTimeout(() => {
                restartTimer = null;
                if (stopping || transitioning) return;
                currentInstance = createServerChild(currentContext, projectRoot, onReady, onExit);
                currentInstance.readyPromise.catch((error) => console.error(`[Node min] 服务重启未就绪: ${error.message}`));
            }, 1_000);
            return;
        }
        if (result.code === 0) {
            console.log('[Node min] 服务正常退出');
            stopping = true;
            if (updateTimer) clearInterval(updateTimer);
            return;
        }
        crashCount += 1;
        if (crashCount >= 5) {
            console.error(`[Node min] 服务连续异常退出 ${crashCount} 次，停止自动重启`);
            stopping = true;
            if (updateTimer) clearInterval(updateTimer);
            process.exitCode = result.code || 1;
            return;
        }
        console.error(`[Node min] 服务进程退出，1 秒后重启 (${crashCount}/5): code=${result.code}, signal=${result.signal || 'none'}`);
        restartTimer = setTimeout(() => {
            restartTimer = null;
            if (stopping || transitioning) return;
            currentInstance = createServerChild(currentContext, projectRoot, onReady, onExit);
            currentInstance.readyPromise.catch((error) => console.error(`[Node min] 服务重启未就绪: ${error.message}`));
        }, 1_000);
    };

    async function launchContext(context) {
        currentContext = context;
        currentInstance = createServerChild(context, projectRoot, onReady, onExit);
        await currentInstance.readyPromise;
        if (context.pendingHealth && context.codeVersion > 0) {
            const healthy = { ...context, pendingHealth: false, previous: null };
            await setStateForContext(activeFile, healthy, false, null);
            currentContext = healthy;
        }
    }

    async function rollbackPendingRelease(context) {
        const previous = context.previous;
        if (!previous) {
            await saveActiveState(activeFile, null);
            return null;
        }
        const previousCodeRoot = resolveManagedPath(projectRoot, previous.codeDirectory, '回退代码目录');
        const previousNodeModulesRoot = resolveManagedPath(projectRoot, previous.nodeModulesDirectory, '回退依赖目录');
        const fallback = {
            schemaVersion: 1,
            codeVersion: previous.codeVersion,
            lockSha256: previous.lockSha256,
            codeSha256: previous.codeSha256 || null,
            codeDirectory: previous.codeDirectory,
            nodeModulesDirectory: previous.nodeModulesDirectory,
            pendingHealth: false,
            previous: null,
            codeRoot: previousCodeRoot,
            nodeModulesRoot: previousNodeModulesRoot
        };
        if (fallback.codeVersion === 0) {
            await saveActiveState(activeFile, null);
        } else {
            await setStateForContext(activeFile, fallback, false, null);
        }
        return fallback;
    }

    async function switchToContext(nextContext) {
        const previousContext = currentContext;
        const previousSnapshot = previousContext?.codeVersion > 0 ? contextSnapshot(previousContext) : null;
        const pendingContext = {
            ...nextContext,
            pendingHealth: true,
            previous: previousSnapshot
        };
        await setStateForContext(activeFile, pendingContext, true, previousSnapshot);
        transitioning = true;
        const oldInstance = currentInstance;
        await stopServer(oldInstance);
        currentContext = pendingContext;
        try {
            currentInstance = createServerChild(pendingContext, projectRoot, onReady, onExit);
            await currentInstance.readyPromise;
            const healthyContext = { ...pendingContext, pendingHealth: false, previous: null };
            await setStateForContext(activeFile, healthyContext, false, null);
            currentContext = healthyContext;
            console.log(`[Node min] 已切换到 code v${healthyContext.codeVersion}`);
            return true;
        } catch (error) {
            await stopServer(currentInstance);
            const fallback = await rollbackPendingRelease(pendingContext);
            currentContext = fallback;
            if (!fallback) {
                currentInstance = null;
                throw new Error(`首次服务代码 v${nextContext.codeVersion} 启动失败，尚无可回退版本: ${error.message}`, { cause: error });
            }
            console.error(`[Node min] code v${nextContext.codeVersion} 启动失败，已恢复旧版本: ${error.message}`);
            currentInstance = createServerChild(fallback, projectRoot, onReady, onExit);
            await currentInstance.readyPromise;
            return false;
        } finally {
            transitioning = false;
        }
    }

    async function checkAndApplyUpdate() {
        if (checking || stopping || transitioning) return false;
        checking = true;
        try {
            let candidate;
            if (startupManifestResult) {
                const result = startupManifestResult;
                startupManifestResult = null;
                if (result.error) throw result.error;
                candidate = result.candidate;
            } else {
                candidate = await fetchManifestFromSources(baseUrls);
            }
            if (!candidate) {
                console.log('[Node min] 当前更新源没有签名清单');
                return false;
            }
            const activeVersion = currentContext?.codeVersion || 0;
            if (candidate.code.version < activeVersion) {
                console.warn(`[Node min] 更新源 code v${candidate.code.version} 低于活动版本 v${currentContext.codeVersion}，跳过`);
                return false;
            }
            if (candidate.code.version === activeVersion) {
                if (currentContext.codeSha256 && currentContext.codeSha256 !== candidate.code.sha256) {
                    throw new Error(`活动 code v${currentContext.codeVersion} 与清单同版本内容冲突`);
                }
                return false;
            }

            console.log(`[Node min] 发现 code v${candidate.code.version}，准备安全更新`);
            const prepared = await prepareRelease({
                projectRoot,
                updateRoot,
                candidate,
                currentContext: currentContext || createEmptyContext(projectRoot),
                baseUrls
            });
            return await switchToContext(prepared);
        } catch (error) {
            if (!currentContext) throw error;
            console.error(`[Node min] 更新检查失败，继续使用 code v${currentContext.codeVersion}: ${error.message}`);
            return false;
        } finally {
            checking = false;
        }
    }

    const storedContext = await readActiveState(projectRoot, activeFile);
    if (storedContext?.pendingHealth) {
        currentContext = storedContext;
        try {
            await launchContext(storedContext);
        } catch (error) {
            console.error(`[Node min] 上次更新版本未通过启动检查: ${error.message}`);
            await stopServer(currentInstance);
            currentContext = await rollbackPendingRelease(storedContext);
            if (!currentContext) throw new Error('首次安装的服务代码启动失败，活动版本已清除', { cause: error });
            currentInstance = null;
            await launchContext(currentContext);
        }
    } else if (storedContext) {
        currentContext = storedContext;
        try {
            await launchContext(currentContext);
        } catch (error) {
            await stopServer(currentInstance);
            throw error;
        }
    }

    await checkAndApplyUpdate();
    if (!currentInstance) {
        throw new Error('当前没有已安装服务代码，且无法从 Offline 更新源取得首个 code 包');
    }
    if (intervalMs > 0) {
        updateTimer = setInterval(() => {
            checkAndApplyUpdate().catch((error) => console.error(`[Node min] 定时更新错误: ${error.message}`));
        }, intervalMs);
        updateTimer.unref?.();
    }

    const shutdown = async (signal) => {
        if (stopping) return;
        stopping = true;
        transitioning = true;
        if (updateTimer) clearInterval(updateTimer);
        if (restartTimer) clearTimeout(restartTimer);
        console.log(`[Node min] 收到 ${signal}，正在停止服务器`);
        await stopServer(currentInstance);
        process.exitCode = signal === 'SIGINT' ? 130 : 143;
    };
    process.once('SIGINT', () => shutdown('SIGINT').catch((error) => console.error(error.message)));
    process.once('SIGTERM', () => shutdown('SIGTERM').catch((error) => console.error(error.message)));
    return { checkAndApplyUpdate, shutdown };
}

async function runCheckOnly(projectRoot) {
    const candidate = await fetchManifestFromSources();
    if (!candidate) {
        process.stdout.write('当前 Offline 更新源没有清单\n');
        return;
    }
    process.stdout.write(`签名清单有效，最新服务代码版本为 v${candidate.code.version}\n`);
}

async function main(argv = process.argv.slice(2)) {
    const options = parseArguments(argv);
    if (options.help) {
        printHelp();
        return;
    }
    assertSupportedNodeVersion();
    const projectRoot = path.resolve(options.projectRoot);
    if (options.checkOnly) {
        await runCheckOnly(projectRoot);
        return;
    }
    await startManager({ ...options, projectRoot });
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`[Node min] 启动失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    ENTRYPOINT,
    MIN_NODE_VERSION,
    RECOMMENDED_NODE_MAJOR,
    RECOMMENDED_NODE_VERSION_AT_RECORD,
    DEVELOPMENT_NODE_VERSION,
    UPDATE_BASE_URLS,
    canonicalJson,
    parseArguments,
    validateCodeManifest,
    validateRelativeArtifactPath,
    extractZipSafely,
    main
};
