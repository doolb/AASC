/* PMX 运行时模块：状态由主实例访问器持有，资源不复制。 */
export function createPmxArCamera(context) {
    const { THREE, applyCameraView, arCameraState, arFootAnchor, camera, canvas, fitCameraToModel, getArCameraTargetCenter, getModelBounds, normalizeArCameraSettings, normalizePmxProjectionNear, startRendering } = context;
/* aasc-module-body-begin */
    const resetArCameraPose = () => {
        arFootAnchor.reset();
        if (!arCameraState.active) {
            context.cameraZoomFactor = 1;
            applyCameraView();
            startRendering();
            return;
        }
        if (context.currentRotationPivot) context.currentRotationPivot.visible = arCameraState.savedVisible;
        arCameraState.active = false;
        arCameraState.savedVisible = null;
        arCameraState.targetPosition = null;
        arCameraState.targetWidth = 1;
        arCameraState.trackingLost = false;
        arCameraState.lastPose = null;
        camera.matrixAutoUpdate = true;
        camera.fov = 28;
        camera.aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
        fitCameraToModel(context.currentRotationPivot || context.currentMesh);
        startRendering();
    };

    const resetArPose = () => {
        arFootAnchor.reset();
        context.cameraZoomFactor = 1;
        if (!arCameraState.active) applyCameraView();
        startRendering();
    };

    const suspendArCameraPose = () => {
        if (!arCameraState.active) return;
        // 失锁时连未完成的缓动也暂停，保持用户当时看到的画面。
        arCameraState.trackingLost = true;
        arCameraState.acceptedPosition.copy(camera.position);
        const targetCenter = getArCameraTargetCenter(arCameraState.lastPose?.targetAspect || 1);
        if (targetCenter) {
            arCameraState.acceptedBasePosition.copy(camera.position).sub(targetCenter)
                .multiplyScalar(context.cameraZoomFactor).add(targetCenter);
        }
        arCameraState.acceptedQuaternion.copy(camera.quaternion);
        startRendering();
    };

    const setArCameraSettings = (input) => {
        if ((!window.MmdArAframeMode && !window.MmdArTestAframeMode) || !input || typeof input !== 'object') return false;
        const oldDistance = arCameraState.settings.distancePercent;
        const oldPlane = arCameraState.settings.targetPlane;
        arCameraState.settings = normalizeArCameraSettings(input, arCameraState.settings);
        // 距离和定位面变化时重算相机；切换底面/立面立即对齐，避免跨平面的缓动偏离。
        if (arCameraState.active && !arCameraState.trackingLost
            && (oldDistance !== arCameraState.settings.distancePercent
                || oldPlane !== arCameraState.settings.targetPlane) && arCameraState.lastPose) {
            if (setArCameraPose(arCameraState.lastPose) && oldPlane !== arCameraState.settings.targetPlane) {
                camera.position.copy(arCameraState.acceptedPosition);
                camera.quaternion.copy(arCameraState.acceptedQuaternion);
                camera.updateMatrix();
                camera.updateMatrixWorld(true);
            }
        }
        return { ...arCameraState.settings };
    };

    const setArCameraPose = ({ anchorMatrix, projectionMatrix, targetAspect } = {}) => {
        if ((!window.MmdArAframeMode && !window.MmdArTestAframeMode) || !context.currentRotationPivot
            || !Array.isArray(anchorMatrix) || anchorMatrix.length !== 16
            || !Array.isArray(projectionMatrix) || projectionMatrix.length !== 16
            || [...anchorMatrix, ...projectionMatrix].some((value) => !Number.isFinite(value))) return false;
        const fixedProjection = normalizePmxProjectionNear(projectionMatrix);
        if (!fixedProjection) return false;
        const targetToCamera = new THREE.Matrix4().fromArray(anchorMatrix);
        if (Math.abs(targetToCamera.determinant()) < 1e-8) return false;
        const firstLock = !arCameraState.active;
        const anchorPosition = new THREE.Vector3();
        const anchorQuaternion = new THREE.Quaternion();
        const anchorScale = new THREE.Vector3();
        targetToCamera.decompose(anchorPosition, anchorQuaternion, anchorScale);
        if (firstLock) {
            arCameraState.acceptedAnchorPosition.copy(anchorPosition);
            arCameraState.acceptedAnchorQuaternion.copy(anchorQuaternion);
        } else {
            // 死区判断直接使用 MindAR 的定位图位姿，避免距离设置放大相机位移后误判抖动。
            const translationThreshold = arCameraState.settings.translationDeadZonePercent / 100;
            const translation = arCameraState.acceptedAnchorPosition.distanceTo(anchorPosition);
            if (translation > translationThreshold) {
                arCameraState.acceptedAnchorPosition.lerp(anchorPosition,
                    (translation - translationThreshold) / translation);
            }
            const rotationThreshold = THREE.MathUtils.degToRad(arCameraState.settings.rotationDeadZoneDegrees);
            const rotation = arCameraState.acceptedAnchorQuaternion.angleTo(anchorQuaternion);
            if (rotation > rotationThreshold) {
                arCameraState.acceptedAnchorQuaternion.slerp(anchorQuaternion,
                    (rotation - rotationThreshold) / rotation);
            }
        }
        targetToCamera.compose(arCameraState.acceptedAnchorPosition,
            arCameraState.acceptedAnchorQuaternion, anchorScale);
        if (firstLock) {
            // 图面映射到现有角色脚底；只改变相机，避免改写 PMX 根节点和 Bullet 刚体的世界变换。
            const bounds = getModelBounds(context.currentRotationPivot);
            const modelHeight = Math.max(0.001, bounds.max.y - bounds.min.y);
            const center = bounds.getCenter(new THREE.Vector3());
            arCameraState.savedVisible = context.currentRotationPivot.visible;
            arCameraState.targetPosition = new THREE.Vector3(center.x, bounds.min.y, center.z);
            arCameraState.targetWidth = modelHeight / 1.5;
            arCameraState.active = true;
        }
        context.currentRotationPivot.visible = true;
        const aspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 1;
        const isVertical = arCameraState.settings.targetPlane === 'vertical';
        // 立面时图的下边缘中点落在脚底；底面仍将图中心落在脚底。
        const targetCenter = arCameraState.targetPosition.clone();
        if (isVertical) targetCenter.y += arCameraState.targetWidth * aspect / 2;
        const targetWorld = new THREE.Matrix4().makeTranslation(...targetCenter.toArray())
            .multiply(new THREE.Matrix4().makeRotationX(isVertical ? 0 : -Math.PI / 2))
            .multiply(new THREE.Matrix4().makeScale(arCameraState.targetWidth, arCameraState.targetWidth, arCameraState.targetWidth));
        const cameraWorld = targetWorld.multiply(targetToCamera.invert());
        camera.matrixAutoUpdate = false;
        const cameraScale = new THREE.Vector3();
        const nextPosition = new THREE.Vector3();
        const nextQuaternion = new THREE.Quaternion();
        cameraWorld.decompose(nextPosition, nextQuaternion, cameraScale);
        // 沿相机与定位图中心的连线拉近；模型根节点与目标跟踪旋转保持不变。
        nextPosition.sub(targetCenter)
            .multiplyScalar(arCameraState.settings.distancePercent / 100)
            .add(targetCenter);
        arCameraState.acceptedBasePosition.copy(nextPosition);
        nextPosition.sub(targetCenter).multiplyScalar(1 / context.cameraZoomFactor).add(targetCenter);
        if (firstLock) {
            camera.position.copy(nextPosition);
            camera.quaternion.copy(nextQuaternion);
            arCameraState.acceptedPosition.copy(nextPosition);
            arCameraState.acceptedQuaternion.copy(nextQuaternion);
        } else {
            // 相机姿态只由已接受的定位图位姿换算；距离滑条不参与死区判断。
            arCameraState.acceptedPosition.copy(nextPosition);
            arCameraState.acceptedQuaternion.copy(nextQuaternion);
        }
        arCameraState.trackingLost = false;
        arCameraState.lastPose = {
            anchorMatrix: [...anchorMatrix],
            projectionMatrix: fixedProjection.matrix,
            targetAspect: aspect
        };
        camera.scale.set(1, 1, 1);
        if (firstLock || arCameraState.settings.smoothingMs <= 0) {
            camera.position.copy(arCameraState.acceptedPosition);
            camera.quaternion.copy(arCameraState.acceptedQuaternion);
            camera.updateMatrix();
            camera.updateMatrixWorld(true);
        }
        camera.near = fixedProjection.near;
        camera.far = fixedProjection.far;
        camera.projectionMatrix.fromArray(fixedProjection.matrix);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        startRendering();
        return true;
    };

/* aasc-module-body-end */
    return { resetArCameraPose, resetArPose, suspendArCameraPose, setArCameraSettings, setArCameraPose };
}
