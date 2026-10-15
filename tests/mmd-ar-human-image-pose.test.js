'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

test('图片预处理保持长宽比，检测NCHW归一化与黑边契约正确', async () => {
    const { prepareDetector, detectorAnchors } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const pixels = new Uint8ClampedArray(8 * 4 * 4).fill(255);
    const result = prepareDetector({ width: 8, height: 4, data: pixels });
    assert.equal(result.tensor.length, 3 * 224 * 224);
    assert.equal(result.tensor[0], 0, '检测黑边在归一化后填零');
    assert.equal(result.tensor[112 * 224 + 112], 1);
    assert.equal(result.padY, 56); assert.equal(result.padX, 0);
    const anchors = detectorAnchors();
    assert.equal(anchors.length, 2254);
    assert.deepEqual(anchors[0], [1 / 56, 1 / 56]);
    assert.deepEqual(anchors.at(-1), [13 / 14, 13 / 14]);
});

test('检测解码选最高可信人物，低分不生成假姿态，姿态ROI与世界点可逆旋转', async () => {
    const { decodePerson, preparePose, decodePose } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const scores = new Float32Array(2254).fill(-20), boxes = new Float32Array(2254 * 12);
    assert.equal(decodePerson(boxes, scores, { width: 224, height: 224, ratio: 1, padX: 0, padY: 0 }), null);
    scores[0] = 10;
    boxes[4] = 108; boxes[5] = 108; boxes[6] = 108; boxes[7] = 12;
    const person = decodePerson(boxes, scores, { width: 224, height: 224, ratio: 1, padX: 0, padY: 0 });
    assert.deepEqual(person.hip, [112, 112]); assert.deepEqual(person.full, [112, 16]);
    const image = { width: 224, height: 224, data: new Uint8ClampedArray(224 * 224 * 4).fill(255) };
    const roi = preparePose(image, person);
    assert.equal(roi.tensor.length, 256 * 256 * 3); assert.ok(Math.abs(roi.angle) < 1e-8);
    const landmarks = new Float32Array(195), world = new Float32Array(117);
    for (let i = 0; i < 39; i++) { landmarks.set([128, 128, 0, 10, 10], i * 5); world.set([0, -1, 0], i * 3); }
    const result = decodePose(landmarks, world, 0.99, roi, image);
    assert.equal(result.landmarks.length, 33);
    assert.equal(result.landmarks[0].x, 0.5); assert.equal(result.landmarks[0].y, 0.5);
    assert.deepEqual(result.landmarks[0].world, [0, -1, 0]);
    assert.throws(() => decodePose(landmarks, world, 0.1, roi, image), /未识别/u);
});

test('姿态输入拒绝退化ROI与损坏输出，避免NaN进入骨骼', async () => {
    const { preparePose, decodePose } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const image = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
    assert.throws(() => preparePose(image, { hip: [1, 1], full: [1, 1] }), /范围/u);
    assert.throws(() => decodePose(new Float32Array(2), new Float32Array(117), 1, {}, image), /输出/u);
});

