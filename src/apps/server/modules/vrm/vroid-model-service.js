'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { Readable } = require('node:stream');
const { zstdDecompressSync } = require('node:zlib');

const DEFAULT_VROID_MODEL_URL = 'https://hub.vroid.com/en/characters/1786977751194326803/models/3931412591784052736';
const DEFAULT_STATIC_MMD_BASE_URL = 'http://c.aasc.us/mnt/mmd/';
const DEFAULT_STATIC_MMD_FILE = 'default-vroid.vrm.zst';
const STATIC_MMD_HOST = 'c.aasc.us';
const STATIC_MMD_PATH = '/mnt/mmd/';
const STATIC_MMD_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:vrm|glb)(?:\.zst)?$/u;
const VROID_HOST = 'hub.vroid.com';
const VROID_API_VERSION = '11';
const MAX_REDIRECTS = 3;
const MAX_MODEL_BYTES = 64 * 1024 * 1024;
const STATIC_MMD_TIMEOUT_MS = 300000;
const MAX_DECOMPRESSED_MODEL_BYTES = 128 * 1024 * 1024;
const VROID_PREVIEW_EXTENSION = 'PIXIV_vroid_hub_preview_mesh';
const VROID_PREVIEW_BASE_SEEDS = Object.freeze({
    '58245139': 9402684,
    '2664362260': 1972414975,
    '26232110': 28328705
});
const VROID_PREVIEW_VIEWER_INCREMENT = 2352940687395663367n;
const VROID_PREVIEW_ORIGIN = 'https://hub.vroid.com';
const VROID_PREVIEW_MULTIPLIER = 0.125;
const VROID_PREVIEW_TEXTURE_SIZE = 256;
const VROID_PREVIEW_TEXTURE_BYTES = VROID_PREVIEW_TEXTURE_SIZE * VROID_PREVIEW_TEXTURE_SIZE * 4;

function createVroidError(message, statusCode = 502) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function isNumericId(value) {
    return typeof value === 'string' && /^\d{6,32}$/u.test(value);
}

function normalizeStaticMmdFileName(fileName = DEFAULT_STATIC_MMD_FILE) {
    if (typeof fileName !== 'string' || !STATIC_MMD_FILE_PATTERN.test(fileName)) {
        throw createVroidError('MMD 模型文件名无效，只允许单层 .vrm 或 .glb 文件', 400);
    }
    return fileName;
}

function createStaticMmdModelProfile(fileName = DEFAULT_STATIC_MMD_FILE, metadata = {}) {
    const normalizedFileName = normalizeStaticMmdFileName(fileName);
    const query = new URLSearchParams({ file: normalizedFileName });
    return {
        resourceId: metadata.resourceId || `mmd:${normalizedFileName}`,
        version: metadata.version || 'static-v1',
        fileName: normalizedFileName,
        sha256: typeof metadata.sha256 === 'string' ? metadata.sha256 : null,
        modelUrl: `/api/vrm/model/static?${query.toString()}`,
        cacheKey: `aasc-mmd:${normalizedFileName}:${metadata.version || 'static-v1'}`
    };
}

async function resolveStaticMmdAssetUrl(
    fileName = DEFAULT_STATIC_MMD_FILE,
    { baseUrl = DEFAULT_STATIC_MMD_BASE_URL, lookup = dns.lookup } = {}
) {
    const normalizedFileName = normalizeStaticMmdFileName(fileName);
    let parsed;
    try {
        parsed = new URL(baseUrl);
    } catch (error) {
        throw createVroidError('MMD 静态资源地址不是有效 URL', 400);
    }
    if (parsed.protocol !== 'http:' || parsed.hostname.toLowerCase() !== STATIC_MMD_HOST
        || parsed.pathname !== STATIC_MMD_PATH) {
        throw createVroidError('MMD 静态资源地址必须是 http://c.aasc.us/mnt/mmd/', 400);
    }

    const addresses = net.isIP(parsed.hostname)
        ? [{ address: parsed.hostname }]
        : await lookup(parsed.hostname, { all: true, family: 4, verbatim: false });
    const address = Array.isArray(addresses) ? addresses[0]?.address : addresses?.address;
    if (!address || net.isIP(address) !== 4) {
        throw createVroidError('MMD 静态资源域名没有可用 IPv4 地址', 502);
    }

    const resolved = new URL(parsed.toString());
    resolved.hostname = address;
    resolved.pathname = `${STATIC_MMD_PATH}${normalizedFileName}`;
    return resolved;
}

