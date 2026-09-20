'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const { zstdCompressSync } = require('node:zlib');
const {
    DEFAULT_STATIC_MMD_BASE_URL,
    DEFAULT_STATIC_MMD_FILE,
    DEFAULT_VROID_MODEL_URL,
    VROID_API_VERSION,
    createStaticMmdModelProfile,
    createVroidModelProfile,
    decodeStaticMmdModel,
    parseVroidModelUrl,
    requestStaticMmdModelStream,
    requestVroidModelStream,
    restoreVroidPreviewMesh,
    resolveStaticMmdAssetUrl,
    unwrapVroidModelPayload
} = require('./vroid-model-service');

function createPreviewGlb(position = [1, 1, 1]) {
    const json = {
        asset: { version: '2.0' },
        extensions: { PIXIV_vroid_hub_preview_mesh: { version: '5.0', timestamp: '26232110' } },
        buffers: [{ byteLength: 12 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }]
    };
    const jsonData = Buffer.from(JSON.stringify(json), 'utf8');
    const jsonLength = Math.ceil(jsonData.length / 4) * 4;
    const output = Buffer.alloc(12 + 8 + jsonLength + 8 + 12, 0);
    output.write('glTF', 0, 'ascii');
    output.writeUInt32LE(2, 4);
    output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(jsonLength, 12);
    output.writeUInt32LE(0x4e4f534a, 16);
    jsonData.copy(output, 20);
    output.fill(0x20, 20 + jsonData.length, 20 + jsonLength);
    const binHeader = 20 + jsonLength;
    output.writeUInt32LE(12, binHeader);
    output.writeUInt32LE(0x004e4942, binHeader + 4);
    position.forEach((value, index) => output.writeFloatLE(value, binHeader + 8 + index * 4));
    return output;
}

test('VRoid 模型页面地址解析出角色和模型 ID', () => {
    assert.deepEqual(parseVroidModelUrl(DEFAULT_VROID_MODEL_URL), {
        sourceUrl: DEFAULT_VROID_MODEL_URL,
        characterId: '1786977751194326803',
        modelId: '3931412591784052736'
    });
});

test('静态 MMD profile 使用安全文件名和同源代理地址', () => {
    const profile = createStaticMmdModelProfile(DEFAULT_STATIC_MMD_FILE, {
        version: '20260920',
        sha256: 'a'.repeat(64)
    });
    assert.equal(profile.fileName, DEFAULT_STATIC_MMD_FILE);
    assert.equal(profile.version, '20260920');
    assert.equal(profile.sha256, 'a'.repeat(64));
    assert.equal(profile.modelUrl, '/api/vrm/model/static?file=default-vroid.vrm.zst');
    assert.throws(() => createStaticMmdModelProfile('../secret.vrm'), /文件名无效/u);
});

test('静态 MMD 地址解析域名为 IPv4 且不保留域名主机', async () => {
    const resolved = await resolveStaticMmdAssetUrl('default-vroid.vrm', {
        baseUrl: DEFAULT_STATIC_MMD_BASE_URL,
        lookup: async () => [{ address: '120.79.245.103', family: 4 }]
    });
    assert.equal(resolved.toString(), 'http://120.79.245.103/mnt/mmd/default-vroid.vrm');
});

test('静态 MMD 代理请求使用解析后的 IP', async () => {
    const requests = [];
    const response = Object.assign(new PassThrough(), {
        statusCode: 200,
        headers: { 'content-length': '4', 'content-type': 'model/vrml' }
    });
    const resultPromise = requestStaticMmdModelStream({
        fileName: 'default-vroid.vrm',
        lookup: async () => [{ address: '120.79.245.103', family: 4 }],
        request: async (target, options) => {
            requests.push({ target: target.toString(), options });
            return response;
        }
    });
    const result = await resultPromise;
    assert.equal(result.sourceUrl, 'http://120.79.245.103/mnt/mmd/default-vroid.vrm');
    assert.equal(requests[0].options.headers.Host, undefined);
    result.response.end();
});

test('静态 MMD zstd 文件解包后仍为 GLB', () => {
    const model = createPreviewGlb();
    const compressed = zstdCompressSync(model);
    assert.deepEqual(decodeStaticMmdModel(compressed, 'default-vroid.vrm.zst'), model);
    assert.deepEqual(decodeStaticMmdModel(model, 'default-vroid.vrm'), model);
});

test('VRoid profile 返回同源代理地址，不信任任意外部模型地址', () => {
    const profile = createVroidModelProfile();
    assert.equal(profile.modelId, '3931412591784052736');
    assert.equal(profile.characterId, '1786977751194326803');
    assert.match(profile.modelUrl, /^\/api\/vrm\/model\/file\?/u);
    assert.equal(profile.modelUrl.includes('hub.vroid.com'), false);
});

test('VRoid 代理请求带 API 版本并只跟随到模型资源', async () => {
    const requests = [];
    const responses = [
        { statusCode: 302, headers: { location: 'https://dzn1p4kfcvio2.cloudfront.net/model.vrm' }, resume() {} },
        Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: { 'content-length': '4', 'content-type': 'application/octet-stream' }
        })
    ];
    const resultPromise = requestVroidModelStream({
        modelId: '3931412591784052736',
        sourceUrl: DEFAULT_VROID_MODEL_URL,
        request: async (target, options) => {
            requests.push({ target: target.toString(), options });
            return responses.shift();
        }
    });
    const result = await resultPromise;
    assert.equal(result.contentLength, 4);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.headers['X-Api-Version'], VROID_API_VERSION);
    assert.match(requests[1].target, /cloudfront\.net\/model\.vrm/u);
    result.response.end();
});

test('VRoid 页面地址和模型 ID 不一致时拒绝代理', async () => {
    await assert.rejects(
        requestVroidModelStream({ modelId: '123456789', sourceUrl: DEFAULT_VROID_MODEL_URL, request: async () => ({}) }),
        /modelId 与来源地址不一致/u
    );
});

test('VRoid 加密优化载荷可以解包为 GLB', () => {
    const model = Buffer.concat([Buffer.from('glTF'), Buffer.from('test-model')]);
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const compressed = zstdCompressSync(model);
    const decoded = Buffer.allocUnsafe(4 + compressed.length);
    decoded.writeUInt32LE(model.length, 0);
    compressed.copy(decoded, 4);
    const encrypted = Buffer.concat([cipher.update(decoded), cipher.final()]);
    const payload = Buffer.concat([iv, key, encrypted]);
    assert.deepEqual(unwrapVroidModelPayload(payload), model);
});

test('VRoid optimized_preview 顶点可以按资源路径恢复', () => {
    const input = createPreviewGlb();
    const output = restoreVroidPreviewMesh(
        input,
        'https://dzn1p4kfcvio2.cloudfront.net/c/v2/s=op/model_optimized_files/3401566/5827420710691626633.vrm'
    );
    const jsonLength = output.readUInt32LE(12);
    const binOffset = 20 + jsonLength + 8;
    const restored = [0, 1, 2].map(index => output.readFloatLE(binOffset + index * 4));
    assert.equal(output.length, input.length);
    assert.notDeepEqual(restored, [1, 1, 1]);
    assert.ok(restored.every(Number.isFinite));
});
