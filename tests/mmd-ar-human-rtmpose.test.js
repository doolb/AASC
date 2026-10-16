'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const sampleImage = () => ({ width: 288, height: 384, data: new Uint8ClampedArray(288 * 384 * 4).fill(255) });
const coco = [[144, 45], [150, 40], [138, 40], [160, 46], [128, 46],
    [184, 100], [104, 100], [220, 165], [68, 165], [230, 220], [58, 220],
    [170, 215], [118, 215], [178, 285], [110, 285], [180, 360], [108, 360]];
function output(points = coco, score = .8) {
    const x = { dims: [1, 17, 576], data: new Float32Array(17 * 576) };
    const y = { dims: [1, 17, 768], data: new Float32Array(17 * 768) };
    points.forEach(([a, b], i) => { x.data[i * 576 + a * 2] = score; y.data[i * 768 + b * 2] = score; });
    return [x, y];
}

test('RTMPose使用实际384×288 RGB NCHW、标准1.25取景和黑边归一化', async () => {
    const { prepareRTMPose } = await import('../3rd/mmd-ar-test/web-human-pose-rtmpose.mjs');
    const image = sampleImage();
    for (let i = 0; i < image.data.length; i += 4) image.data.set([255, 128, 0, 255], i);
    const roi = prepareRTMPose(image), center = 192 * 288 + 144;
    assert.equal(roi.tensor.length, 3 * 288 * 384);
    assert.equal(roi.width, 360); assert.equal(roi.height, 480);
    assert.ok(Math.abs(roi.tensor[center] - (255 - 123.675) / 58.395) < 1e-6);
    assert.ok(Math.abs(roi.tensor[288 * 384 + center] - (128 - 116.28) / 57.12) < 1e-6);
    assert.ok(Math.abs(roi.tensor[2 * 288 * 384 + center] - (0 - 103.53) / 57.375) < 1e-6);
    assert.ok(Math.abs(roi.tensor[0] + 123.675 / 58.395) < 1e-6);
    assert.throws(() => prepareRTMPose({ ...image, data: new Uint8ClampedArray(4) }), /像素|尺寸/u);
});

test('RTMPose SimCC正逆仿射、17点左右语义和二维契约：不填不存在的world/手指', async () => {
    const { prepareRTMPose, decodeRTMPose } = await import('../3rd/mmd-ar-test/web-human-pose-rtmpose.mjs');
    const { landmarkQuality, poseLandmarkThreshold } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const image = sampleImage(), roi = prepareRTMPose(image), pose = decodeRTMPose(...output(), roi, image);
    assert.equal(pose.source, 'rtmpose-m'); assert.equal(pose.dimensions, 2);
    assert.equal(pose.landmarks.filter(Boolean).length, 17); assert.equal(pose.landmarks[17], null);
    assert.equal(pose.landmarks[11].world, undefined); assert.equal(pose.landmarks[11].dimensions, 2);
    assert.ok(Math.abs(pose.landmarks[11].x - (144 + (184 - 144) * 1.25) / 288) < 1e-8);
    assert.ok(pose.landmarks[15].x > pose.landmarks[16].x);
    assert.ok(landmarkQuality(pose.landmarks[11]) > .79); assert.equal(poseLandmarkThreshold(pose), .3);
    assert.equal(landmarkQuality({ x: .5, y: .5, visibility: 1, presence: 1 }), 0, '旧契约缺world不能冒充二维');
    assert.equal(pose.quality.torsoReady, true);
});

test('RTMPose拒绝错误维度/NaN/低分/退化点，不能把空结果当人物', async () => {
    const { prepareRTMPose, decodeRTMPose } = await import('../3rd/mmd-ar-test/web-human-pose-rtmpose.mjs');
    const image = sampleImage(), roi = prepareRTMPose(image), [x, y] = output();
    assert.throws(() => decodeRTMPose({ ...x, dims: [1, 17, 768] }, y, roi, image), /输出|维度/u);
    x.data[0] = NaN;
    assert.throws(() => decodeRTMPose(x, y, roi, image), /输出/u);
    assert.throws(() => decodeRTMPose(...output(coco, .1), roi, image), /未识别/u);
    assert.throws(() => decodeRTMPose(...output(coco.map(() => [144, 192])), roi, image), /未识别|退化/u);
});

