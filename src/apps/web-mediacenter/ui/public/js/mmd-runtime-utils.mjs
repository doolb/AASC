/* PMX 通用加载、资源释放和坐标辅助；不持有实例状态。 */
import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { normalizePmxPhysicsMesh } from './pmx-display-layout.mjs';

export const DEFAULT_AR_CAMERA_SETTINGS = Object.freeze({
    translationDeadZonePercent: 0.5,
    rotationDeadZoneDegrees: 0.5,
    smoothingMs: 120,
    distancePercent: 100,
    targetPlane: 'floor'
});

export const normalizeArCameraSettings = (input, previous = DEFAULT_AR_CAMERA_SETTINGS) => {
    const clampSetting = (name, minimum, maximum) => {
        const value = Number(input?.[name]);
        return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : previous[name];
    };
    return {
        translationDeadZonePercent: clampSetting('translationDeadZonePercent', 0, 3),
        rotationDeadZoneDegrees: clampSetting('rotationDeadZoneDegrees', 0, 3),
        smoothingMs: clampSetting('smoothingMs', 0, 500),
        distancePercent: clampSetting('distancePercent', 50, 100),
        targetPlane: ['floor', 'vertical'].includes(input?.targetPlane) ? input.targetPlane : previous.targetPlane
    };
};

export const classifyHit = (object) => {
    const name = String(object?.name || '').toLowerCase();
    if (/(head|face|eye|hair|髪|顔|頭)/u.test(name)) return 'head';
    if (/(hand|arm|finger|手|腕)/u.test(name)) return 'hand';
    if (/(body|chest|skirt|leg|foot|体|胸|脚)/u.test(name)) return 'body';
    return 'body';
};

const disposeMaterial = (material) => {
    if (!material) return;
    for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && value.isTexture) value.dispose();
    }
    material.dispose?.();
};

export const disposeObject = (root) => {
    root?.traverse?.((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) {
            object.material.forEach(disposeMaterial);
        } else {
            disposeMaterial(object.material);
        }
    });
};

export const waitForManagedLoad = (startLoad, label, onFileProgress = () => {}, onItemsProgress = () => {}) => new Promise((resolve, reject) => {
    const loadingManager = new THREE.LoadingManager();
    let result;
    let resultReady = false;
    let managerReady = false;
    let settled = false;

    const createError = (error) => {
        const normalized = error instanceof Error ? error : new Error(`${label}资源加载失败`);
        if (result !== undefined) normalized.partialResult = result;
        return normalized;
    };
    const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(createError(error));
    };
    const tryResolve = () => {
        if (!settled && managerReady && resultReady) {
            settled = true;
            resolve(result);
        }
    };

    loadingManager.onLoad = () => {
        managerReady = true;
        tryResolve();
    };
    loadingManager.onProgress = (url, loaded, total) => onItemsProgress(url, loaded, total);
    loadingManager.onError = (url) => fail(new Error(`${label}资源加载失败：${url}`));

    try {
        const loader = new MMDLoader(loadingManager);
        startLoad(loader, (value) => {
            result = value;
            resultReady = true;
            tryResolve();
        }, fail, onFileProgress);
    } catch (error) {
        fail(error);
    }
});

export const normalizeModel = (mesh) => {
    return normalizePmxPhysicsMesh(mesh, THREE);
};

export function createModelRotationPivot(model) {
    const pivot = new THREE.Group();
    if (!model?.isObject3D) return pivot;
    const bounds = new THREE.Box3().setFromObject(model);
    if (!bounds.isEmpty()) {
        pivot.position.copy(bounds.getCenter(new THREE.Vector3()));
    }
    // attach 保持模型当前世界变换，使贴地、骨骼动画和资源自身姿态不被枢轴改变。
    pivot.updateWorldMatrix(true, false);
    model.updateWorldMatrix(true, false);
    pivot.attach(model);
    return pivot;
}
