/** 释放并置空两类阴影目标；Three r160仅在map为null时按新尺寸重新创建。 */
export function releaseShadowTargets(shadow) {
    const targets = new Set([shadow.map, shadow.mapPass]);
    shadow.map = null;
    shadow.mapPass = null;
    for (const target of targets) target?.dispose();
}

/**
 * 将方向光正交投影的世界网格对齐ShadowMap像素；不移动光或目标，光照方向保持。
 * 每次先还原等宽高的居中边界，再从固定世界原点计算补偿，偏移不超过半个像素。
 * 若沿用上一帧已偏移的边界，连续小位移会累计抵消相机跟随，因而必须从基准重算。
 * 向量在创建时分配一次；更新真实Three阴影矩阵，使后续阴影裁剪与投影保持一致。
 */
export function createShadowCameraAlignment(THREE) {
    const origin = new THREE.Vector3();
    return (light) => {
        const shadow = light.shadow;
        const camera = shadow.camera;
        const width = shadow.map?.width || shadow.mapSize.x;
        const height = shadow.map?.height || shadow.mapSize.y;
        const spanX = camera.right - camera.left;
        const spanY = camera.top - camera.bottom;
        if (![width, height, spanX, spanY].every(value => Number.isFinite(value) && value > 0)) return false;
        camera.left = -spanX / 2; camera.right = spanX / 2;
        camera.bottom = -spanY / 2; camera.top = spanY / 2;
        camera.updateProjectionMatrix();
        light.updateWorldMatrix(true, false);
        light.target.updateWorldMatrix(true, false);
        shadow.updateMatrices(light);
        origin.set(0, 0, 0).project(camera);
        const pixelX = (origin.x * 0.5 + 0.5) * width;
        const pixelY = (origin.y * 0.5 + 0.5) * height;
        const offsetX = -(Math.round(pixelX) - pixelX) * spanX / width;
        const offsetY = -(Math.round(pixelY) - pixelY) * spanY / height;
        camera.left += offsetX; camera.right += offsetX;
        camera.bottom += offsetY; camera.top += offsetY;
        camera.updateProjectionMatrix();
        shadow.updateMatrices(light);
        shadow.needsUpdate = true;
        return true;
    };
}
