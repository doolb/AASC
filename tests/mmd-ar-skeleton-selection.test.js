'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const test = require('node:test');
const { WEB_PANEL_GROUP_JS } = require('../3rd/mmd-ar-test/web-panel-groups');
const { addPhysicsLifecycle } = require('../3rd/mmd-ar-test/web-physics-lifecycle');
const { addPhysicsSubsteps } = require('../3rd/mmd-ar-test/web-physics-substeps');
const { addSkeletonDisplay } = require('../3rd/mmd-ar-test/web-skeleton-debug');

async function fixture() {
    const THREE = await import('three');
    const { createSkeletonSelection, normalizeSkeletonSize } = await import('../3rd/mmd-ar-test/web-skeleton-selection.mjs');
    const { createSkeletonOverlay } = await import('../3rd/mmd-ar-test/web-skeleton-debug.mjs');
    const { createRigidBodyOverlay } = await import('../3rd/mmd-ar-test/web-rigid-body-debug.mjs');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 5;
    camera.updateMatrixWorld(true);
    const calls = [];
    const context = Object.fromEntries(['setTransform', 'clearRect', 'beginPath', 'arc', 'stroke', 'strokeText', 'fillText']
        .map(name => [name, (...args) => calls.push([name, ...args])]));
    const canvases = [];
    const dom = { clientWidth: 400, clientHeight: 400, offsetLeft: 3, offsetTop: 4, parentElement: {},
        ownerDocument: { defaultView: { devicePixelRatio: 2 }, createElement() {
            const canvas = { style: {}, setAttribute() {}, getContext: () => context,
                remove() { canvases.splice(canvases.indexOf(this), 1); } };
            return canvas;
        } }, after(value) { canvases.push(value); } };
    const renderer = { domElement: dom, autoClear: true, render() {} };
    const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
    bones[0].name = '布料尾部'; bones[1].name = '前面'; bones[2].name = '';
    bones[1].position.set(1, 0, 0);
    bones[2].position.set(0, 1, 0);
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 10, 1), new THREE.MeshBasicMaterial());
    bones.forEach(bone => mesh.add(bone));
    mesh.bind(new THREE.Skeleton(bones));
    const params = { shapeType: 0, width: 0.3, height: 0.3, depth: 0.3, type: 1,
        weight: 1, friction: 0, restitution: 0, positionDamping: 0, rotationDamping: 0,
        groupIndex: 0, groupTarget: 65535, position: [0, 0, 0], rotation: [0, 0, 0] };
    mesh.geometry.userData.MMD = { rigidBodies: [
        { ...params, boneIndex: 0, type: 0 }, { ...params, boneIndex: 1 },
        { ...params, boneIndex: -1, position: [0.8, 0, 0] }
    ] };
    mesh.updateWorldMatrix(true, true);
    const selection = createSkeletonSelection({ THREE, renderer, camera, scene });
    selection.setModel(mesh);
    return { THREE, scene, camera, mesh, bones, params, selection, renderer, dom, calls, canvases,
        normalizeSkeletonSize, createSkeletonOverlay, createRigidBodyOverlay };
}

test('小球倍率范围、无效输入与真实实例半径；只改变显示大小', async () => {
    const f = await fixture();
    const overlay = f.createSkeletonOverlay(f);
    let rendered;
    f.renderer.render = scene => { rendered = scene; };
    overlay.setModel(f.mesh); overlay.setVisible(true);
    const before = f.bones.map(bone => bone.position.toArray());
    for (const [input, expected] of [[undefined, 1], ['2', 1], [NaN, 1], [Infinity, 1], [-1, 0.2], [99, 3], [1.36, 1.4]]) {
        assert.equal(f.normalizeSkeletonSize(input), expected);
        assert.equal(overlay.setSize(input), expected);
        overlay.render();
        const marker = rendered.children.find(item => item.isInstancedMesh);
        const matrix = new f.THREE.Matrix4();
        marker.getMatrixAt(0, matrix);
        assert.ok(Math.abs(new f.THREE.Vector3().setFromMatrixScale(matrix).x - 0.035 * expected) < 1e-6);
        assert.equal(overlay.getState().sizeMultiplier, expected);
        assert.deepEqual(f.bones.map(bone => bone.position.toArray()), before);
    }
    overlay.dispose();
});

