const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
async function load(name) {
    const file = path.join(root, '3rd/mmd-ar-test/web-human-hmr2-web-' + name);
    assert.ok(await fs.stat(file).catch(() => null), 'HMR网页模块应已实现：' + name);
    return import(pathToFileURL(file).href);
}

test('缺模型和损坏模型均生成不可用清单，普通构建不下载且成功', async t => {
    const { stageHmrWebAssets } = await load('assets.js');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmr-web-assets-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const modelDir = path.join(dir, 'models'), output = path.join(dir, 'web');
    const missing = await stageHmrWebAssets(output, { modelDir });
    assert.equal(missing.available, false); assert.match(missing.reason, /模型/);
    await fs.mkdir(modelDir); await fs.writeFile(path.join(modelDir, 'model.onnx'), 'broken');
    const broken = await stageHmrWebAssets(output, { modelDir });
    assert.equal(broken.available, false);
    const saved = JSON.parse(await fs.readFile(path.join(output, 'js/vendor/hmr2/models.json')));
    assert.equal(saved.available, false);
    assert.deepEqual(await fs.readdir(modelDir), ['model.onnx']);
});

test('网页RGBA预处理与Node同像素PNG四输入一致，包含Gaussian和小数人物框', async () => {
    const { prepareHmrWebInput } = await load('core.mjs');
    const { createPreprocessor, loadOpenCv } = await import('../3rd/hmr2-node-onnx/core/preprocess.mjs');
    const sharp = require(require.resolve('sharp', { paths: [path.join(root, '3rd/hmr2-node-onnx')] }));
    const { cv } = await loadOpenCv(), prepare = await createPreprocessor();
    for (const [width, height, bbox] of [[64, 96], [641, 751], [320, 240, [13.2, 21.3, 280.8, 220.9]]]) {
        const data = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 17 + (i >>> 9)) % 256);
        const bytes = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
        const expected = await prepare(bytes, bbox), actual = await prepareHmrWebInput({ width, height, data }, bbox, cv);
        for (const key of Object.keys(expected.inputs)) assert.deepEqual(actual.inputs[key], expected.inputs[key], key + '不一致');
        assert.deepEqual(actual.metadata.boxXYXY, expected.metadata.boxXYXY);
    }
});

test('网页预处理拒绝非法图片与框，输出拒绝无效数值/深度/形状', async () => {
    const core = await load('core.mjs');
    assert.throws(() => core.validateHmrImage({ width: 1, height: 1, data: new Uint8Array(3) }));
    assert.throws(() => core.validateHmrImage({ width: 99999, height: 2, data: [] }));
    assert.throws(() => core.validateHmrBox([0, 0, 0, 1], 2, 2));
    assert.throws(() => core.validateHmrBox([0, 0, 3, 1], 2, 2));
    const outputs = Object.fromEntries(Object.entries(core.HMR_OUTPUT_SHAPES).map(([name, dims]) =>
        [name, { type: 'float32', dims, data: new Float32Array(dims.reduce((a, b) => a * b, 1)) }]));
    const metadata = { imageSize: [2, 2], boxXYXY: [0, 0, 2, 2], bboxSource: 'full_image_fallback' };
    assert.throws(() => core.decodeHmrWebOutputs(outputs, metadata), /深度/);
    outputs.cameraDepth.data.fill(1); outputs.cameraTranslation.data[2] = 1;
    outputs.focalLengthPx.data[0] = 5000; outputs.principalPointPx.data.fill(1);
    const raw = core.decodeHmrWebOutputs(outputs, metadata);
    assert.equal(raw.source, 'hmr2-web'); assert.equal(raw.xyz.length, 25);
    outputs.xyz.data[2] = NaN; assert.throws(() => core.decodeHmrWebOutputs(outputs, metadata), /xyz/);
});

test('网页HMR来源复用BODY25语义及预览，拒绝伪造其它来源', async () => {
    const semantic = await import('../3rd/mmd-ar-test/web-human-pose-semantic.mjs');
    const raw = { imageSize: [100, 100], xy: Array.from({ length: 25 }, () => [50, 50]),
        xyz: Array.from({ length: 25 }, () => [0, 0, 1]), cameraDepth: Array(25).fill(1), edges: semantic.HMR2_BODY25_EDGES };
    const pose = semantic.createHmr2SemanticPose(raw, 'hmr2-web');
    assert.equal(pose.source, 'hmr2-web'); assert.equal(semantic.isHmrPose(pose), true);
    assert.equal(semantic.getPoseQuality(pose).visible, 12); assert.equal(semantic.getPoseReference(pose).points.length, 25);
    assert.throws(() => semantic.createHmr2SemanticPose(raw, 'mediapipe-pose'));
    const { needsImagePoseFit } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    assert.equal(needsImagePoseFit(pose), true, '网页HMR必须进入与API相同的FK拟合入口');
});
