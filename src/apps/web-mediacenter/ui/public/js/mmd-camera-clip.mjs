/* PMX 相机裁剪：缓存模型局部边界，镜头变化时只同步深度投影。 */
export function createPmxCameraClip(THREE, camera) {
    const sphere = new THREE.Sphere();
    const worldCenter = new THREE.Vector3();
    const inverseRoot = new THREE.Matrix4();
    let modelRoot = null;
    let previewFar = camera.far;
    let ready = false;

    // 包围盒只在模型适配时计算；转换为局部球后可跟随根平移、旋转和缩放。
    const fit = (root, bounds, far) => {
        modelRoot = root?.isObject3D ? root : null;
        previewFar = far;
        if (modelRoot) {
            modelRoot.updateWorldMatrix(true, false);
            inverseRoot.copy(modelRoot.matrixWorld).invert();
            bounds.clone().applyMatrix4(inverseRoot).getBoundingSphere(sphere);
        } else {
            bounds.getBoundingSphere(sphere);
        }
        ready = !sphere.isEmpty();
    };

    const sync = (baseFar = previewFar) => {
        if (!ready) return false;
        worldCenter.copy(sphere.center);
        let radius = sphere.radius;
        if (modelRoot) {
            modelRoot.updateWorldMatrix(true, false);
            worldCenter.applyMatrix4(modelRoot.matrixWorld);
            radius *= modelRoot.matrixWorld.getMaxScaleOnAxis();
        }
        const far = Math.max(baseFar, camera.near + 1,
            camera.position.distanceTo(worldCenter) + radius * 2);
        if (!Number.isFinite(far)) return false;
        // 微小浮点误差不触发静止相机逐帧求逆；收到新AR投影时仍核对深度系数。
        const stableFar = Math.abs(far - camera.far) <= Math.max(1, far) * 1e-10
            ? camera.far : far;
        const depthScale = (stableFar + camera.near) / (camera.near - stableFar);
        const depthOffset = (2 * stableFar * camera.near) / (camera.near - stableFar);
        const elements = camera.projectionMatrix.elements;
        if (camera.far === stableFar && elements[10] === depthScale && elements[14] === depthOffset) return false;
        camera.far = stableFar;
        // 只改透视深度系数，不能用updateProjectionMatrix覆盖AR的裁切和偏心构图。
        elements[10] = depthScale;
        elements[14] = depthOffset;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        return true;
    };

    return Object.freeze({ fit, sync });
}
