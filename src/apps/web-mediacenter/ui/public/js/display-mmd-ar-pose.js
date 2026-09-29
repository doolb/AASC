/* 图片定位姿态到 Three.js 模型脚底的屏幕映射，两种运行时共用。 */
import * as THREE from 'three';

export function createArFootAnchor({ camera, getModelRoot, getViewport, startRendering }) {
    let activeRoot = null;
    let basePosition = null;
    let baseScale = null;
    let posePosition = null;
    let manualOffset = new THREE.Vector3();
    function ensureRoot(root) {
        if (root === activeRoot) return;
        activeRoot = root;
        basePosition = root.position.clone();
        baseScale = root.scale.clone();
        posePosition = basePosition.clone();
        manualOffset = new THREE.Vector3();
    }

    function setPose(pose, calibration = {}) {
        const root = getModelRoot();
        if (!root || !pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return false;
        const viewport = getViewport();
        if (!viewport?.width || !viewport?.height) return false;
        ensureRoot(root);
        const requestedScale = Math.max(0.2, Math.min(3, Number(pose.scale) || 1));
        const calibrationScale = Math.max(0.1, Math.min(10, Number(calibration.scale) || 1));
        const nextScale = requestedScale * calibrationScale;
        // 外层枢轴承载 AR 自动定位，骨骼、物理和用户拖动旋转继续在原运行时更新。
        root.position.copy(posePosition);
        root.scale.lerp(baseScale.clone().multiplyScalar(nextScale), 0.3);
        root.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(root);
        if (bounds.isEmpty()) return false;
        const foot = new THREE.Vector3(
            (bounds.min.x + bounds.max.x) / 2,
            bounds.min.y,
            (bounds.min.z + bounds.max.z) / 2
        );
        const projected = foot.clone().project(camera);
        const offset = calibration.offset || {};
        const x = Math.max(0, Math.min(1, pose.x + (Number(offset.x) || 0)));
        const y = Math.max(0, Math.min(1, pose.y + (Number(offset.y) || 0)));
        const target = new THREE.Vector3(x * 2 - 1, 1 - y * 2, projected.z).unproject(camera);
        posePosition.add(target.sub(foot).multiplyScalar(0.35));
        root.position.copy(posePosition).add(manualOffset);
        startRendering();
        return true;
    }

    function translateBy(worldDelta) {
        const root = getModelRoot();
        if (!root || !worldDelta?.isVector3
            || ![worldDelta.x, worldDelta.y, worldDelta.z].every(Number.isFinite)) return false;
        ensureRoot(root);
        if (worldDelta.lengthSq() < Number.EPSILON) return false;
        manualOffset.add(worldDelta);
        root.position.copy(posePosition).add(manualOffset);
        root.updateWorldMatrix(true, true);
        startRendering();
        return true;
    }

    function translateByPixels(deltaX, deltaY) {
        const x = Number(deltaX);
        const y = Number(deltaY);
        const viewportHeight = Number(getViewport()?.height);
        const root = getModelRoot();
        if (!root || ![x, y, viewportHeight].every(Number.isFinite) || viewportHeight <= 0
            || (Math.abs(x) < Number.EPSILON && Math.abs(y) < Number.EPSILON)) return false;
        ensureRoot(root);
        camera.updateMatrixWorld(true);
        root.updateWorldMatrix(true, true);
        const rootWorldPosition = root.getWorldPosition(new THREE.Vector3());
        const cameraWorldPosition = camera.getWorldPosition(new THREE.Vector3());
        const depth = cameraWorldPosition.distanceTo(rootWorldPosition);
        const focalY = Math.abs(camera.projectionMatrix.elements[5]);
        if (!Number.isFinite(depth) || depth <= 0 || !Number.isFinite(focalY) || focalY <= 0) return false;
        const worldPerPixel = (2 * depth) / (focalY * viewportHeight);
        const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion);
        const worldDelta = right.multiplyScalar(x * worldPerPixel)
            .addScaledVector(up, -y * worldPerPixel);
        return translateBy(worldDelta);
    }

    function reset() {
        const root = getModelRoot();
        if (root && root === activeRoot && basePosition && baseScale) {
            root.position.copy(basePosition);
            root.scale.copy(baseScale);
            startRendering();
        }
        activeRoot = null;
        basePosition = null;
        baseScale = null;
        posePosition = null;
        manualOffset.set(0, 0, 0);
    }

    return Object.freeze({ reset, setPose, translateBy, translateByPixels });
}
