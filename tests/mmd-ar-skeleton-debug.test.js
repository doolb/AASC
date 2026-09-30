'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { addSkeletonRuntime, addSkeletonDisplay } = require('../3rd/mmd-ar-test/web-skeleton-debug');
const { WEB_PANEL_GROUP_JS } = require('../3rd/mmd-ar-test/web-panel-groups');

async function fixture() {
    const THREE = await import('three');
    const { createSkeletonOverlay, classifySkeletonBones, SKELETON_COLORS } = await import('../3rd/mmd-ar-test/web-skeleton-debug.mjs');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 10, 1], 3));
    geometry.userData.MMD = { rigidBodies: [
        { boneIndex: 0, type: 0 }, { boneIndex: 1, type: 2 }, { boneIndex: 2, type: 1 }
    ] };
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    const bones = Array.from({ length: 4 }, (_, index) => {
        const bone = new THREE.Bone();
        bone.name = `骨骼${index}`;
        bone.position.set(index, index + 1, 0);
        mesh.add(bone);
        return bone;
    });
    mesh.bind(new THREE.Skeleton(bones));
    const parent = new THREE.Group();
    parent.add(mesh);
    const renderer = { autoClear: true, calls: [], render(scene, camera) { this.calls.push({ scene, camera }); } };
    const camera = new THREE.PerspectiveCamera();
    const overlay = createSkeletonOverlay({ THREE, renderer, camera });
    overlay.setModel(mesh);
    return { THREE, mesh, bones, parent, renderer, overlay, classifySkeletonBones, SKELETON_COLORS };
}

test('分类使用最终刚体参数，红0/黄2/绿1与灰色、非法输入及多类型优先正确', async () => {
    const { mesh, bones, classifySkeletonBones, SKELETON_COLORS } = await fixture();
    assert.deepEqual(classifySkeletonBones(mesh), [0, 2, 1, 'none']);
    assert.deepEqual(SKELETON_COLORS, { 0: 0xff3333, 2: 0xffd633, 1: 0x33e066, none: 0x9ca3af });
    mesh.geometry.userData.MMD.rigidBodies.push(null, { boneIndex: -1, type: 1 },
        { boneIndex: 99, type: 1 }, { boneIndex: 3, type: 9 },
        { boneIndex: 3, type: '1' }, { boneIndex: 0, type: 2 }, { boneIndex: 0, type: 1 });
    assert.deepEqual(classifySkeletonBones(mesh), [1, 2, 1, 'none']);
    // 模拟加载器 type2 -> type1 转换；骨骼残留的原始类型不能覆盖最终参数。
    bones[2].userData.rigidBodyType = 2;
    assert.equal(classifySkeletonBones(mesh)[2], 1);
    mesh.geometry.userData.MMD.rigidBodies = null;
    assert.deepEqual(classifySkeletonBones(mesh), ['none', 'none', 'none', 'none']);
    assert.deepEqual(classifySkeletonBones(null), []);
});

test('默认关闭与角色隐藏时不创建/更新资源，开启后四类只需四个实例组', async () => {
    const { overlay, renderer, mesh } = await fixture();
    assert.equal(overlay.render(), false);
    assert.equal(overlay.getState().resourceGroups, 0);
    overlay.setVisible(true);
    assert.equal(overlay.render(false), false);
    mesh.visible = false;
    assert.equal(overlay.render(), false);
    mesh.visible = true;
    assert.equal(overlay.render(), true);
    const state = overlay.getState();
    assert.equal(state.resourceGroups, 4);
    assert.equal(state.drawCount, 1);
    assert.deepEqual(state.counts, { 0: 1, 2: 1, 1: 1, none: 1 });
    assert.equal(renderer.autoClear, true);
    assert.equal(mesh.children.filter(value => value.isInstancedMesh).length, 0);
    const scene = renderer.calls[0].scene;
    assert.equal(scene.children.length, 4);
    assert.equal(new Set(scene.children.map(value => value.geometry)).size, 1);
    for (const marker of scene.children) {
        assert.equal(marker.material.depthTest, false);
        assert.equal(marker.material.depthWrite, false);
        assert.equal(marker.castShadow, false);
        assert.equal(marker.receiveShadow, false);
    }
    overlay.setVisible(false);
    const calls = renderer.calls.length;
    mesh.updateWorldMatrix = () => { throw new Error('关闭状态不得逐帧访问骨骼'); };
    assert.equal(overlay.render(), false);
    assert.equal(renderer.calls.length, calls);
});

test('动作/物理骨骼变化与父级平移旋转缩放后，小球世界坐标和半径正确', async () => {
    const { THREE, overlay, parent, bones, renderer } = await fixture();
    parent.position.set(10, 20, 30);
    parent.rotation.z = Math.PI / 2;
    parent.scale.setScalar(2);
    bones[1].position.set(4, 5, 6);
    const localPosition = bones[1].position.clone();
    overlay.setVisible(true);
    overlay.render();
    for (const sample of overlay.getState().samples) {
        assert.ok(new THREE.Vector3(...sample.position).distanceTo(new THREE.Vector3(...sample.bonePosition)) < 1e-5);
    }
    assert.deepEqual(bones[1].position, localPosition);
    const group = renderer.calls[0].scene.children.find(value => value.name.endsWith('-2'));
    const matrix = new THREE.Matrix4();
    group.getMatrixAt(0, matrix);
    const radius = new THREE.Vector3().setFromMatrixScale(matrix);
    assert.ok(Math.abs(radius.x - 0.07) < 1e-6);
    const before = overlay.getState().samples.find(value => value.type === 2).position;
    bones[1].position.x += 3;
    overlay.render();
    assert.notDeepEqual(overlay.getState().samples.find(value => value.type === 2).position, before);
});

