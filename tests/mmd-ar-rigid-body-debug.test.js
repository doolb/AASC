'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const test = require('node:test');
const { addRigidBodyRuntime, addRigidBodyDisplay } = require('../3rd/mmd-ar-test/web-rigid-body-debug');
const { addSkeletonRuntime, addSkeletonDisplay } = require('../3rd/mmd-ar-test/web-skeleton-debug');
const { WEB_PANEL_GROUP_JS } = require('../3rd/mmd-ar-test/web-panel-groups');

async function fixture() {
    const THREE = await import('three');
    const { createRigidBodyOverlay, describeRigidBodyShape } = await import('../3rd/mmd-ar-test/web-rigid-body-debug.mjs');
    const bone = new THREE.Bone();
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    const base = { width: 0.2, height: 0.4, depth: 0.6, position: [0, 0, 0], rotation: [0, 0, 0],
        weight: 1, friction: 0, restitution: 0, positionDamping: 0, rotationDamping: 0,
        groupIndex: 0, groupTarget: 65535 };
    mesh.geometry.userData.MMD = { rigidBodies: [
        { ...base, type: 0, shapeType: 0, boneIndex: 0 },
        { ...base, type: 2, shapeType: 1, boneIndex: 0, position: [1, 0, 0] },
        { ...base, type: 1, shapeType: 2, boneIndex: -1, position: [0, 2, 0], width: 0.3, height: 0.9 }
    ] };
    const parent = new THREE.Group();
    parent.add(mesh);
    const renderer = { autoClear: true, calls: [], render(scene) { this.calls.push(scene); } };
    const overlay = createRigidBodyOverlay({ THREE, renderer, camera: new THREE.PerspectiveCamera() });
    overlay.setModel(mesh);
    return { THREE, mesh, bone, parent, renderer, overlay, describeRigidBodyShape };
}

function closeArray(actual, expected, tolerance = 1e-5) {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < tolerance, `${index}: ${value} != ${expected[index]}`));
}

test('球/盒/胶囊尺寸、圆柱长径比及非法形状尺寸规范化', async () => {
    const { describeRigidBodyShape: shape } = await fixture();
    assert.deepEqual(shape({ type: 0, shapeType: 0, width: 2 }), { key: 'sphere', scale: [2, 2, 2] });
    assert.deepEqual(shape({ type: 2, shapeType: 1, width: 2, height: 3, depth: 4 }), { key: 'box', scale: [4, 6, 8] });
    assert.deepEqual(shape({ type: 1, shapeType: 2, width: 2, height: 6 }), { key: 'capsule:3', ratio: 3, scale: [2, 2, 2] });
    for (const params of [null, { type: 9, shapeType: 0, width: 1 }, { type: 0, shapeType: 9, width: 1 },
        { type: 0, shapeType: 0, width: 0 }, { type: 0, shapeType: 0, width: Infinity },
        { type: 1, shapeType: 1, width: 1, height: -1, depth: 1 },
        { type: 1, shapeType: 2, width: 1, height: -1 }]) assert.equal(shape(params), null);
});

