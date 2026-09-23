/* 图片定位姿态到 Three.js 模型脚底的屏幕映射，两种运行时共用。 */
import * as THREE from 'three';

export function createArFootAnchor({ camera, getModelRoot, getViewport, startRendering }) {
    let basePosition = null;
    let baseScale = null;

    function setPose(pose, calibration = {}) {
        const root = getModelRoot();
        if (!root || !pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return false;
        const viewport = getViewport();
        if (!viewport?.width || !viewport?.height) return false;
        if (!basePosition) {
            basePosition = root.position.clone();
            baseScale = root.scale.clone();
        }
        const requestedScale = Math.max(0.2, Math.min(3, Number(pose.scale) || 1));
        const calibrationScale = Math.max(0.1, Math.min(10, Number(calibration.scale) || 1));
        const nextScale = requestedScale * calibrationScale;
        // 外层枢轴承载 AR 位移和尺度；骨骼、物理和用户拖动旋转继续在原运行时更新。
        // 每次先用当前模型包围盒求脚底投影，再把这个投影向图片中心移动。
        // 不能把模型中心直接放到目标点，否则脚会悬空半个身高。
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
        root.position.add(target.sub(foot).multiplyScalar(0.35));
        startRendering();
        return true;
    }

    function reset() {
        const root = getModelRoot();
        if (root && basePosition && baseScale) {
            root.position.copy(basePosition);
            root.scale.copy(baseScale);
            startRendering();
        }
        basePosition = null;
        baseScale = null;
    }

    return Object.freeze({ reset, setPose });
}
