/*
 * PMX 显示布局工具。
 *
 * MMDPhysics 的刚体、关节和 VMD 位移轨道均使用 PMX 原始单位。若缩放
 * SkinnedMesh，Three.js r160 会在物理更新时临时还原为原始尺度，动态骨骼
 * 会被写回错误坐标。因此画面适配只移动相机，不缩放物理网格。
 */

const CAMERA_FRAME_MARGIN = 1.12;

export function normalizePmxPhysicsMesh(mesh, THREE) {
    mesh.scale.set(1, 1, 1);
    mesh.updateWorldMatrix(true, true);

    const bounds = new THREE.Box3().setFromObject(mesh);
    if (bounds.isEmpty()) return bounds;

    const center = bounds.getCenter(new THREE.Vector3());
    mesh.position.x -= center.x;
    mesh.position.y -= bounds.min.y;
    mesh.position.z -= center.z;
    mesh.updateWorldMatrix(true, true);

    return new THREE.Box3().setFromObject(mesh);
}

export function calculatePmxCameraFrame(bounds, { fovDegrees = 28, aspect = 1 } = {}) {
    const center = bounds.getCenter(bounds.min.clone());
    const size = bounds.getSize(bounds.min.clone());
    const verticalFov = Math.max(0.01, Number(fovDegrees) || 28) * Math.PI / 180;
    const safeAspect = Math.max(0.01, Number(aspect) || 1);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
    const halfHeightDistance = size.y / 2 / Math.tan(verticalFov / 2);
    const halfWidthDistance = size.x / 2 / Math.tan(horizontalFov / 2);
    const distance = (Math.max(halfHeightDistance, halfWidthDistance) + size.z / 2)
        * CAMERA_FRAME_MARGIN;
    const radius = Math.max(0.01, size.length() / 2);

    return {
        center,
        size,
        distance,
        near: Math.max(0.01, distance - radius * 2),
        far: distance + radius * 2
    };
}