test('中文名称批量绘制、固定字号、尺寸/DPR同步；关闭与隐藏无残留', async () => {
    const f = await fixture();
    f.selection.setVisible(true); f.selection.setNamesVisible(true);
    f.selection.update(0.02);
    assert.equal(f.canvases.length, 1);
    assert.equal(f.canvases[0].width, 800);
    assert.equal(f.selection.getState().labelCount, 2);
    assert.deepEqual(f.calls.filter(call => call[0] === 'fillText').map(call => call[1]), ['布料尾部', '前面']);
    f.dom.clientWidth = 200; f.dom.clientHeight = 300;
    f.selection.update(0.06);
    assert.equal(f.canvases[0].width, 400);
    assert.equal(f.canvases[0].height, 600);
    f.selection.setNamesVisible(false);
    assert.equal(f.canvases[0].hidden, true);
    const draws = f.selection.getState().labelDrawCount;
    f.selection.update(0.02);
    assert.equal(f.selection.getState().labelDrawCount, draws);
    f.selection.setNamesVisible(true); f.selection.update(0.02); f.selection.hide();
    assert.equal(f.canvases[0].hidden, true);
    assert.equal(f.selection.getState().labelCount, 0);
    f.selection.dispose(); f.selection.dispose();
    assert.equal(f.canvases.length, 0);
});

test('名称裁剪相机后方、近远裁剪面及屏幕外，空名字不绘制', async () => {
    const f = await fixture();
    f.selection.setVisible(true); f.selection.setNamesVisible(true);
    f.bones[0].position.z = 6;
    f.bones[1].position.x = 100;
    f.mesh.updateWorldMatrix(true, true); f.selection.update(0.02);
    assert.equal(f.selection.getState().labelCount, 0);
    f.bones[0].position.z = 4.99;
    f.mesh.updateWorldMatrix(true, true); f.selection.update(0.02);
    assert.equal(f.selection.getState().labelCount, 0);
    f.selection.dispose();
});

test('点选命中与空白取消，重叠点优先前方；选中名称及局部轴跟随父级变换', async () => {
    const f = await fixture();
    f.selection.setVisible(true); f.selection.update(0.02);
    assert.equal(f.selection.pick({ normalizedX: 0, normalizedY: 0 }), true);
    assert.equal(f.selection.getState().selectedBoneIndex, 0);
    f.selection.update(0.02);
    assert.equal(f.selection.getState().labelCount, 1);
    assert.equal(f.selection.getState().axesVisible, true);
    f.mesh.rotation.z = Math.PI / 2; f.mesh.position.set(2, 3, 0); f.mesh.scale.setScalar(2);
    f.mesh.updateWorldMatrix(true, true); f.selection.update(0.04);
    const axes = f.selection.getState().axes;
    assert.deepEqual(axes.origin, [2, 3, 0]);
    assert.ok(new f.THREE.Vector3(...axes.directions[0]).distanceTo(new f.THREE.Vector3(0, 1, 0)) < 1e-7);
    f.selection.pick({ normalizedX: -0.95, normalizedY: -0.95 });
    f.selection.update(0.04);
    assert.equal(f.selection.getState().selectedBoneIndex, -1);
    assert.equal(f.selection.getBodyFilter(), null);
    assert.equal(f.selection.getState().axesVisible, false);
    f.mesh.position.set(0, 0, 0); f.mesh.rotation.z = 0; f.mesh.scale.setScalar(1);
    f.bones[1].position.set(0, 0, 1); f.mesh.updateWorldMatrix(true, true);
    f.selection.update(0.02); f.selection.pick({ normalizedX: 0, normalizedY: 0 });
    assert.equal(f.selection.getState().selectedBoneIndex, 1);
    f.selection.setVisible(false);
    assert.equal(f.selection.pick({ normalizedX: 0, normalizedY: 0 }), false);
    assert.equal(f.selection.getState().selectedBoneIndex, -1);
    f.selection.dispose();
});

