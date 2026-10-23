import { Vector3 } from 'three';

export const DEFAULT_MARKER_DIAMETER = 32;
export function normalizeMarkerDiameter(value) {
    return Number.isFinite(value) ? Math.max(20, Math.min(48, value)) : DEFAULT_MARKER_DIAMETER;
}

// CSS屏幕像素与舞台逻辑像素共用尺寸；舞台旋转只交换方向，不引入设备像素比。
export function projectIKMarker(position, camera, rect, geometry, diameter = DEFAULT_MARKER_DIAMETER) {
    if (!camera || !rect?.width || !rect?.height) return null;
    const width = geometry?.logicalWidth || rect.width, height = geometry?.logicalHeight || rect.height;
    const view = position.clone().applyMatrix4(camera.matrixWorldInverse), ndc = position.clone().project(camera);
    const depth = camera.isPerspectiveCamera ? -view.z : 1;
    const visible = -view.z > 0 && ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    const radius = normalizeMarkerDiameter(diameter) / height / Math.abs(camera.projectionMatrix.elements[5]) * depth;
    const dx = ndc.x * width / 2, dy = -ndc.y * height / 2;
    const offsets = { 0: [dx, dy], 90: [-dy, dx], 180: [-dx, -dy], 270: [dy, -dx] };
    const offset = offsets[geometry?.rotation] || offsets[0];
    return { x: rect.left + rect.width / 2 + offset[0], y: rect.top + rect.height / 2 + offset[1],
        visible, radius: Number.isFinite(radius) && radius > 0 ? radius : 0 };
}

// 扩大命中区而不扩大遮挡；多个点重叠时以屏幕中心距离优先，深度只负责同距排序。
export function pickIKMarker(handles, point, camera, rect, geometry, diameter) {
    const radius = Math.max(44, normalizeMarkerDiameter(diameter)) / 2;
    const position = new Vector3(), candidates = [];
    for (const handle of handles) {
        handle.mesh.getWorldPosition(position);
        const screen = projectIKMarker(position, camera, rect, geometry, diameter);
        if (!screen?.visible) continue;
        const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
        if (distance <= radius) candidates.push({ object: handle.mesh, distance, depth: position.distanceToSquared(camera.position) });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.depth - b.depth);
    return candidates[0] || null;
}