test('RTMPose资源只分发选定m384模型，大小SHA与已实测官方权重一致', () => {
    const { MODELS } = require('../3rd/mmd-ar-test/web-human-pose-assets');
    assert.equal(MODELS.length, 1);
    assert.equal(MODELS[0].name, 'rtmpose-m-body7-384x288.onnx');
    assert.equal(MODELS[0].size, 54850856);
    assert.equal(MODELS[0].sha256, 'a4c4f6fd983c0be353042a7a6b3845b0894ada22b8c02964373554afcdcd6e8e');
});

test('二维姿态按相机投影初始化真实PMX：固定骨长、左右语义、缺点不补、模型变换稳定', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { fitImagePose2D } = await import('../3rd/mmd-ar-test/web-human-pose-lift.mjs');
    const T = await import('three');
    const { model } = await makeModel(), rig = createHumanPhysicsRig(model);
    const camera = new T.PerspectiveCamera(40, 1, .01, 1000);
    const exercise = (bent = false) => {
        model.mesh.updateWorldMatrix(true, true);
        const anchor = rig.targetToWorld(rig.pelvis.position), scale = rig.targetToWorld(rig.pelvis.position.clone().add(new T.Vector3(0, 1, 0))).distanceTo(anchor);
        camera.position.copy(anchor).add(new T.Vector3(scale * .3, scale * .2, scale * 4)); camera.lookAt(anchor); camera.updateMatrixWorld(true);
        const q = camera.getWorldQuaternion(new T.Quaternion()).invert(), landmarks = Array(33).fill(null);
        const map = { leftArm: 11, rightArm: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
            leftLeg: 23, rightLeg: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28 };
        const positions = new Map(rig.nodes.map(n => [n.semantic, n.position.clone()]));
        if (bent) for (const [side, sign] of [['left', 1], ['right', -1]]) {
            const hip = positions.get(side + 'Leg'), knee = positions.get(side + 'Knee'), ankle = positions.get(side + 'Ankle');
            const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle);
            knee.copy(hip).addScaledVector(new T.Vector3(sign * .4, -.3, .8).normalize(), upper);
            ankle.copy(knee).addScaledVector(new T.Vector3(sign * -.1, -.9, -.3).normalize(), lower);
        }
        for (const node of rig.nodes) if (map[node.semantic] !== undefined) {
            const p = rig.targetToWorld(positions.get(node.semantic)).sub(anchor).applyQuaternion(q).multiplyScalar(.3 / scale);
            landmarks[map[node.semantic]] = { x: .5 + p.x, y: .4 - p.y, visibility: 1, presence: 1, source: 'rtmpose-m', dimensions: 2 };
        }
        const pose = { source: 'rtmpose-m', dimensions: 2, landmarks, imageAspect: 1 };
        const fit = fitImagePose2D(pose, rig, camera);
        assert.ok(fit.error < .015, '已知弱透视投影未还原：' + fit.error);
        const point = key => rig.targetToLocal(new T.Vector3().fromArray(fit.targets.find(t => t.key === key).position));
        for (const side of ['left', 'right']) {
            const a = rig.nodes.find(n => n.semantic === side + 'Elbow'), b = rig.nodes.find(n => n.semantic === side + 'Wrist');
            assert.ok(Math.abs(point(side + 'Elbow').distanceTo(point(side + 'Hand')) - a.position.distanceTo(b.position)) < 1e-8);
            const knee = rig.nodes.find(n => n.semantic === side + 'Knee'), ankle = rig.nodes.find(n => n.semantic === side + 'Ankle');
            assert.ok(Math.abs(point(side + 'Knee').distanceTo(point(side + 'Foot')) - knee.position.distanceTo(ankle.position)) < 1e-8);
        }
        landmarks[13] = null;
        assert.ok(!fitImagePose2D(pose, rig, camera).targets.some(t => ['leftElbow', 'leftHand'].includes(t.key)));
        landmarks[23] = null;
        assert.throws(() => fitImagePose2D(pose, rig, camera), /肩|髋|骨盆|躯干/u);
        return fit;
    };
    const first = exercise();
    exercise(true);
    model.mesh.scale.setScalar(2); model.mesh.rotation.y = .7; model.mesh.position.set(3, 2, -1);
    const next = exercise(); assert.ok(next.targets.every(t => t.position.every(Number.isFinite)));
    assert.equal(next.targets.length, first.targets.length);
});