test('多关联刚体与无刚体骨骼筛选，换模型清除轴/名称，不替父骨骼累计', async () => {
    const f = await fixture();
    f.mesh.geometry.userData.MMD.rigidBodies.push({ ...f.params, boneIndex: 0 });
    f.selection.setVisible(true); f.selection.update(0.02);
    f.selection.select(0);
    assert.deepEqual([...f.selection.getBodyFilter()], [0, 3]);
    f.selection.select(2);
    assert.deepEqual([...f.selection.getBodyFilter()], []);
    assert.deepEqual(f.selection.getState().ownBodyIndices, []);
    f.selection.update(0.02); const axes = f.scene.children[0];
    let disposed = 0; axes.geometry.addEventListener('dispose', () => { disposed += 1; });
    f.selection.setModel(f.mesh);
    assert.equal(disposed, 1);
    assert.equal(f.scene.children.length, 0);
    assert.equal(f.selection.getState().selectedBoneIndex, -1);
    assert.equal(f.canvases[0].hidden, true);
    f.selection.dispose();
});

test('碰撞体实例筛选压缩有效count，空选择隐藏，取消后原实例全量恢复', async () => {
    const f = await fixture();
    const overlay = f.createRigidBodyOverlay(f);
    overlay.setModel(f.mesh); overlay.setVisible(true); overlay.render();
    const groups = overlay.getState().resourceGroups;
    overlay.setBodyFilter(new Set([1])); overlay.render();
    assert.equal(overlay.getState().visibleBodyCount, 1);
    assert.deepEqual(overlay.getState().samples.map(sample => sample.bodyIndex), [1]);
    overlay.setBodyFilter(new Set()); overlay.render();
    assert.equal(overlay.getState().visibleBodyCount, 0);
    overlay.setBodyFilter(null); overlay.render();
    assert.equal(overlay.getState().visibleBodyCount, 3);
    assert.equal(overlay.getState().resourceGroups, groups);
    overlay.dispose();
});

let ammoFixture;
async function realAmmo() {
    if (!ammoFixture) ammoFixture = (async () => {
        const vendor = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three');
        globalThis.Ammo = await require(path.join(vendor, 'libs/ammo.wasm.js'))({
            wasmBinary: fs.readFileSync(path.join(vendor, 'libs/ammo.wasm.wasm')) });
        const url = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
        const source = addPhysicsSubsteps(addPhysicsLifecycle(fs.readFileSync(path.join(vendor, 'animation/MMDPhysics.js'), 'utf8')))
            .replace("from 'three'", `from '${url}'`);
        return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).MMDPhysics;
    })();
    return ammoFixture;
}

