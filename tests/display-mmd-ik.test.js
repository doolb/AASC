'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const readSource = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('镜头平移按视距、视场角和画布高度换算到当前相机平面', async () => {
    const { calculateCameraPanOffset } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-ar-camera-runtime.mjs');
    const input = {
        deltaX: 40,
        deltaY: 20,
        distance: 5,
        fovRadians: Math.PI / 4,
        viewportHeight: 100,
        right: [1, 0, 0],
        up: [0, 1, 0]
    };
    const offset = calculateCameraPanOffset(input);
    const unitsPerPixel = 2 * input.distance * Math.tan(input.fovRadians / 2) / input.viewportHeight;
    assert.ok(Math.abs(offset.x + 40 * unitsPerPixel) < 1e-12);
    assert.ok(Math.abs(offset.y - 20 * unitsPerPixel) < 1e-12);
    assert.equal(offset.z, 0);

    const halfViewportOffset = calculateCameraPanOffset({ ...input, viewportHeight: 200 });
    assert.ok(Math.abs(halfViewportOffset.x - offset.x / 2) < 1e-12);
    assert.equal(calculateCameraPanOffset({ ...input, viewportHeight: 0 }), null);
    assert.equal(calculateCameraPanOffset({ ...input, right: [1, 0] }), null);
});