function parseVroidModelUrl(sourceUrl = DEFAULT_VROID_MODEL_URL) {
    let parsed;
    try {
        parsed = new URL(sourceUrl);
    } catch (error) {
        throw createVroidError('VRoid 模型地址不是有效 URL', 400);
    }

    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== VROID_HOST) {
        throw createVroidError('VRoid 模型地址必须使用 https://hub.vroid.com', 400);
    }

    const match = parsed.pathname.match(/^\/(?:[a-z]{2}\/)?characters\/(\d+)\/models\/(\d+)\/?$/u);
    if (!match || !isNumericId(match[1]) || !isNumericId(match[2])) {
        throw createVroidError('VRoid 模型地址必须是 /characters/{characterId}/models/{modelId}', 400);
    }

    return {
        sourceUrl: parsed.toString(),
        characterId: match[1],
        modelId: match[2]
    };
}

function createVroidModelProfile(sourceUrl = DEFAULT_VROID_MODEL_URL, basePath = '/api/vrm/model/file') {
    const parsed = parseVroidModelUrl(sourceUrl);
    const query = new URLSearchParams({
        characterId: parsed.characterId,
        modelId: parsed.modelId
    });
    return {
        resourceId: `vroid:${parsed.modelId}`,
        version: 'optimized-preview',
        sourceUrl: parsed.sourceUrl,
        characterId: parsed.characterId,
        modelId: parsed.modelId,
        modelUrl: `${basePath}?${query.toString()}`,
        cacheKey: `aasc-vrm:${parsed.modelId}:optimized-preview`
    };
}

function isAllowedRedirectTarget(target) {
    if (target.protocol !== 'https:') return false;
    const hostname = target.hostname.toLowerCase();
    return hostname === VROID_HOST || hostname.endsWith('.cloudfront.net');
}

function unwrapVroidModelPayload(input) {
    const payload = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (payload.length >= 4 && payload.subarray(0, 4).toString('ascii') === 'glTF') return payload;
    if (payload.length < 48) throw createVroidError('VRoid 模型加密载荷过短', 502);

    try {
        const decipher = crypto.createDecipheriv(
            'aes-256-cbc',
            payload.subarray(16, 48),
            payload.subarray(0, 16)
        );
        const decrypted = Buffer.concat([
            decipher.update(payload.subarray(48)),
            decipher.final()
        ]);
        if (decrypted.length < 4) throw new Error('解密后载荷过短');
        const expectedLength = decrypted.readUInt32LE(0);
        if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0 || expectedLength > MAX_DECOMPRESSED_MODEL_BYTES) {
            throw new Error(`解压大小无效: ${expectedLength}`);
        }
        const model = zstdDecompressSync(decrypted.subarray(4), {
            maxOutputLength: MAX_DECOMPRESSED_MODEL_BYTES
        });
        if (model.length !== expectedLength) {
            throw new Error(`解压大小不一致: ${model.length}/${expectedLength}`);
        }
        if (model.subarray(0, 4).toString('ascii') !== 'glTF') {
            throw new Error('解压结果不是 GLB');
        }
        return model;
    } catch (error) {
        if (error.statusCode) throw error;
        throw createVroidError(`VRoid 模型载荷解包失败: ${error.message}`, 502);
    }
}

