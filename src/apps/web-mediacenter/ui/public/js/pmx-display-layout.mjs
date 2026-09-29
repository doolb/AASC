/*
 * PMX 显示布局工具。
 *
 * MMDPhysics 的刚体、关节和 VMD 位移轨道均使用 PMX 原始单位。若缩放
 * SkinnedMesh，Three.js r160 会在物理更新时临时还原为原始尺度，动态骨骼
 * 会被写回错误坐标。因此画面适配只移动相机，不缩放物理网格。
 */

const CAMERA_FRAME_MARGIN = 1.12;
export const PMX_CAMERA_NEAR = 1;

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
        near: PMX_CAMERA_NEAR,
        far: distance + radius * 2
    };
}

export function normalizePmxProjectionNear(projectionMatrix, near = PMX_CAMERA_NEAR) {
    if (!Array.isArray(projectionMatrix) || projectionMatrix.length !== 16
        || projectionMatrix.some((value) => !Number.isFinite(value))) return null;
    const nextNear = Number.isFinite(near) && near > 0 ? near : PMX_CAMERA_NEAR;
    const matrix = [...projectionMatrix];
    const denominator = matrix[10] + 1;
    const projectedFar = Math.abs(denominator) > Number.EPSILON
        ? matrix[14] / denominator
        : Number.POSITIVE_INFINITY;
    const far = Number.isFinite(projectedFar) && projectedFar > nextNear
        ? projectedFar
        : Math.max(1000, nextNear + 1);
    matrix[10] = (far + nextNear) / (nextNear - far);
    matrix[14] = (2 * far * nextNear) / (nextNear - far);
    return { matrix, near: nextNear, far };
}
