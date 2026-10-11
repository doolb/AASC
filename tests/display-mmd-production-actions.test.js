'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');

test('正式动作目录、待机源码、固定编译器与全部相对模块依赖随包齐全', async () => {
    const { validateServerActions } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-server-actions.mjs');
    const catalog = validateServerActions(JSON.parse(fs.readFileSync(path.join(ROOT, 'mmd-actions.json'))), 'http://localhost/mmd-actions.json');
    assert.deepEqual(catalog.map(item => item.name), ['待机', '跳舞']);
    const source = fs.readFileSync(path.join(ROOT, 'mmd/motions/miya-idle.mpl'), 'utf8');
    assert.match(source, /elbow_l bend forward 10;/u);
    assert.match(source, /wrist_l bend forward -10;/u);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'mmd/actions-source.json')));
    for (const item of manifest.files) {
        const bytes = fs.readFileSync(path.join(ROOT, item.name));
        assert.equal(bytes.length, item.size, item.name);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, item.name);
    }
    for (const name of ['mmd_mpl.js', 'mmd_mpl_bg.wasm', 'LICENSE']) assert.ok(fs.statSync(path.join(ROOT, 'js/vendor/mmd-mpl/0.3.6-2d3b1c7e3429', name)).size > 0);
    const files = fs.readdirSync(path.join(ROOT, 'js')).filter(name => /^(?:mmd-(?:human|reply|mpl|lighting|actions|expressions)|display-mmd-human).*\.(?:m?js)$/u.test(name));
    for (const name of files) {
        const text = fs.readFileSync(path.join(ROOT, 'js', name), 'utf8');
        assert.doesNotMatch(text, /(?:MmdAr(?:Human|Reply|Mpl)|aasc\.mmdArTest|\.\/web-(?:human|reply|mpl|lighting))/u, name);
        for (const match of text.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"?]+)(?:\?[^'"]*)?['"]/gu)) {
            assert.ok(fs.existsSync(path.resolve(ROOT, 'js', match[1])), name + ' → ' + match[1]);
        }
    }
});

test('正式首次灯光保留旧高光/AO标量和渲染设置，缺失组才套用默认', async () => {
    const { applyLightingDefaults } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-lighting-defaults.mjs');
    const { groupNames } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-lighting-preset-library.mjs');
    const { default: record } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-lighting-default-preset.mjs');
    const applied = [], groups = Object.fromEntries(groupNames.map(key => [key, {
        normalize: value => ({ ...record.settings[key], ...value }), apply: value => applied.push([key, value])
    }]));
    const saved = new Map([
        ['aasc.display.mmdLighting.v1', JSON.stringify({ ambientIntensity: .3 })],
        ['aasc.display.mmdSpecular.v1', JSON.stringify({ enabled: false })],
        ['aasc.display.mmdAoEdgeCorrection.v1', 'true'],
        ['aasc.display.mmd.render.v1', JSON.stringify({ canvasScale: .5 })]
    ]);
    applyLightingDefaults(record, groups, { onlyUnsaved: true, storage: () => ({ getItem: key => saved.get(key) ?? null }) });
    assert.deepEqual(applied.map(([key]) => key), groupNames.filter(key => !['lighting', 'specular', 'aoEdgeCorrection', 'render'].includes(key)));
    applied.length = 0;
    applyLightingDefaults(record, groups, { storage: () => ({ getItem: () => null }) });
    assert.deepEqual(applied.map(([key]) => key), groupNames);
});

test('正式刚体接口触发平滑手臂避让，接触解除后回归基础动作', async () => {
    const THREE = await import('three');
    const { createHumanArmAvoidance } = await import('../src/apps/web-mediacenter/ui/public/js/mmd-human-arm-avoidance.mjs');
    const arm = new THREE.Bone(), elbow = new THREE.Bone(), wrist = new THREE.Bone();
    arm.position.set(0, 2, 0); elbow.position.set(1, 0, 0); wrist.position.set(1, 0, 0); arm.add(elbow); elbow.add(wrist);
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()); mesh.add(arm);
    mesh.bind(new THREE.Skeleton([arm, elbow, wrist]));
    const params = { width: .2, height: .2, depth: .2, shapeType: 0, position: [0, 0, 0], rotation: [0, 0, 0], groupIndex: 0, groupTarget: 65535 };
    mesh.geometry.userData.MMD = { rigidBodies: [{ ...params, type: 0, boneIndex: 2 }, { ...params, type: 1, boneIndex: -1 }], constraints: [], iks: [] };
    const binding = (bone, index) => ({ bone, index, dynamic: false });
    const model = { mesh, bindings: { 'bones:rightArm': binding(arm, 0), 'bones:rightElbow': binding(elbow, 1),
        'bones:rightWrist': binding(wrist, 2) }, groups: { rightArm: new Set([0, 1, 2]) } };
    const cloth = new THREE.Vector3(2, 2.15, 0), physics = {
        getBodyPose(index, position, quaternion) { position.copy(cloth); quaternion.identity(); return index === 1; }
    };
    const avoidance = createHumanArmAvoidance();
    const frame = () => { avoidance.restore(); avoidance.apply(model, physics, 1 / 60, true); return avoidance.getState(); };
    try {
        const initial = frame(); assert.ok(initial.contacts > 0); assert.ok(initial.correctionDegrees > 0);
        cloth.set(4, 5, 0);
        let last;
        for (let i = 0; i < 100; i++) { last = frame(); assert.ok(last.stepDegrees <= 10.5001); }
        assert.ok(last.correctionDegrees < .001); assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) < .0001);
    } finally { avoidance.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
});