function readGlbChunks(model) {
    if (model.length < 20 || model.subarray(0, 4).toString('ascii') !== 'glTF') {
        throw createVroidError('VRoid 模型不是有效 GLB', 502);
    }
    if (model.readUInt32LE(4) !== 2) throw createVroidError('VRoid 模型 GLB 版本不受支持', 502);
    const jsonChunkLength = model.readUInt32LE(12);
    const jsonChunkType = model.readUInt32LE(16);
    const jsonStart = 20;
    const jsonEnd = jsonStart + jsonChunkLength;
    if (jsonChunkType !== 0x4e4f534a || jsonEnd > model.length) {
        throw createVroidError('VRoid 模型缺少 GLB JSON 块', 502);
    }
    const binHeader = jsonEnd;
    if (binHeader + 8 > model.length || model.readUInt32LE(binHeader + 4) !== 0x004e4942) {
        throw createVroidError('VRoid 模型缺少 GLB BIN 块', 502);
    }
    const binLength = model.readUInt32LE(binHeader);
    const binStart = binHeader + 8;
    const binEnd = binStart + binLength;
    if (binEnd > model.length) throw createVroidError('VRoid 模型 GLB BIN 块越界', 502);
    let json;
    try {
        json = JSON.parse(model.subarray(jsonStart, jsonEnd).toString('utf8').replace(/\s+$/u, ''));
    } catch (error) {
        throw createVroidError(`VRoid 模型 GLB JSON 无法解析: ${error.message}`, 502);
    }
    return { json, binStart, binEnd };
}

function toUint64(value) {
    return BigInt.asUintN(64, BigInt(value));
}

function hashVroidPreviewOrigin(origin) {
    let hash = toUint64(-3750763034362895579n);
    for (const byte of Buffer.from(origin.trim(), 'utf8')) {
        hash = toUint64((hash ^ BigInt(byte)) * 1099511628211n);
    }
    return hash ^ toUint64(-1480337432062562204n);
}

function createVroidPreviewByteGenerator(seed, origin = VROID_PREVIEW_ORIGIN) {
    let state = toUint64(seed) ^ 1864606777725581342n;
    const increment = toUint64(hashVroidPreviewOrigin(origin) ^ VROID_PREVIEW_VIEWER_INCREMENT) | 1n;
    return () => {
        const xorshifted = Number((state >> 45n ^ state >> 27n) & 0xffffffffn) >>> 0;
        const rotation = Number((state >> 59n) & 0xffffffffn) & 31;
        const value = ((xorshifted >>> rotation) | (xorshifted << ((32 - rotation) & 31))) & 255;
        state = toUint64(state * 6364136223846793005n + increment);
        return value;
    };
}

function sha1LastInt32(source) {
    const digest = crypto.createHash('sha1').update(source, 'utf8').digest();
    return digest.readInt32LE(digest.length - 4);
}

function resolveVroidPreviewSeed(extension, sourceUrl) {
    const timestamp = String(extension?.timestamp || '');
    const baseSeed = VROID_PREVIEW_BASE_SEEDS[timestamp];
    if (!Number.isSafeInteger(baseSeed)) throw createVroidError(`VRoid 预览时间戳不受支持: ${timestamp}`, 502);
    const parsed = new URL(sourceUrl);
    const pathMatch = parsed.pathname.match(/(?:^|\/)(model_optimized_files\/[^/]+\/[^/]+\.vrm)$/u);
    if (!pathMatch) throw createVroidError('VRoid 预览资源路径无法解析', 502);
    return Number(BigInt(baseSeed) ^ BigInt(sha1LastInt32(pathMatch[1])));
}

