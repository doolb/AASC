const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const THREE = require('three');

const ROOT = path.resolve(__dirname, '..');
const LAYOUT_MODULE_PATH = path.join(
    ROOT,
    'src/apps/web-mediacenter/ui/public/js/pmx-display-layout.mjs'
);

const loadLayoutModule = () => import(`${pathToFileURL(LAYOUT_MODULE_PATH).href}?test=${Date.now()}-${Math.random()}`);

test('PMX 物理布局保持单位缩放并以相机容纳原始模型边界', async () => {
    const { normalizePmxPhysicsMesh, calculatePmxCameraFrame } = await loadLayoutModule();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), new THREE.MeshBasicMaterial());
    mesh.position.set(3, 9, -2);
    mesh.scale.setScalar(0.1);

    const bounds = normalizePmxPhysicsMesh(mesh, THREE);
    const frame = calculatePmxCameraFrame(bounds, { fovDegrees: 28, aspect: 0.5 });

    assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
    assert.deepEqual(mesh.position.toArray(), [0, 2, 0]);
    assert.deepEqual(bounds.min.toArray(), [-1, 0, -0.5]);
    assert.deepEqual(bounds.max.toArray(), [1, 4, 0.5]);
    assert.deepEqual(frame.center.toArray(), [0, 2, 0]);
    assert.ok(frame.distance > 8, '纵向窄屏视角必须能容纳 4 单位高的模型');
    assert.ok(frame.near > 0 && frame.near < frame.distance);
    assert.ok(frame.far > frame.distance);
});
