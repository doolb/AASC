'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const THREE = require('three');

const loadClip = () => import('../src/apps/web-mediacenter/ui/public/js/mmd-camera-clip.mjs');
const checkProjection = (camera) => {
    const expected = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
    assert.ok(Math.abs(camera.projectionMatrix.elements[10] - expected.projectionMatrix.elements[10]) < 1e-12);
    assert.ok(Math.abs(camera.projectionMatrix.elements[14] - expected.projectionMatrix.elements[14]) < 1e-12);
    const identity = camera.projectionMatrix.clone().multiply(camera.projectionMatrixInverse);
    identity.elements.forEach((value, index) => {
        assert.ok(Math.abs(value - (index % 5 === 0 ? 1 : 0)) < 1e-10);
    });
};

test('镜头拉远更新far与实际深度投影，拉近恢复基础范围且静止不重复更新', async () => {
    const { createPmxCameraClip } = await loadClip();
    const camera = new THREE.PerspectiveCamera(28, 1, 1, 30);
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -2, -1), new THREE.Vector3(1, 2, 1));
    const clip = createPmxCameraClip(THREE, camera);
    clip.fit(null, bounds, 30);
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    assert.equal(clip.sync(), true);
    assert.ok(camera.far > 202);
    camera.updateMatrixWorld(true);
    assert.ok(new THREE.Vector3(0, 0, -1).project(camera).z < 1, '远侧模型实际深度不能被far裁掉');
    checkProjection(camera);
    assert.equal(clip.sync(), false);
    camera.position.z = 10;
    clip.sync();
    assert.equal(camera.far, 30);
    checkProjection(camera);
});

test('AR输入投影连续覆盖后仍扩展far，偏心构图保持且模式基础范围独立', async () => {
    const { createPmxCameraClip } = await loadClip();
    const camera = new THREE.PerspectiveCamera(55, 0.6, 1, 40);
    const clip = createPmxCameraClip(THREE, camera);
    clip.fit(null, new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 8, 2)), 40);
    const input = new THREE.PerspectiveCamera(55, 0.6, 1, 100);
    input.setViewOffset(800, 600, 20, 30, 400, 500);
    const original = input.projectionMatrix.toArray();
    for (const distance of [300, 500, 20]) {
        camera.position.set(0, 4, distance);
        camera.far = 100;
        camera.projectionMatrix.copy(input.projectionMatrix);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        clip.sync(100);
        assert.ok(camera.far >= distance + 8);
        assert.equal(camera.near, 1);
        original.forEach((value, index) => {
            if (index !== 10 && index !== 14) assert.equal(camera.projectionMatrix.elements[index], value);
        });
        checkProjection(camera);
    }
    assert.equal(camera.far, 100, '拉近恢复AR基础范围');
    clip.sync();
    assert.equal(camera.far, 40, '退出AR可恢复预览基础范围');
});

test('缓存边界跟随模型根的平移旋转缩放，并在换模型后替换旧参考', async () => {
    const { createPmxCameraClip } = await loadClip();
    const camera = new THREE.PerspectiveCamera(28, 1, 1, 20);
    const root = new THREE.Group();
    root.position.set(3, 2, 1);
    root.updateMatrixWorld(true);
    const localBounds = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 4, 1));
    const clip = createPmxCameraClip(THREE, camera);
    clip.fit(root, localBounds.clone().applyMatrix4(root.matrixWorld), 20);
    root.position.set(150, 0, -250);
    root.rotation.y = 0.7;
    root.scale.set(2, 3, 4);
    clip.sync();
    const center = new THREE.Vector3(0, 2, 0).applyMatrix4(root.matrixWorld);
    const expected = camera.position.distanceTo(center) + localBounds.getSize(new THREE.Vector3()).length() * 4;
    assert.ok(Math.abs(camera.far - expected) < 1e-10);
    checkProjection(camera);
    clip.fit(null, localBounds, 20);
    clip.sync();
    assert.equal(camera.far, 20, '替换模型不能继续使用旧根矩阵');
});