test('IK控制点先截断指针，空白拖动按开始时的IK状态选择相机或模型', () => {
    const display = readSource('src/apps/web-mediacenter/ui/public/js/display-mmd.js');
    const ik = readSource('src/apps/web-mediacenter/ui/public/js/mmd-human-ik.mjs');
    assert.match(ik, /event\.stopImmediatePropagation\(\);\s*event\.preventDefault\(\)/u);
    assert.match(display, /function isInteractiveIKEnabled\(\)\s*\{\s*return state\.runtime\?\.getHumanInterface\?\.\(\)\?\.getInteractiveIKState\?\.\(\)\.enabled === true;/u);
    assert.match(display, /cameraControl: isInteractiveIKEnabled\(\)/u);
    assert.match(display, /const cameraControl = state\.rotationDrag\?\.cameraControl \?\? isInteractiveIKEnabled\(\)/u);
    assert.match(display, /if \(drag\.cameraControl\)\s*\{\s*rotateCameraViewByPixels\(deltaX, deltaY\);\s*\}\s*else\s*\{\s*state\.runtime\?\.rotateModelBy/u);
    assert.match(display, /rotateCameraViewBy\?\.\(\s*-deltaX \* ROTATION_RADIANS_PER_PIXEL/u);
    assert.match(display, /if \(gesture\.cameraControl\) state\.runtime\?\.panCameraByPixels\?\.\(deltaX, deltaY\);\s*else state\.runtime\?\.translateModelByPixels/u);
    assert.match(display, /if \(translation\.cameraControl\) state\.runtime\?\.panCameraByPixels\?\.\(deltaX, deltaY\);\s*else state\.runtime\?\.translateModelByPixels/u);
    assert.match(display, /!drag\.cameraControl && typeof state\.runtime\?\.finishModelRotation/u);
});

test('膝关节有独立修正预算且 PMX IK 角度范围仍是最终限制', async () => {
    const THREE = await import('three');
    const { clampIKBoneRotation, getJointCorrectionLimit } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-ik.mjs');
    const ik = readSource('src/apps/web-mediacenter/ui/public/js/mmd-human-ik.mjs');
    const kneeIndices = new Set([4, 8]);
    const baseline = new THREE.Quaternion();
    const proposed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 170 * Math.PI / 180);
    const kneeLimit = getJointCorrectionLimit(4, kneeIndices);
    const bodyLimit = getJointCorrectionLimit(2, kneeIndices);
    const kneeRotation = clampIKBoneRotation(proposed, baseline, kneeLimit, null);
    const bodyRotation = clampIKBoneRotation(proposed, baseline, bodyLimit, null);
    const pmxLimitedKnee = clampIKBoneRotation(proposed, baseline, kneeLimit, {
        rotationMin: [0, 0, -0.5], rotationMax: [0, 0, 0.5]
    });

    assert.ok(Math.abs(baseline.angleTo(kneeRotation) - 150 * Math.PI / 180) < 1e-10);
    assert.ok(Math.abs(baseline.angleTo(bodyRotation) - 45 * Math.PI / 180) < 1e-10);
    assert.ok(Math.abs(baseline.angleTo(pmxLimitedKnee) - 0.5) < 1e-10);
    assert.match(ik, /\{ key: 'leftKnee',[^\n]+\}/u);
    assert.match(ik, /\{ key: 'rightKnee',[^\n]+\}/u);
    assert.match(ik, /const MAX_LINKS = 12/u);
    assert.match(ik, /PBD_MAX_ITERATIONS/u);
    assert.match(ik, /calculatePbdAngularCorrections/u);
    assert.match(ik, /for \(const handle of active\) changed = solvePbdConstraint\(handle, handle\.target\) \|\| changed/u);
});

test('膝点与脚踝可同时拖动，脚目标可驱动超过旧限幅的膝屈曲', async () => {
    const THREE = await import('three');
    const { createHumanIK } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-ik.mjs');
    const previousWindow = globalThis.window;
    const windowListeners = new Map();
    globalThis.window = {
        addEventListener(type, handler) {
            const listeners = windowListeners.get(type) || new Set();
            listeners.add(handler);
            windowListeners.set(type, listeners);
        },
        removeEventListener(type, handler) { windowListeners.get(type)?.delete(handler); }
    };
    const canvasListeners = new Map();
    const capturedPointers = new Set();
    const canvas = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 600 }),
        addEventListener(type, handler) {
            const listeners = canvasListeners.get(type) || new Set();
            listeners.add(handler);
            canvasListeners.set(type, listeners);
        },
        removeEventListener(type, handler) { canvasListeners.get(type)?.delete(handler); },
        setPointerCapture: pointerId => capturedPointers.add(pointerId),
        hasPointerCapture: pointerId => capturedPointers.has(pointerId),
        releasePointerCapture: pointerId => capturedPointers.delete(pointerId),
        emit(type, event) {
            for (const handler of canvasListeners.get(type) || []) handler({
                currentTarget: canvas, stopImmediatePropagation() {}, preventDefault() {}, ...event
            });
        }
    };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 50);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const root = new THREE.Bone(); root.name = 'Root';
    const thigh = new THREE.Bone(); thigh.name = 'LeftUpLeg'; thigh.position.y = 1;
    const knee = new THREE.Bone(); knee.name = 'LeftLeg'; knee.position.y = -1;
    const ankle = new THREE.Bone(); ankle.name = 'LeftFoot'; ankle.position.y = -1;
    root.add(thigh); thigh.add(knee); knee.add(ankle);
    const mesh = new THREE.Group();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.userData.MMD = { iks: [] };
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    mesh.skeleton = { bones: [root, thigh, knee, ankle] };
    mesh.add(root); scene.add(mesh);
    const bindings = Object.fromEntries(mesh.skeleton.bones.map((bone, index) => [
        'bones:' + (index === 0 ? 'root' : index === 2 ? 'leftKnee' : index === 3 ? 'leftAnkle' : 'leftLeg'),
        { bone, index, name: bone.name, dynamic: false }
    ]));
    const model = {
        mesh, bindings, bones: mesh.skeleton.bones.map((bone, index) => ({ bone, index, dynamic: false })),
        groups: { root: new Set([0]) }
    };
    const controller = createHumanIK({ getScene: () => scene, getCamera: () => camera, canvas });

    function dragTarget(key, destination, pointerId) {
        scene.updateMatrixWorld(true);
        const marker = scene.children.flatMap(child => child.children || [])
            .find(child => child.userData.humanIKTarget === key);
        assert.ok(marker, `缺少 ${key} 控制点`);
        const screenPoint = world => {
            const projected = world.clone().project(camera);
            return { clientX: (projected.x + 1) * 300, clientY: (1 - projected.y) * 300 };
        };
        const start = screenPoint(marker.getWorldPosition(new THREE.Vector3()));
        const end = screenPoint(destination);
        const base = { pointerId, button: 0, isPrimary: true };
        canvas.emit('pointerdown', { ...base, ...start });
        canvas.emit('pointermove', { ...base, ...end });
        canvas.emit('pointerup', { ...base, ...end });
    }

    try {
        const enabled = controller.setEnabled(true, model);
        assert.equal(enabled.targets, 2);
        dragTarget('leftKnee', new THREE.Vector3(0.2, 0.05, 0), 1);
        dragTarget('leftFoot', new THREE.Vector3(1.45, -0.7, 0), 2);
        assert.equal(controller.getState().activeTargets, 2);
        const kneeBaseline = knee.quaternion.clone(), thighBaseline = thigh.quaternion.clone();
        const segmentLengths = [[thigh, knee], [knee, ankle]].map(([parent, child]) => {
            parent.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
            return parent.getWorldPosition(new THREE.Vector3()).distanceTo(child.getWorldPosition(new THREE.Vector3()));
        });
        const footTarget = new THREE.Vector3(1.45, -0.7, 0);
        const footErrorBefore = ankle.getWorldPosition(new THREE.Vector3()).distanceTo(footTarget);
        controller.apply(model);
        assert.ok(kneeBaseline.angleTo(knee.quaternion) > 45 * Math.PI / 180,
            `膝骨修正未超过旧45°上限：${(kneeBaseline.angleTo(knee.quaternion) * 180 / Math.PI).toFixed(2)}°`);
        assert.ok(thighBaseline.angleTo(thigh.quaternion) > 1e-4, '全身约束没有把目标误差分配到膝以上骨骼');
        mesh.updateMatrixWorld(true);
        const segmentLengthsAfter = [[thigh, knee], [knee, ankle]].map(([parent, child]) =>
            parent.getWorldPosition(new THREE.Vector3()).distanceTo(child.getWorldPosition(new THREE.Vector3())));
        segmentLengthsAfter.forEach((length, index) => assert.ok(Math.abs(length - segmentLengths[index]) < 1e-8,
            `骨段${index}长度发生变化：${length} vs ${segmentLengths[index]}`));
        assert.ok(ankle.getWorldPosition(new THREE.Vector3()).distanceTo(footTarget) < footErrorBefore,
            'PBD迭代没有缩小脚踝位置误差');
        assert.ok(Number.isFinite(controller.getState().unreachable));
        controller.resetTargets();
        assert.ok(thighBaseline.angleTo(thigh.quaternion) < 1e-8, '重置后没有还原全身共同修正');
    } finally {
        controller.dispose();
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('自由镜头操作不覆盖正在运行的AR定位相机', () => {
    const runtime = readSource('src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js');
    const camera = readSource('src/apps/web-mediacenter/ui/public/js/mmd-ar-camera-runtime.mjs');
    assert.match(runtime, /if \(arCameraState\.active \|\| !Number\.isFinite\(yaw\) \|\| !Number\.isFinite\(pitch\)\) return null/u);
    assert.match(runtime, /wrappedYaw = \(\(cameraViewState\.targetYaw \+ yaw \+ Math\.PI\)/u);
    assert.match(camera, /if \(arCameraState\.active\) return false;\s*camera\.updateMatrixWorld\(true\)/u);
});


test('取消异步Ammo初始化不会启用迟到模式或遗留场景资源', async () => {
    const { createHumanIK } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-ik.mjs');
    const previous = globalThis.window; globalThis.window = { addEventListener() {}, removeEventListener() {} };
    let finish;
    const ik = createHumanIK({ loadAmmo: () => new Promise(resolve => { finish = resolve; }) });
    try {
        const loading = ik.setMode('physics'); ik.reset(); finish({}); await loading;
        assert.equal(ik.getState().enabled, false); assert.equal(ik.getState().mode, 'pbd');
        assert.equal(ik.getState().targets, 0); assert.equal(ik.getState().physics, null);
    } finally { ik.dispose(); globalThis.window = previous; }
});

test('正式人体物理在真实PMX骨架上求解并完整释放Ammo分配', async () => {
    const { makeModel } = require('./helpers/mmd-human-real-pmx');
    const { createHumanPhysicsRig } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-physics-rig.mjs');
    const { createHumanPhysicsDrive } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-physics-drive.mjs');
    const Ammo = await require('../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.js')({
        wasmBinary: fs.readFileSync(path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/vendor/three/libs/ammo.wasm.wasm')) });
    const { T, model } = await makeModel(false), rig = createHumanPhysicsRig(model), drive = createHumanPhysicsDrive(Ammo, rig);
    const original = model.bones.map(item => item.bone.position.clone());
    const node = rig.nodes.find(item => item.semantic === 'leftWrist');
    const target = { node, target: model.bindings['bones:leftWrist'].bone.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 1, 1)), positionState: 'On', rotationState: 'Off' };
    try {
        assert.ok(drive.getState().allocations > 0);
        for (let frame = 0; frame < 120; frame++) {
            rig.restore(); const poses = drive.step(1 / 60, rig.animatedPoses(), frame < 60 ? [target] : [], { gravity: false });
            for (const pose of poses.values()) assert.ok([...pose.position.toArray(), ...pose.quaternion.toArray()].every(Number.isFinite));
        }
        drive.reset(); rig.restore();
        model.bones.forEach((item, index) => assert.ok(item.bone.position.distanceTo(original[index]) < 1e-8));
    } finally { drive.dispose(); }
    assert.equal(drive.getState().allocations, 0); assert.equal(drive.getState().disposed, true);
});
