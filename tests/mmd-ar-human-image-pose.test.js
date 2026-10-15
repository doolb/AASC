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

test('检测低分不生成假姿态，姿态ROI与世界点可逆旋转', async () => {
    const { decodePeople, preparePose, decodePose } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const scores = new Float32Array(2254).fill(-20), boxes = new Float32Array(2254 * 12);
    assert.deepEqual(decodePeople(boxes, scores, { width: 224, height: 224, ratio: 1, padX: 0, padY: 0 }), []);
    scores[0] = 10;
    boxes[2] = 40; boxes[3] = 40;
    boxes[4] = 108; boxes[5] = 108; boxes[6] = 108; boxes[7] = 12;
    const [person] = decodePeople(boxes, scores, { width: 224, height: 224, ratio: 1, padX: 0, padY: 0 });
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

test('多候选去重保留低于0.5的独立人物，限制三次姿态推理并跳过退化检测', async () => {
    const { decodePeople, detectorAnchors } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const scores = new Float32Array(2254).fill(-20), boxes = new Float32Array(2254 * 12), anchors = detectorAnchors();
    const set = (i, score, x, y) => {
        scores[i] = Math.log(score / (1 - score));
        boxes.set([x - anchors[i][0] * 224, y - anchors[i][1] * 224, 30, 30,
            x - anchors[i][0] * 224, y + 30 - anchors[i][1] * 224,
            x - anchors[i][0] * 224, y - 40 - anchors[i][1] * 224, 0, 0, 0, 0], i * 12);
    };
    set(0, 0.622, 45, 170); set(1, 0.589, 46, 171); set(2, 0.479, 110, 60);
    set(3, 0.40, 160, 80); set(4, 0.36, 200, 170); set(5, 0.34, 30, 40);
    set(6, 0.99, 80, 80); boxes[6 * 12 + 4] = NaN;
    set(7, 0.98, 80, 80); boxes[7 * 12 + 2] = 0;
    const people = decodePeople(boxes, scores, { width: 224, height: 224, ratio: 1, padX: 0, padY: 0 });
    assert.equal(people.length, 3);
    assert.deepEqual(people.map(person => person.hip[0]), [45, 110, 160]);
    assert.ok(people[1].score < 0.5 && people[1].score > 0.47, '女孩候选再次被0.5阈值排除');
    assert.deepEqual(people[1].box, [95, 45, 125, 75]);
});

test('身体完整性选择女孩而非高分小猪，Pose总分接近1不能支配排序', async () => {
    const { rankPoseCandidates } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const body = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    const pose = (values, score, confidence) => {
        const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, world: [0, 0, 0], visibility: 1, presence: 1 }));
        body.forEach((index, i) => { landmarks[index].visibility = values[i]; });
        return { landmarks, confidence, detection: { score } };
    };
    const pig = pose([.999, .990, .604, .013, .545, .037, .999, .999, .960, .506, .941, .697], .622, .99999);
    const girl = pose([.999, .999, .920, .526, .872, .743, .999, .999, .985, .657, .923, .450], .479, .994);
    const ranked = rankPoseCandidates([pig, girl]);
    assert.equal(ranked[0].detection.score, .479);
    assert.equal(ranked[0].quality.visible, 11);
    assert.deepEqual(ranked[0].quality.lowConfidence, [28]);
    assert.equal(ranked[0].quality.torsoReady, true);
    assert.ok(ranked[0].quality.score > ranked[1].quality.score);
});

test('出画面和无效世界点不算身体质量，躯干缺失不能应用', async () => {
    const { rankPoseCandidates } = await import('../3rd/mmd-ar-test/web-human-pose-core.mjs');
    const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, world: [0, 0, 0], visibility: 1, presence: 1 }));
    landmarks[11].x = -0.1; landmarks[23].world[0] = NaN;
    const [result] = rankPoseCandidates([{ landmarks, confidence: 1, detection: { score: .9 } }]);
    assert.equal(result.quality.visible, 10);
    assert.equal(result.quality.torsoReady, false);
    assert.deepEqual(result.quality.lowConfidence, [11, 23]);
    assert.ok(Number.isFinite(result.quality.score));
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
    landmarks[13].visibility = 1; landmarks[13].x = -0.1; landmarks[13].y = 0.5;
    assert.ok(!retargetImagePose({ landmarks, confidence: 1 }, rig).some(target => ['leftHand', 'leftElbow'].includes(target.key)), '预览中出画面的点仍用于应用');
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
