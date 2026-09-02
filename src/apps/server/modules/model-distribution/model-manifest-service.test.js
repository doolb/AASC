'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ModelManifestService } = require('./model-manifest-service');

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-models-'));
    fs.mkdirSync(path.join(root, 'rapidocr'), { recursive: true });
    fs.mkdirSync(path.join(root, 'yolo11'), { recursive: true });
    fs.mkdirSync(path.join(root, 'speech-enhancement'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rapidocr', 'PP-OCRv6_det_small.onnx'), 'det-model');
    fs.writeFileSync(path.join(root, 'rapidocr', 'ch_ppocr_mobile_v2.0_cls_mobile.onnx'), 'cls-model');
    fs.writeFileSync(path.join(root, 'rapidocr', 'PP-OCRv6_rec_small.onnx'), 'rec-model');
    fs.writeFileSync(path.join(root, 'rapidocr', 'ppocrv6_dict.txt'), '字典');
    fs.writeFileSync(path.join(root, 'yolo11', 'yolo11n.onnx'), 'yolo-n');
    fs.writeFileSync(path.join(root, 'yolo11', 'yolo11n.classes.json'), '{"model":"yolo11n","names":["person"]}');
    fs.writeFileSync(path.join(root, 'speech-enhancement', 'gtcrn_simple.onnx'), 'denoise');
    return root;
}

test('model manifest includes existing files with size and sha256', () => {
    const root = createFixture();
    try {
        const service = new ModelManifestService({ modelRoot: root });
        const manifest = service.createManifest('vision');
        const rapidOcr = manifest.models.find((model) => model.id === 'rapidocr');
        const yolo = manifest.models.find((model) => model.id === 'yolo11n');

        assert.ok(rapidOcr);
        assert.deepEqual(rapidOcr.files.map((file) => file.name), [
            'PP-OCRv6_det_small.onnx',
            'ch_ppocr_mobile_v2.0_cls_mobile.onnx',
            'PP-OCRv6_rec_small.onnx',
            'ppocrv6_dict.txt'
        ]);
        assert.equal(rapidOcr.files[0].size, Buffer.byteLength('det-model'));
        assert.match(rapidOcr.files[0].sha256, /^[a-f0-9]{64}$/);
        assert.ok(yolo);
        assert.deepEqual(yolo.files.map((file) => file.name), [
            'yolo11n.onnx',
            'yolo11n.classes.json'
        ]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('model manifest omits an unavailable YOLO size and rejects traversal', () => {
    const root = createFixture();
    try {
        const service = new ModelManifestService({ modelRoot: root });
        const manifest = service.createManifest('vision');
        assert.equal(manifest.models.some((model) => model.id === 'yolo11x'), false);
        assert.throws(
            () => service.resolveFile('vision', 'rapidocr', '../outside'),
            /非法模型文件/
        );
        assert.throws(
            () => service.resolveFile('vision', '../outside', 'det.onnx'),
            /非法模型 ID/
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('incomplete model is not downloadable even when one file exists', () => {
    const root = createFixture();
    try {
        fs.unlinkSync(path.join(root, 'rapidocr', 'PP-OCRv6_rec_small.onnx'));
        const service = new ModelManifestService({ modelRoot: root });

        assert.equal(service.createManifest('vision').models.some((model) => model.id === 'rapidocr'), false);
        assert.throws(
            () => service.resolveFile('vision', 'rapidocr', 'PP-OCRv6_det_small.onnx'),
            (error) => error.code === 'MODEL_NOT_FOUND'
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('speech enhancement manifest uses a stable model id', () => {
    const root = createFixture();
    try {
        const service = new ModelManifestService({ modelRoot: root });
        const manifest = service.createManifest('speech-enhancement');
        assert.deepEqual(manifest.models.map((model) => model.id), ['gtcrn']);
        assert.equal(manifest.models[0].files[0].name, 'gtcrn_simple.onnx');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('model manifest rejects model files that resolve outside modelRoot through a symlink', () => {
    const root = createFixture();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-model-outside-'));
    try {
        const detPath = path.join(root, 'rapidocr', 'PP-OCRv6_det_small.onnx');
        const outsidePath = path.join(outsideRoot, 'outside.onnx');
        fs.unlinkSync(detPath);
        fs.writeFileSync(outsidePath, 'outside-model');
        fs.symlinkSync(outsidePath, detPath);

        const service = new ModelManifestService({ modelRoot: root });
        assert.equal(service.createManifest('vision').models.some((model) => model.id === 'rapidocr'), false);
        assert.throws(
            () => service.resolveFile('vision', 'rapidocr', 'PP-OCRv6_det_small.onnx'),
            (error) => error.code === 'MODEL_NOT_FOUND'
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
});