test('叠加绘制异常时恢复原autoClear，不接管原渲染场景', async () => {
    const { overlay, renderer } = await fixture();
    renderer.autoClear = false;
    renderer.render = () => { throw new Error('绘制失败'); };
    overlay.setVisible(true);
    assert.throws(() => overlay.render(), /绘制失败/u);
    assert.equal(renderer.autoClear, false);
    renderer.autoClear = true;
    assert.throws(() => overlay.render(), /绘制失败/u);
    assert.equal(renderer.autoClear, true);
});

test('换模型释放实例/材质/几何，重复销毁幂等，空模型与后续模型保持开关', async () => {
    const { overlay, mesh, renderer } = await fixture();
    overlay.setVisible(true);
    overlay.render();
    const oldScene = renderer.calls[0].scene;
    const oldGroups = [...oldScene.children];
    const counts = { mesh: 0, material: 0, geometry: 0 };
    oldGroups[0].geometry.addEventListener('dispose', () => { counts.geometry += 1; });
    for (const group of oldGroups) {
        group.addEventListener('dispose', () => { counts.mesh += 1; });
        group.material.addEventListener('dispose', () => { counts.material += 1; });
    }
    overlay.setModel(null);
    assert.deepEqual(counts, { mesh: 4, material: 4, geometry: 1 });
    assert.equal(oldScene.children.length, 0);
    assert.equal(overlay.getState().boneCount, 0);
    assert.equal(overlay.render(), false);
    overlay.setModel(mesh);
    overlay.render();
    assert.equal(overlay.getState().enabled, true);
    assert.equal(overlay.getState().resourceGroups, 4);
    overlay.dispose();
    overlay.dispose();
    assert.equal(overlay.getState().releasedGroups, 8);
    assert.equal(overlay.getState().boneCount, 0);
    overlay.setModel(mesh);
    assert.equal(overlay.render(), false);
    assert.equal(overlay.getState().resourceGroups, 0);
});

test('无骨骼模型不分配球体，缺少刚体数据的骨骼显示灰球', async () => {
    const { overlay, mesh } = await fixture();
    overlay.setVisible(true);
    const skeleton = mesh.skeleton;
    mesh.skeleton = null;
    overlay.setModel(mesh);
    assert.equal(overlay.render(), false);
    assert.equal(overlay.getState().resourceGroups, 0);
    mesh.skeleton = skeleton;
    delete mesh.geometry.userData.MMD;
    overlay.setModel(mesh);
    overlay.render();
    assert.deepEqual(overlay.getState().counts, { 0: 0, 2: 0, 1: 0, none: 4 });
    assert.equal(overlay.getState().resourceGroups, 1);
});

test('面板开关恢复偏好与转发，存储不可用或非法值仍默认关闭并可操作', () => {
    const source = WEB_PANEL_GROUP_JS.match(/\(\(\) => \{[\s\S]*?\}\)\(\);/u)[0];
    for (const stored of ['true', 'false', null, 'invalid', 'throws']) {
        const values = [];
        const events = new Map();
        const toggle = { checked: false, addEventListener: (event, callback) => events.set(event, callback) };
        const storage = {
            getItem() { if (stored === 'throws') throw new Error('禁用存储'); return stored; },
            setItem(key, value) { if (stored === 'throws') throw new Error('禁用存储'); this.saved = [key, value]; }
        };
        vm.runInNewContext(source, { document: { getElementById: () => toggle }, localStorage: storage,
            window: { DisplayMmd: { setSkeletonVisible: value => values.push(value) } } });
        assert.equal(toggle.checked, stored === 'true');
        toggle.checked = !toggle.checked;
        events.get('change')();
        assert.deepEqual(values, [stored === 'true', stored !== 'true']);
        if (stored !== 'throws') assert.deepEqual(storage.saved, ['aasc.mmdArTest.skeletonVisible.v1', String(toggle.checked)]);
    }
});

test('构建适配保留角色首帧门控，接入提交/释放/转发；锚点缺失或重复即失败', () => {
    const publicJs = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');
    const runtime = fs.readFileSync(path.join(publicJs, 'display-pmx-runtime.js'), 'utf8');
    const display = fs.readFileSync(path.join(publicJs, 'display-mmd.js'), 'utf8');
    const patched = addSkeletonRuntime(runtime, './skeleton.mjs');
    assert.match(patched, /skeletonOverlay.render\(currentRotationPivot\?\.visible === true\)/u);
    assert.ok(patched.indexOf('skeletonOverlay.render(') < patched.indexOf('if (firstFramePivot) firstFramePivot.visible = firstFramePivotVisible'));
    assert.match(patched, /currentRotationPivot = stagedPivot;\s+skeletonOverlay.setModel\(currentMesh\)/u);
    assert.match(patched, /skeletonOverlay.dispose\(\);\s+renderer.dispose\(\)/u);
    new vm.Script(addSkeletonDisplay(display));
    for (const transform of [addSkeletonRuntime, addSkeletonDisplay]) {
        assert.throws(() => transform('', './skeleton.mjs'), /唯一锚点/u);
    }
    assert.throws(() => addSkeletonRuntime(runtime + runtime, './skeleton.mjs'), /唯一锚点/u);
    assert.throws(() => addSkeletonDisplay(display + display), /唯一锚点/u);
});