function restoreVroidPreviewMesh(input, sourceUrl) {
    const model = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(input);
    const { json, binStart } = readGlbChunks(model);
    const extension = json.extensions?.[VROID_PREVIEW_EXTENSION];
    if (!extension) return model;
    if (String(extension.version || '5.0') !== '5.0') {
        throw createVroidError(`VRoid 预览网格版本不受支持: ${extension.version}`, 502);
    }

    const seed = resolveVroidPreviewSeed(extension, sourceUrl);
    const texture = Buffer.allocUnsafe(VROID_PREVIEW_TEXTURE_BYTES);
    const textureByte = createVroidPreviewByteGenerator(seed);
    for (let offset = 0; offset < texture.length; offset += 4) {
        texture[offset] = textureByte();
        texture[offset + 1] = textureByte();
        texture[offset + 2] = textureByte();
        texture[offset + 3] = 255;
    }

    const positionAccessors = new Set();
    for (const mesh of json.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const accessorIndex = primitive.attributes?.POSITION;
            if (Number.isInteger(accessorIndex)) positionAccessors.add(accessorIndex);
        }
    }

    for (const accessorIndex of positionAccessors) {
        const accessor = json.accessors?.[accessorIndex];
        const bufferView = accessor && json.bufferViews?.[accessor.bufferView];
        if (!accessor || !bufferView || accessor.type !== 'VEC3' || accessor.componentType !== 5126) {
            throw createVroidError(`VRoid POSITION accessor 无法处理: ${accessorIndex}`, 502);
        }
        const count = Number(accessor.count);
        const stride = Number(bufferView.byteStride || 12);
        const byteOffset = binStart + Number(bufferView.byteOffset || 0) + Number(accessor.byteOffset || 0);
        if (!Number.isSafeInteger(count) || count < 0 || byteOffset < binStart || byteOffset + (count - 1) * stride + 12 > model.length) {
            throw createVroidError(`VRoid POSITION accessor 越界: ${accessorIndex}`, 502);
        }
        const metaByte = createVroidPreviewByteGenerator(seed);
        for (let vertex = 0; vertex < count; vertex += 1) {
            const metaX = metaByte();
            const metaY = metaByte();
            const textureOffset = (metaY * VROID_PREVIEW_TEXTURE_SIZE + metaX) * 4;
            const factorX = 2 ** (VROID_PREVIEW_MULTIPLIER * texture[textureOffset] / 255);
            const factorY = 2 ** (VROID_PREVIEW_MULTIPLIER * texture[textureOffset + 1] / 255);
            const factorZ = 2 ** (VROID_PREVIEW_MULTIPLIER * texture[textureOffset + 2] / 255);
            const position = byteOffset + vertex * stride;
            model.writeFloatLE(model.readFloatLE(position) * factorX, position);
            model.writeFloatLE(model.readFloatLE(position + 4) * factorY, position + 4);
            model.writeFloatLE(model.readFloatLE(position + 8) * factorZ, position + 8);
        }
    }
    return model;
}

function readModelStream(stream, maxBytes = MAX_MODEL_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        stream.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                stream.destroy?.();
                reject(createVroidError(`VRM 下载超过 ${maxBytes} bytes 大小限制`, 413));
                return;
            }
            chunks.push(chunk);
        });
        stream.once('end', () => resolve(Buffer.concat(chunks)));
        stream.once('error', reject);
    });
}

function decodeStaticMmdModel(input, fileName = DEFAULT_STATIC_MMD_FILE) {
    const payload = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (!fileName.endsWith('.zst')) return payload;
    try {
        return zstdDecompressSync(payload, { maxOutputLength: MAX_DECOMPRESSED_MODEL_BYTES });
    } catch (error) {
        throw createVroidError(`MMD 压缩模型解包失败: ${error.message}`, 502);
    }
}

async function requestStaticMmdModelStream({
    fileName = DEFAULT_STATIC_MMD_FILE,
    baseUrl = DEFAULT_STATIC_MMD_BASE_URL,
    lookup = dns.lookup,
    request = requestFetch
} = {}) {
    const target = await resolveStaticMmdAssetUrl(fileName, { baseUrl, lookup });
    const response = await request(target, {
        timeoutMs: STATIC_MMD_TIMEOUT_MS,
        headers: {
            Accept: 'model/gltf-binary, application/octet-stream;q=0.9, */*;q=0.8',
            'User-Agent': 'AASC-MMD-Loader/1.0'
        }
    });
    const statusCode = Number(response.statusCode || 0);
    if (statusCode !== 200) {
        const preview = await readResponsePreview(response);
        throw createVroidError(`MMD 静态模型服务返回 HTTP ${statusCode}${preview ? `: ${preview}` : ''}`, 502);
    }
    const contentLength = Number(response.headers?.['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_MODEL_BYTES) {
        response.destroy?.();
        throw createVroidError(`MMD 文件超过 ${MAX_MODEL_BYTES} bytes 大小限制`, 413);
    }
    return { response: response.body || response, contentLength, sourceUrl: target.toString() };
}

async function requestFetch(target, options = {}) {
    const timeoutMs = options.timeoutMs || 30000;
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    const response = await fetch(target, {
        headers: options.headers || {},
        redirect: 'manual',
        ...(signal ? { signal } : {})
    });
    const body = response.body && typeof Readable.fromWeb === 'function'
        ? Readable.fromWeb(response.body)
        : null;
    return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        resume() {
            body?.resume();
        }
    };
}