test('真Ammo每子步累计直接接触，不递归碰撞链；不改速度，重建/清空/取消归还观察入口', async () => {
    const f = await fixture();
    const MMDPhysics = await realAmmo();
    f.bones[1].position.x = 0.4;
    f.mesh.updateWorldMatrix(true, true);
    const create = () => new MMDPhysics(f.mesh, f.mesh.geometry.userData.MMD.rigidBodies, [], {
        unitStep: 1 / 180, maxStepNum: 19, gravity: new f.THREE.Vector3(0, 0, 0) });
    const physics = create();
    let next;
    try {
        f.selection.setVisible(true); f.selection.update(0.02); f.selection.observePhysics(physics);
        assert.equal(physics.onDiagnosticSubstep, null);
        f.selection.select(0);
        physics.update(1 / 60);
        assert.ok(f.selection.getState().contactScanCount >= 3);
        assert.deepEqual(f.selection.getState().contactBodyIndices, [1]);
        const dispatcher = physics.world.getDispatcher();
        assert.ok(dispatcher.getNumManifolds() >= 2);
        const before = physics.bodies.map(entry => {
            const v = entry.body.getLinearVelocity(); return [v.x(), v.y(), v.z()];
        });
        const nativeCount = physics.manager.nativeObjects.size;
        const probes = [];
        for (let i = 0; i < 1000; i += 1) physics.onDiagnosticSubstep();
        for (let i = 0; i < 3; i += 1) {
            const pointer = Ammo._malloc(4 * 1024 * 1024);
            assert.ok(pointer);
            probes.push(pointer);
            Ammo._free(pointer);
            for (let j = 0; j < 100; j += 1) physics.onDiagnosticSubstep();
        }
        assert.equal(new Set(probes).size, 1);
        assert.equal(physics.manager.nativeObjects.size, nativeCount);
        assert.deepEqual(physics.bodies.map(entry => {
            const v = entry.body.getLinearVelocity(); return [v.x(), v.y(), v.z()];
        }), before);
        f.selection.clearContacts();
        assert.deepEqual(f.selection.getState().contactBodyIndices, []);
        assert.deepEqual([...f.selection.getBodyFilter()], [0]);
        next = create(); f.selection.observePhysics(next);
        assert.equal(physics.onDiagnosticSubstep, null);
        assert.deepEqual(f.selection.getState().contactBodyIndices, []);
        assert.equal(typeof next.onDiagnosticSubstep, 'function');
        f.selection.select(-1);
        assert.equal(next.onDiagnosticSubstep, null);
        assert.equal(f.selection.getBodyFilter(), null);
    } finally {
        f.selection.dispose(); physics.dispose(); next?.dispose();
        assert.equal(physics.manager.nativeObjects.size, 0);
    }
});

test('真Ammo跨子步短暂接触会保留，诊断读取失败不打断后续物理步', async () => {
    const f = await fixture();
    const MMDPhysics = await realAmmo();
    f.bones[1].position.x = 0.4;
    f.mesh.updateWorldMatrix(true, true);
    const physics = new MMDPhysics(f.mesh, f.mesh.geometry.userData.MMD.rigidBodies, [], {
        unitStep: 1 / 180, maxStepNum: 19, gravity: new f.THREE.Vector3() });
    const form = physics.manager.allocTransform();
    const velocity = physics.manager.allocVector3();
    try {
        f.selection.setVisible(true); f.selection.update(0.02); f.selection.observePhysics(physics); f.selection.select(0);
        const capture = physics.onDiagnosticSubstep;
        let steps = 0;
        physics.onDiagnosticSubstep = () => {
            capture();
            steps += 1;
            if (steps !== 1) return;
            // 仅测试环境在第一步记录后移走对手，确认后续子步无接触时仍保留记录。
            form.setIdentity(); velocity.setValue(8, 0, 0); form.setOrigin(velocity);
            physics.bodies[1].body.setCenterOfMassTransform(form);
            physics.bodies[1].body.getMotionState().setWorldTransform(form);
            velocity.setValue(0, 0, 0); physics.bodies[1].body.setLinearVelocity(velocity);
        };
        physics.update(1 / 60);
        assert.equal(steps, 3);
        assert.deepEqual(f.selection.getState().contactBodyIndices, [1]);
        physics.onDiagnosticSubstep = capture;
        const getDispatcher = physics.world.getDispatcher;
        physics.world.getDispatcher = () => { throw new Error('测试读取失败'); };
        const before = physics.physicsStepTime;
        physics.update(1 / 60);
        assert.ok(physics.physicsStepTime > before);
        assert.match(f.selection.getState().contactError, /测试读取失败/u);
        physics.world.getDispatcher = getDispatcher;
    } finally {
        f.selection.dispose(); physics.manager.freeTransform(form); physics.manager.freeVector3(velocity); physics.dispose();
    }
});