test('默认关闭/首帧隐藏不分配资源，三色线框独立场景与实际几何尺寸正确', async () => {
    const { overlay, renderer, mesh, THREE } = await fixture();
    assert.equal(overlay.render(), false);
    assert.equal(overlay.getState().resourceGroups, 0);
    overlay.setVisible(true);
    assert.equal(overlay.render(false), false);
    overlay.render();
    const scene = renderer.calls[0];
    assert.equal(scene.children.length, 3);
    assert.equal(mesh.children.some(value => value.isInstancedMesh), false);
    const colors = { 0: 0xff3333, 2: 0xffd633, 1: 0x33e066 };
    for (const sample of overlay.getState().samples) assert.equal(sample.color, colors[sample.type]);
    for (const group of scene.children) {
        assert.equal(group.material.wireframe, true);
        assert.equal(group.material.depthTest, false);
        assert.equal(group.material.depthWrite, false);
        assert.equal(group.castShadow, false);
        const matrix = new THREE.Matrix4();
        group.getMatrixAt(0, matrix);
        const size = new THREE.Box3().setFromBufferAttribute(group.geometry.getAttribute('position'))
            .applyMatrix4(matrix).getSize(new THREE.Vector3()).toArray();
        if (group.name.includes('sphere')) closeArray(size, [0.4, 0.4, 0.4]);
        if (group.name.includes('box')) closeArray(size, [0.4, 0.8, 1.2]);
        if (group.name.includes('capsule')) closeArray(size, [0.6, 1.5, 0.6]);
    }
    overlay.setVisible(false);
    const count = overlay.getState().updateCount;
    mesh.updateWorldMatrix = () => { throw new Error('关闭时不得读取逐体姿态'); };
    assert.equal(overlay.render(), false);
    assert.equal(overlay.getState().updateCount, count);
});

