'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveXishiModelBytes } = require('../3rd/mmd-ar-test/web-characters-build');

const MANIFEST_URL = 'https://c.aasc.us/mnt/mmd-ar/mmd-resources.json';
function makeGlb() {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }), 'utf8');
    const paddedLength = Math.ceil(json.length / 4) * 4;
    const jsonChunk = Buffer.alloc(paddedLength, 0x20);
    json.copy(jsonChunk);
    const glb = Buffer.alloc(20 + jsonChunk.length);
    glb.write('glTF', 0, 'ascii');
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(jsonChunk.length, 12);
    glb.writeUInt32LE(0x4E4F534A, 16);
    jsonChunk.copy(glb, 20);
    return glb;
}
const hashOf = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function makeManifest(bytes, overrides = {}) {
    const version = overrides.version || hashOf(bytes);
    return {
        status: 'success',
        resources: [{ resourceId: 'xishi-default', modelType: 'glb', staticModel: true,
            modelUrl: overrides.modelUrl || `./mmd/xishi/xishi-${version.slice(0, 12)}.glb`, version,
            ...overrides.profile }]
    };
}
function createFetch(bytes, manifest) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const requestedUrl = String(url);
        calls.push({ url: requestedUrl, options });
        if (requestedUrl === MANIFEST_URL) return new Response(JSON.stringify(manifest), { status: 200 });
        if (manifest.resources[0].modelUrl.startsWith('./')) {
            const remoteUrl = new URL(manifest.resources[0].modelUrl, new URL('.', MANIFEST_URL)).href;
            if (requestedUrl === remoteUrl) return new Response(bytes, { status: 200 });
        } else if (requestedUrl === manifest.resources[0].modelUrl) {
            return new Response(bytes, { status: 200 });
        }
        return new Response('not found', { status: 404 });
    };
    return { fetchImpl, calls };
}
async function withTempDir(run) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mmd-ar-xishi-fallback-'));
    try { await run(directory); }
    finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('有效本地GLB优先使用且不请求公网', async () => {
    await withTempDir(async directory => {
        const sourceModel = path.join(directory, 'xishi.glb');
        const localBytes = makeGlb();
        await fs.writeFile(sourceModel, localBytes);
        const result = await resolveXishiModelBytes({ sourceModel, webMode: true,
            fetchImpl: async () => { throw new Error('本地模型有效时不得联网'); } });
        assert.equal(result.source, 'local');
        assert.equal(result.sha256, hashOf(localBytes));
        assert.deepEqual(result.bytes, localBytes);
    });
});

test('Web模式本地GLB缺失时按公网清单下载并校验完整SHA-256', async () => {
    await withTempDir(async directory => {
        const bytes = makeGlb();
        const { fetchImpl, calls } = createFetch(bytes, makeManifest(bytes));
        const result = await resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing.glb'), webMode: true, fetchImpl });
        assert.equal(result.source, 'remote');
        assert.equal(result.sha256, hashOf(bytes));
        assert.deepEqual(result.bytes, bytes);
        assert.equal(calls.length, 2);
        assert.ok(calls.every(call => call.options.redirect === 'error' && call.options.signal instanceof AbortSignal));
    });
});

test('无效本地GLB在Web模式回退，但APK模式不联网', async () => {
    await withTempDir(async directory => {
        const sourceModel = path.join(directory, 'invalid.glb');
        await fs.writeFile(sourceModel, 'not a glb');
        const bytes = makeGlb();
        const { fetchImpl, calls } = createFetch(bytes, makeManifest(bytes));
        const result = await resolveXishiModelBytes({ sourceModel, webMode: true, fetchImpl });
        assert.equal(result.source, 'remote');
        assert.equal(calls.length, 2);

        let apkFetches = 0;
        await assert.rejects(resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing.glb'), webMode: false,
            fetchImpl: async () => { apkFetches += 1; throw new Error('不得调用'); } }), /APK构建不启用公网回退/u);
        assert.equal(apkFetches, 0);
    });
});

test('拒绝公网清单指向非信任来源或路径的模型', async () => {
    await withTempDir(async directory => {
        const validBytes = makeGlb();
        const digest = hashOf(validBytes);
        const manifest = makeManifest(validBytes, { modelUrl: `https://example.invalid/mnt/mmd-ar/mmd/xishi/xishi-${digest.slice(0, 12)}.glb` });
        const { fetchImpl, calls } = createFetch(validBytes, manifest);
        await assert.rejects(resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing.glb'), webMode: true, fetchImpl }), /不属于允许的HTTPS版本化资源路径/u);
        assert.equal(calls.length, 1, '验证清单URL前不得请求模型地址');

        const invalidManifest = { ...makeManifest(validBytes), status: 'failure' };
        const invalidResponseFetch = async () => new Response(JSON.stringify(invalidManifest), { status: 200 });
        await assert.rejects(resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing-manifest.glb'), webMode: true,
            fetchImpl: invalidResponseFetch }), /公网西施资源清单结构无效/u);
    });
});

test('拒绝模型摘要不匹配、非GLB和超过上限的回退响应', async () => {
    await withTempDir(async directory => {
        const bytes = makeGlb();
        const digest = hashOf(bytes);
        const wrongDigest = `${digest.slice(0, 12)}${digest[12] === '0' ? '1' : '0'}${digest.slice(13)}`;
        const wrongManifest = makeManifest(bytes, { version: wrongDigest });
        const wrongHashFetch = createFetch(bytes, wrongManifest).fetchImpl;
        await assert.rejects(resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing-a.glb'), webMode: true, fetchImpl: wrongHashFetch }), /SHA-256不匹配/u);

        const invalidBytes = Buffer.from('not a glb');
        const invalidFetch = createFetch(invalidBytes, makeManifest(bytes));
        await assert.rejects(resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing-b.glb'), webMode: true, fetchImpl: invalidFetch.fetchImpl }), /不是有效的GLB/u);

        const tooLargeFetch = createFetch(bytes, makeManifest(bytes));
        await assert.rejects(resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing-c.glb'), webMode: true,
            fetchImpl: tooLargeFetch.fetchImpl, maxModelBytes: bytes.length - 1 }), /超过大小上限/u);
    });
});

test('公网清单网络/HTTP失败时安全中止且报告回退错误', async () => {
    await withTempDir(async directory => {
        const sourceModel = path.join(directory, 'missing.glb');
        await assert.rejects(resolveXishiModelBytes({ sourceModel, webMode: true,
            fetchImpl: async () => { throw new Error('network unavailable'); } }), /公网回退失败：西施资源清单请求失败/u);
        await assert.rejects(resolveXishiModelBytes({ sourceModel, webMode: true,
            fetchImpl: async () => new Response('failure', { status: 503 }) }), /HTTP状态异常：503/u);
    });
});

test('公网请求带超时信号，超时后安全中止', async () => {
    await withTempDir(async directory => {
        let timeoutSignal;
        const fetchImpl = async (_url, { signal }) => {
            timeoutSignal = signal;
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        };
        await assert.rejects(resolveXishiModelBytes({ sourceModel: path.join(directory, 'missing.glb'),
            webMode: true, fetchImpl, timeoutMs: 5 }), /西施资源清单请求失败/u);
        assert.equal(timeoutSignal.aborted, true);
    });
});