test('存储损坏/不可用、倍率钳制与默认、选中状态说明、清空按钮', () => {
    const source = WEB_PANEL_GROUP_JS.match(/\(\(\) => \{\s+const size = document.getElementById\('mmdArSkeletonSize'\);[\s\S]*?\}\)\(\);/u)[0];
    for (const stored of [null, '{', 'throws', '{"sizeMultiplier":99,"namesVisible":true}', '{"sizeMultiplier":"2"}']) {
        const elements = {};
        for (const id of ['mmdArSkeletonSize', 'mmdArSkeletonNamesEnabled', 'mmdArSkeletonSelectionStatus', 'mmdArSkeletonClearContacts', 'mmdArSkeletonSizeValue']) {
            elements[id] = { listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
        }
        const values = [];
        let clears = 0;
        const state = { selectedBoneIndex: 2, selectedBoneName: '裙子', ownBodyIndices: [], contactBodyIndices: [] };
        vm.runInNewContext(source, { document: { getElementById: id => elements[id] },
            localStorage: { getItem() { if (stored === 'throws') throw new Error('受限'); return stored; }, setItem() {} },
            window: { addEventListener() {}, DisplayMmd: { setSkeletonSize: value => values.push(value),
                setSkeletonNamesVisible() {}, getSkeletonState: () => state, clearSkeletonContacts: () => { clears += 1; } } } });
        assert.equal(values[0], stored?.includes('99') ? 3 : 1);
        assert.match(elements.mmdArSkeletonSelectionStatus.textContent, /无关联刚体/u);
        elements.mmdArSkeletonSize.value = '0.2'; elements.mmdArSkeletonSize.listeners.input();
        assert.equal(values.at(-1), 0.2);
        elements.mmdArSkeletonClearContacts.listeners.click();
        assert.equal(clears, 1);
    }
});

test('真实Display指针收尾只消费主键轻点，拖动/右键/游离抬起/双指均不误选', () => {
    const file = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/display-mmd.js');
    const source = addSkeletonDisplay(fs.readFileSync(file, 'utf8'));
    const start = source.indexOf('    function handlePointerUp(event) {');
    const body = source.slice(start, source.indexOf('    function handlePointerCancel(event)', start));
    for (const scenario of ['tap', 'drag', 'right', 'stray', 'two-touch', 'suppressed-touch']) {
        let picked = 0;
        const state = { pointerEnabled: true, visible: true, activeTouchPointers: new Map(),
            suppressedTouchPointers: new Set(), pressedPoint: null,
            rotationDrag: ['tap', 'drag'].includes(scenario) ? { pointerId: 7 } : null,
            runtime: { pickSkeleton() { picked += 1; return true; } } };
        const event = { pointerId: 7, pointerType: scenario.includes('touch') ? 'touch' : 'mouse' };
        if (scenario === 'two-touch') {
            state.activeTouchPointers.set(7, {}); state.activeTouchPointers.set(8, {});
            state.touchGesture = { pointerIds: [7, 8] };
        }
        if (scenario === 'suppressed-touch') {
            state.activeTouchPointers.set(7, {}); state.suppressedTouchPointers.add(7);
        }
        vm.runInNewContext(body + '\nhandlePointerUp(event);', { state, event,
            finishTranslationDrag: () => false,
            finishRotationDrag: () => { state.rotationDrag = null; return scenario === 'drag'; },
            getCanvasPoint: () => ({ normalizedX: 0, normalizedY: 0 }),
            releasePointerCapture() {}, POINTER_DRAG_THRESHOLD: 8,
            triggerInteraction() { throw new Error('诊断轻点不能触发角色动作'); } });
        assert.equal(picked, scenario === 'tap' ? 1 : 0, scenario);
    }
});
