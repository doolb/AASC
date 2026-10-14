'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

async function setup() {
    const T = await import('three'), markers = await import('../3rd/mmd-ar-test/web-human-ik-markers.mjs');
    const camera = new T.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.z = 4; camera.updateMatrixWorld();
    return { T, camera, ...markers, rect: { left: 10, top: 20, width: 600, height: 600 } };
}

test('控制点在近远镜头、缩放及正交投影下保持32px直径', async () => {
    const f = await setup(), position = new f.T.Vector3();
    for (const distance of [2, 4, 20]) for (const zoom of [1, 2]) {
        f.camera.position.z = distance; f.camera.zoom = zoom;
        f.camera.updateProjectionMatrix(); f.camera.updateMatrixWorld();
        const screen = f.projectIKMarker(position, f.camera, f.rect);
        const edge = new f.T.Vector3(screen.radius, 0, 0).project(f.camera);
        assert.ok(Math.abs(edge.x * f.rect.width - 32) < 1e-8);
    }
    const camera = new f.T.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    camera.position.z = 10; camera.updateMatrixWorld();
    const screen = f.projectIKMarker(position, camera, f.rect);
    assert.ok(Math.abs(new f.T.Vector3(screen.radius, 0, 0).project(camera).x * f.rect.width - 32) < 1e-8);
});

test('控制点20–48px设置边界及不可见点过滤', async () => {
    const f = await setup();
    assert.equal(f.normalizeMarkerDiameter(), 32);
    assert.equal(f.normalizeMarkerDiameter(2), 20); assert.equal(f.normalizeMarkerDiameter(100), 48);
    assert.equal(f.normalizeMarkerDiameter(NaN), 32);
    for (const point of [[0, 0, 5], [100, 0, 0], [0, 0, -200]]) {
        assert.equal(f.projectIKMarker(new f.T.Vector3(...point), f.camera, f.rect).visible, false);
    }
});

test('控制点屏幕中心正确适配0/90/180/270度舞台', async () => {
    const f = await setup(), point = new f.T.Vector3(0.3, 0.2, 0), ndc = point.clone().project(f.camera);
    const expected = { 0: [ndc.x, -ndc.y], 90: [ndc.y, ndc.x], 180: [-ndc.x, ndc.y], 270: [-ndc.y, -ndc.x] };
    for (const rotation of [0, 90, 180, 270]) {
        const screen = f.projectIKMarker(point, f.camera, f.rect, { logicalWidth: 600, logicalHeight: 600, rotation });
        assert.ok(Math.abs(screen.x - (310 + expected[rotation][0] * 300)) < 1e-8);
        assert.ok(Math.abs(screen.y - (320 + expected[rotation][1] * 300)) < 1e-8);
    }
    const rect = { left: 10, top: 20, width: 400, height: 800 };
    const screen = f.projectIKMarker(point, f.camera, rect, { logicalWidth: 800, logicalHeight: 400, rotation: 90 });
    assert.ok(Math.abs(screen.x - (210 + ndc.y * 200)) < 1e-8);
    assert.ok(Math.abs(screen.y - (420 + ndc.x * 400)) < 1e-8);
});

test('44px命中容差覆盖可见球外缘、重叠选最近点且空白不截断镜头', async () => {
    const f = await setup();
    const a = new f.T.Mesh(), b = new f.T.Mesh();
    const origin = f.projectIKMarker(new f.T.Vector3(), f.camera, f.rect);
    const handles = [{ mesh: a }, { mesh: b }]; b.position.x = 0.1; a.updateMatrixWorld(); b.updateMatrixWorld();
    assert.equal(f.pickIKMarker([{ mesh: a }], { x: origin.x + 21, y: origin.y }, f.camera, f.rect, null, 32)?.object, a);
    assert.equal(f.pickIKMarker(handles, { x: origin.x + 70, y: origin.y }, f.camera, f.rect, null, 32), null);
    const nearB = f.projectIKMarker(b.position, f.camera, f.rect);
    assert.equal(f.pickIKMarker(handles, { x: nearB.x - 1, y: nearB.y }, f.camera, f.rect, null, 32)?.object, b);
    a.position.z = 5; a.updateMatrixWorld();
    assert.equal(f.pickIKMarker([{ mesh: a }], { x: origin.x, y: origin.y }, f.camera, f.rect, null, 32), null);
});