test('无物理配置预览包含骨骼局部偏移/旋转与无骨骼刚体，世界缩放正确', async () => {
    const { THREE, overlay, parent, bone, mesh } = await fixture();
    parent.position.set(10, 20, 30);
    parent.rotation.y = 0.7;
    parent.scale.set(2, 3, 4);
    bone.position.set(4, 5, 6);
    bone.rotation.z = 0.5;
    overlay.setVisible(true);
    overlay.render();
    const state = overlay.getState();
    assert.equal(state.poseMode, 'preview');
    assert.equal(state.actualCount, 0);
    for (const sample of state.samples) {
        const params = mesh.geometry.userData.MMD.rigidBodies[sample.bodyIndex];
        const offset = new THREE.Matrix4().compose(new THREE.Vector3(...params.position), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        const expected = new THREE.Matrix4().copy(params.boneIndex === -1 ? mesh.matrixWorld : bone.matrixWorld)
            .multiply(offset).scale(new THREE.Vector3(...(sample.type === 2 ? [0.4, 0.8, 1.2] : Array(3).fill(params.width))));
        closeArray(sample.matrix, expected.toArray());
    }
});

test('共享相同比例胶囊及跨颜色几何，换模型/重复销毁释放缓存与实例', async () => {
    const { overlay, mesh, renderer } = await fixture();
    const bodies = mesh.geometry.userData.MMD.rigidBodies;
    bodies.push({ ...bodies[2], width: 0.6, height: 1.8 }, { ...bodies[2], type: 0 });
    overlay.setModel(mesh);
    overlay.setVisible(true);
    overlay.render();
    assert.equal(overlay.getState().bodyCount, 5);
    assert.equal(overlay.getState().resourceGroups, 4);
    assert.equal(overlay.getState().geometries, 3);
    const groups = [...renderer.calls[0].children];
    const disposed = { mesh: 0, material: 0, geometry: 0 };
    for (const group of groups) group.addEventListener('dispose', () => { disposed.mesh += 1; });
    for (const material of new Set(groups.map(group => group.material))) material.addEventListener('dispose', () => { disposed.material += 1; });
    for (const geometry of new Set(groups.map(group => group.geometry))) geometry.addEventListener('dispose', () => { disposed.geometry += 1; });
    overlay.setModel(null);
    overlay.dispose();
    overlay.dispose();
    assert.deepEqual(disposed, { mesh: 4, material: 3, geometry: 3 });
    assert.equal(overlay.getState().resourceGroups, 0);
    assert.equal(overlay.getState().bodyCount, 0);
});

let nativePromise;
async function nativeFixture() {
    if (!nativePromise) nativePromise = (async () => {
        const vendor = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three');
        const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
        const { addPhysicsLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
        const { addPhysicsSubsteps } = require('../3rd/mmd-ar-test/web-physics-substeps');
        const { addPhysicsStability } = require('../3rd/mmd-ar-test/web-physics-stability');
        const source = addPhysicsStability(addPhysicsSubsteps(addPhysicsLifecycle(fs.readFileSync(path.join(vendor, 'animation/MMDPhysics.js'), 'utf8'))))
            .replace("from 'three'", `from '${threeUrl}'`);
        globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({ wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
        return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).MMDPhysics;
    })();
    return nativePromise;
}

test('真实Ammo姿态优先骨骼，读取位置/旋转不改速度，1000帧池与4MiB探针稳定复用', async () => {
    const { THREE, overlay, mesh, bone } = await fixture();
    const MMDPhysics = await nativeFixture();
    const physics = new MMDPhysics(mesh, mesh.geometry.userData.MMD.rigidBodies);
    const body = physics.bodies[0].body;
    const form = physics.manager.allocTransform();
    const quat = physics.manager.allocQuaternion();
    try {
        form.setIdentity();
        form.getOrigin().setValue(7, 8, 9);
        const expectedQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
        quat.setValue(...expectedQuaternion.toArray());
        form.setRotation(quat);
        body.setCenterOfMassTransform(form);
        bone.position.set(-20, -30, -40);
        const velocity = body.getLinearVelocity();
        const before = [velocity.x(), velocity.y(), velocity.z()];
        overlay.setVisible(true);
        overlay.render(true, physics);
        const sample = overlay.getState().samples.find(value => value.bodyIndex === 0);
        const expected = new THREE.Matrix4().compose(new THREE.Vector3(7, 8, 9), expectedQuaternion, new THREE.Vector3(0.2, 0.2, 0.2));
        closeArray(sample.matrix, expected.toArray());
        assert.equal(overlay.getState().poseMode, 'physics');
        const objects = physics.manager.nativeObjects.size;
        const probes = [];
        for (let index = 0; index < 1000; index += 1) {
            overlay.render(true, physics);
            assert.equal(physics.manager.nativeObjects.size, objects);
            if (index % 100 === 0) {
                const pointer = Ammo._malloc(4 * 1024 * 1024);
                assert.ok(pointer > 0);
                probes.push(pointer);
                Ammo._free(pointer);
            }
        }
        assert.equal(new Set(probes).size, 1);
        assert.equal(Ammo.HEAP8.byteLength, 64 * 1024 * 1024);
        closeArray([velocity.x(), velocity.y(), velocity.z()], before);
    } finally {
        physics.manager.freeTransform(form);
        physics.manager.freeQuaternion(quat);
        overlay.dispose();
        physics.dispose();
        assert.equal(physics.manager.nativeObjects.size, 0);
    }
});

test('真实物理在非单位缩放下按模型本地单位坐标模拟，线框转换到父级显示坐标', async () => {
    const { THREE, overlay, mesh, parent, bone } = await fixture();
    const MMDPhysics = await nativeFixture();
    mesh.position.set(3, 4, 5);
    mesh.rotation.z = 0.2;
    parent.position.set(10, 20, 30);
    parent.rotation.y = 0.7;
    parent.scale.setScalar(2);
    bone.position.set(1, 2, 3);
    const physics = new MMDPhysics(mesh, mesh.geometry.userData.MMD.rigidBodies);
    try {
        mesh.updateWorldMatrix(true, true);
        physics.update(1 / 65);
        overlay.setVisible(true);
        overlay.render(true, physics);
        const sample = overlay.getState().samples.find(value => value.bodyIndex === 0);
        // type0随骨骼，绑定偏移为0；球中心应与最终显示骨骼完全一致。
        const center = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(sample.matrix));
        assert.ok(center.distanceTo(bone.getWorldPosition(new THREE.Vector3())) < 1e-5);
        const radius = new THREE.Vector3().setFromMatrixScale(new THREE.Matrix4().fromArray(sample.matrix));
        closeArray(radius.toArray(), [0.4, 0.4, 0.4]);
    } finally { overlay.dispose(); physics.dispose(); }
});

test('旧physics替换后读取新实例，无物理切回预览，异常绘制归还池对象并恢复renderer', async () => {
    const { overlay, mesh, renderer } = await fixture();
    const MMDPhysics = await nativeFixture();
    const old = new MMDPhysics(mesh, mesh.geometry.userData.MMD.rigidBodies);
    overlay.setVisible(true);
    overlay.render(true, old);
    old.dispose();
    const next = new MMDPhysics(mesh, mesh.geometry.userData.MMD.rigidBodies);
    try {
        overlay.render(true, next);
        assert.equal(overlay.getState().actualCount, 3);
        overlay.render(true, null);
        assert.equal(overlay.getState().poseMode, 'preview');
        const count = next.manager.quaternions.length;
        renderer.render = () => { throw new Error('绘制异常'); };
        assert.throws(() => overlay.render(true, next), /绘制异常/u);
        assert.equal(renderer.autoClear, true);
        assert.equal(next.manager.quaternions.length, count);
    } finally { overlay.dispose(); next.dispose(); }
});

test('无效配置跳过，面板独立偏好与未模拟说明，存储受限仍可操作', async () => {
    const { overlay, mesh } = await fixture();
    mesh.geometry.userData.MMD.rigidBodies.push(null, { type: 0, shapeType: 0, width: 1 });
    overlay.setModel(mesh);
    assert.equal(overlay.getState().bodyCount, 3);
    const source = WEB_PANEL_GROUP_JS.match(/\(\(\) => \{\s+const toggle = document.getElementById\('mmdArRigidBodyEnabled'\);[\s\S]*?\}\)\(\);/u)[0];
    for (const stored of ['true', 'invalid', 'throws']) {
        let change;
        const values = [];
        const toggle = { checked: false, addEventListener: (_, callback) => { change = callback; } };
        const status = {};
        const localStorage = { getItem() { if (stored === 'throws') throw Error('存储禁用'); return stored; }, setItem() { if (stored === 'throws') throw Error('存储禁用'); } };
        vm.runInNewContext(source, { document: { getElementById: id => ({ mmdArRigidBodyEnabled: toggle, mmdArRigidBodyStatus: status }[id]) }, localStorage,
            window: { addEventListener() {}, DisplayMmd: { setRigidBodyVisible: value => values.push(value),
                getRigidBodyState: () => ({ bodyCount: 3, poseMode: 'preview' }) } } });
        assert.equal(toggle.checked, stored === 'true');
        toggle.checked = true;
        change();
        assert.match(status.textContent, /未模拟/u);
        assert.deepEqual(values, [stored === 'true', true]);
    }
});

test('骨骼后接入碰撞体适配，保持首帧门控和线框先于球体，失效锚点停止构建', () => {
    const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');
    const runtime = fs.readFileSync(path.join(root, 'display-pmx-runtime.js'), 'utf8');
    const output = addRigidBodyRuntime(addSkeletonRuntime(runtime, './bone.mjs'), './body.mjs');
    assert.ok(output.indexOf('rigidBodyOverlay.render(') < output.indexOf('skeletonOverlay.render('));
    assert.match(output, /physicsEnabled \? helper.current\?\.objects\?\.get\(currentMesh\)\?\.physics : null/u);
    assert.ok(output.indexOf('rigidBodyOverlay.render(') < output.indexOf('if (firstFramePivot) firstFramePivot.visible = firstFramePivotVisible'));
    new vm.Script(addRigidBodyDisplay(addSkeletonDisplay(fs.readFileSync(path.join(root, 'display-mmd.js'), 'utf8'))));
    assert.throws(() => addRigidBodyRuntime(runtime, './body.mjs'), /唯一锚点/u);
    assert.throws(() => addRigidBodyDisplay(''), /唯一锚点/u);
});