test('真实PMX重定向按骨段长度构造目标，缺失手臂不生成零点且拒绝损坏世界点', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../3rd/mmd-ar-test/web-human-physics-rig.mjs');
    const { retargetImagePose } = await import('../3rd/mmd-ar-test/web-human-pose-retarget.mjs');
    const { model } = await makeModel(), rig = createHumanPhysicsRig(model);
    const landmarks = Array.from({ length: 33 }, () => ({ world: [0, -1.7, 0], visibility: 1, presence: 1 }));
    for (const [i, value] of [[11, [0.2, -1, 0]], [12, [-0.2, -1, 0]], [13, [0.5, -1, 0]], [14, [-0.5, -1, 0]],
        [15, [0.8, -1, 0]], [16, [-0.8, -1, 0]], [23, [0.1, 0, 0]], [24, [-0.1, 0, 0]],
        [25, [0.1, 0.4, 0]], [26, [-0.1, 0.4, 0]], [27, [0.1, 0.8, 0]], [28, [-0.1, 0.8, 0]]]) landmarks[i].world = value;
    const targets = retargetImagePose({ landmarks, confidence: 1 }, rig);
    const get = key => targets.find(target => target.key === key);
    assert.equal(targets.length, 11);
    const wrist = rig.targetToLocal(new (await import('three')).Vector3().fromArray(get('leftHand').position));
    const elbow = rig.targetToLocal(new (await import('three')).Vector3().fromArray(get('leftElbow').position));
    const a = rig.nodes.find(node => node.semantic === 'leftElbow'), b = rig.nodes.find(node => node.semantic === 'leftWrist');
    assert.ok(Math.abs(wrist.distanceTo(elbow) - a.position.distanceTo(b.position)) < 1e-8);
    assert.ok(wrist.x > elbow.x, '左右人体语义被镜像');
    model.mesh.scale.setScalar(2); model.mesh.rotation.y = 0.6; model.mesh.position.set(3, 2, -1); model.mesh.updateWorldMatrix(true, true);
    const transformed = retargetImagePose({ landmarks, confidence: 1 }, rig);
    const vector = (await import('three')).Vector3;
    const converted = key => rig.targetToLocal(new vector().fromArray(transformed.find(target => target.key === key).position));
    assert.ok(Math.abs(converted('leftHand').distanceTo(converted('leftElbow')) - a.position.distanceTo(b.position)) < 1e-8, '模型缩放/旋转后骨长变更');
    landmarks[13].visibility = 0;
    assert.ok(!retargetImagePose({ landmarks, confidence: 1 }, rig).some(target => ['leftHand', 'leftElbow'].includes(target.key)));
    landmarks[23].world[0] = NaN;
    assert.throws(() => retargetImagePose({ landmarks, confidence: 1 }, rig), /骨盆|关键点/u);
});

test('识别客户端取消旧请求并忽略晚到结果，关闭释放Worker且保留原图', async () => {
    const { createImagePoseClient } = await import('../3rd/mmd-ar-test/web-human-pose-client.mjs');
    const workers = [], client = createImagePoseClient({ workerFactory: () => {
        const worker = { postMessage(data) { this.message = data; }, terminate() { this.closed = true; } }; workers.push(worker); return worker;
    } });
    const image = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) };
    const first = client.infer(image).catch(error => error.name);
    const second = client.infer(image);
    assert.equal(await first, 'AbortError'); assert.equal(workers[0].closed, true);
    workers[1].onmessage({ data: { id: workers[0].message.id, type: 'result', result: '旧结果' } });
    workers[1].onmessage({ data: { id: workers[1].message.id, type: 'result', result: '新结果' } });
    assert.equal(await second, '新结果'); assert.equal(image.data.length, 4);
    client.dispose(); assert.equal(workers[1].closed, true);
    await assert.rejects(client.infer(image), /关闭/u);
});

test('Worker传输失败立即释放请求和线程，可重试且不遗留超时任务', async () => {
    const { createImagePoseClient } = await import('../3rd/mmd-ar-test/web-human-pose-client.mjs');
    let closed = 0;
    const client = createImagePoseClient({ workerFactory: () => ({ postMessage() { throw new Error('无法克隆'); }, terminate() { closed++; } }) });
    try {
        await assert.rejects(client.infer({ width: 1, height: 1, data: new Uint8ClampedArray(4) }), /无法克隆/u);
        assert.equal(closed, 1, '传输失败后没有释放Worker');
    } finally { client.dispose(); }
});

test('首次应用等待物理加载时取消或收起，迟到完成不得启用IK', async () => {
    const { ensureInteractivePhysics } = await import('../3rd/mmd-ar-test/web-human-ik-mode.mjs');
    let release, current = true, enabled = false;
    const api = { getState: () => ({ token: 'model-a' }),
        getInteractiveIKState: () => ({ mode: 'physics', enabled, available: enabled }),
        setInteractiveIKMode: () => new Promise(resolve => { release = resolve; }),
        setInteractiveIKEnabled(value) { enabled = value; } };
    const pending = ensureInteractivePhysics(api, { isCurrent: () => current });
    current = false; release();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(enabled, false, '取消后仍启用人体物理');
});