function readResponsePreview(response) {
    return new Promise((resolve) => {
        const stream = response.body || response;
        if (!stream || typeof stream.on !== 'function') {
            resolve('');
            return;
        }
        const chunks = [];
        let total = 0;
        stream.on('data', (chunk) => {
            total += chunk.length;
            if (total <= 4096) chunks.push(chunk);
        });
        stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8').slice(0, 4096)));
        stream.once('error', () => resolve(''));
    });
}

async function requestVroidModelStream({ modelId, sourceUrl = DEFAULT_VROID_MODEL_URL, request = requestFetch } = {}) {
    if (!isNumericId(modelId)) {
        throw createVroidError('VRoid modelId 无效', 400);
    }
    const parsedSource = parseVroidModelUrl(sourceUrl);
    if (parsedSource.modelId !== modelId) {
        throw createVroidError('VRoid modelId 与来源地址不一致', 400);
    }

    let target = new URL(`https://${VROID_HOST}/api/character_models/${modelId}/optimized_preview`);
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const response = await request(target, {
            headers: {
                Accept: 'application/octet-stream, application/json;q=0.9, */*;q=0.8',
                'X-Api-Version': VROID_API_VERSION,
                Referer: parsedSource.sourceUrl,
                'User-Agent': 'AASC-VRM-Loader/1.0'
            }
        });
        const statusCode = Number(response.statusCode || 0);

        if (statusCode >= 300 && statusCode < 400 && response.headers?.location) {
            const nextTarget = new URL(response.headers.location, target);
            response.resume?.();
            if (!isAllowedRedirectTarget(nextTarget)) {
                throw createVroidError('VRoid 模型重定向目标不受信任', 502);
            }
            target = nextTarget;
            continue;
        }

        if (statusCode !== 200) {
            const preview = await readResponsePreview(response);
            throw createVroidError(`VRoid 模型服务返回 HTTP ${statusCode}${preview ? `: ${preview}` : ''}`, 502);
        }

        const contentLength = Number(response.headers?.['content-length']);
        if (Number.isFinite(contentLength) && contentLength > MAX_MODEL_BYTES) {
            response.destroy?.();
            throw createVroidError(`VRM 文件超过 ${MAX_MODEL_BYTES} bytes 大小限制`, 413);
        }
        return { response: response.body || response, contentLength, sourceUrl: target.toString() };
    }

    throw createVroidError('VRoid 模型重定向次数超限', 502);
}

module.exports = {
    DEFAULT_STATIC_MMD_BASE_URL,
    DEFAULT_STATIC_MMD_FILE,
    DEFAULT_VROID_MODEL_URL,
    MAX_MODEL_BYTES,
    MAX_DECOMPRESSED_MODEL_BYTES,
    VROID_API_VERSION,
    createVroidModelProfile,
    createStaticMmdModelProfile,
    decodeStaticMmdModel,
    isAllowedRedirectTarget,
    normalizeStaticMmdFileName,
    parseVroidModelUrl,
    readGlbChunks,
    readModelStream,
    requestStaticMmdModelStream,
    requestVroidModelStream,
    resolveStaticMmdAssetUrl,
    restoreVroidPreviewMesh,
    unwrapVroidModelPayload
};
