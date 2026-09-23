/*
 * PMX 物理解算的 Ammo.js 同源加载器。
 *
 * Ammo 以传统脚本暴露工厂函数，MMDPhysics 则从全局作用域读取已初始化模块。
 * 此处将脚本加载和 WASM 初始化集中为单例，避免同页的模型切换重复分配 Ammo 内存。
 */

export const AMMO_SCRIPT_URL = '/js/vendor/three/libs/ammo.wasm.js';
export const AMMO_WASM_URL = '/js/vendor/three/libs/ammo.wasm.wasm';

let ammoLoadPromise = null;

const isAmmoModule = (candidate) => typeof candidate?.btVector3 === 'function';

const getBrowserDocument = () => {
    const documentRef = globalThis.document;
    if (!documentRef?.head || typeof documentRef.createElement !== 'function') {
        throw new Error('当前环境不能加载 PMX 物理脚本');
    }
    return documentRef;
};

const loadAmmoScript = () => new Promise((resolve, reject) => {
    let documentRef;
    try {
        documentRef = getBrowserDocument();
    } catch (error) {
        reject(error);
        return;
    }
    const existing = documentRef.querySelector('script[data-aasc-ammo="true"]');
    if (existing) {
        resolve();
        return;
    }
    const script = documentRef.createElement('script');
    script.src = AMMO_SCRIPT_URL;
    script.async = true;
    script.dataset.aascAmmo = 'true';
    script.onload = resolve;
    script.onerror = () => {
        script.remove?.();
        reject(new Error('Ammo 物理脚本加载失败'));
    };
    documentRef.head.append(script);
});

export async function ensureAmmoPhysics() {
    if (isAmmoModule(globalThis.Ammo)) return globalThis.Ammo;
    if (!ammoLoadPromise) {
        ammoLoadPromise = loadAmmoScript()
            .then(() => {
                const factory = globalThis.Ammo;
                if (typeof factory !== 'function') throw new Error('Ammo 物理工厂不可用');
                return factory({ locateFile: () => AMMO_WASM_URL });
            })
            .then((ammo) => {
                if (!isAmmoModule(ammo)) throw new Error('Ammo 物理模块初始化失败');
                globalThis.Ammo = ammo;
                return ammo;
            })
            .catch((error) => {
                ammoLoadPromise = null;
                throw error;
            });
    }
    return ammoLoadPromise;
}

export const hasMmdPhysics = (mesh) => {
    const rigidBodies = mesh?.geometry?.userData?.MMD?.rigidBodies;
    return Array.isArray(rigidBodies) && rigidBodies.length > 0;
};
