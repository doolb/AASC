'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const root = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js');
const read = file => fs.readFileSync(file, 'utf8');
const bodyParams = { type: 1, boneIndex: -1, shapeType: 1, width: 0.1, height: 0.2, depth: 0.3,
    weight: 0.001, position: [0, 0, 0], rotation: [0, 0, 0], positionDamping: 0,
    rotationDamping: 0, friction: 0, restitution: 0, groupIndex: 0, groupTarget: 0 };

test('正式与测试风数值和XPBD包装保持同源，构建适配重复执行不重复注入', () => {
    assert.equal(read(path.join(root, 'mmd-physics-wind.mjs')), read(path.resolve(__dirname, '../3rd/mmd-ar-test/web-physics-wind.mjs')));
    assert.equal(read(path.join(root, 'mmd-xpbd-physics.mjs')), read(path.resolve(__dirname, '../3rd/mmd-ar-test/web-xpbd-physics.mjs')).replace(/\.\/web-/gu, './mmd-'));
    const { addPhysicsWind } = require('../3rd/mmd-ar-test/web-physics-wind');
    const once = addPhysicsWind(read(path.join(root, 'vendor/three/animation/MMDPhysics.js')), '../../../web-physics-wind.mjs?v=123456789abc');
    assert.equal(addPhysicsWind(once, '../../../web-physics-wind.mjs?v=123456789abc'), once);
    assert.equal(once.split('this.windSceneMatrix = new Matrix4();').length, 2);
    assert.equal(once.split('    _applyWind(seconds) {').length, 2);
    assert.equal(once.split('import { calculateRigidWindForce, sampleRigidWindStrength }').length, 2);
    assert.ok(!once.includes('mmd-physics-wind.mjs'));
});

async function loadAmmoPhysics() {
    const filename = path.join(root, 'vendor/three/animation/MMDPhysics.js');
    const threeUrl = pathToFileURL(path.join(path.dirname(require.resolve('three')), 'three.module.js')).href;
    const source = read(filename).replace(/from\s+(['"])([^'"]+)\1/gu,
        (match, quote, ref) => `from ${quote}${ref === 'three' ? threeUrl : new URL(ref, pathToFileURL(filename)).href}${quote}`);
    const { MMDPhysics } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const vendor = path.join(root, 'vendor/three/libs');
    globalThis.Ammo = await require(path.join(vendor, 'ammo.wasm.js'))({ wasmBinary: fs.readFileSync(path.join(vendor, 'ammo.wasm.wasm')) });
    return MMDPhysics;
}

test('正式Ammo及XPBD受风、type2位置驱动、旋转缩放和重复释放回归', async () => {
    const THREE = await import('three');
    const { XpbdPmxPhysics } = await import(pathToFileURL(path.join(root, 'mmd-xpbd-physics.mjs')).href);
    const MMDPhysics = await loadAmmoPhysics();
    for (const backend of [MMDPhysics, XpbdPmxPhysics]) {
        for (const type of [1, 2]) {
            const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
            const bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
            const pivot = new THREE.Group(); pivot.rotation.y = Math.PI / 2; pivot.scale.setScalar(0.1); pivot.add(mesh);
            pivot.updateMatrixWorld(true);
            const physics = new backend(mesh, [{ ...bodyParams, type, boneIndex: type === 2 ? 0 : -1,
                position: type === 2 ? [0, 0.3, 0] : [0, 0, 0] }], [],
            { gravity: new THREE.Vector3(), unitStep: 1 / 180, maxStepNum: 30, stabilityReferenceHz: 45 });
            try {
                physics.setWindSettings({ enabled: true, strength: 30, longitude: -90, gust: 0 });
                for (let i = 0; i < 60; i += 1) physics.update(1 / 60);
                const entry = physics.bodies[0];
                const nativeVelocity = entry.body?.getLinearVelocity();
                const localVelocity = nativeVelocity ? new THREE.Vector3(nativeVelocity.x(), nativeVelocity.y(), nativeVelocity.z()) : entry.velocity.clone();
                const worldVelocity = localVelocity.applyQuaternion(pivot.quaternion);
                assert.ok(worldVelocity.toArray().every(Number.isFinite));
                if (type === 1) {
                    assert.ok(worldVelocity.x > 10 && worldVelocity.x <= Math.sqrt(600) + 1e-4);
                    assert.ok(Math.abs(worldVelocity.y) < 1e-5 && Math.abs(worldVelocity.z) < 1e-5);
                    physics.setWindSettings({ enabled: false }); physics.update(1 / 60);
                    const stopped = entry.body?.getLinearVelocity();
                    const after = stopped ? new THREE.Vector3(stopped.x(), stopped.y(), stopped.z()) : entry.velocity.clone();
                    assert.ok(after.distanceTo(localVelocity.applyQuaternion(pivot.quaternion.clone().invert())) < 1e-4);
                } else {
                    assert.deepEqual(bone.position.toArray(), [0, 0, 0]);
                    const omega = entry.body?.getAngularVelocity();
                    const angular = omega ? [omega.x(), omega.y(), omega.z()] : entry.omega.toArray();
                    assert.ok(angular.every(Number.isFinite));
                    assert.ok(Math.hypot(...angular) > 0.01 && Math.hypot(...angular) <= 12.01);
                }
            } finally {
                const manager = physics.manager;
                physics.dispose(); physics.dispose();
                assert.equal(physics.bodies.length, 0);
                if (manager) assert.equal(manager.nativeObjects.size, 0);
                pivot.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
            }
        }
    }
});
