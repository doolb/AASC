import { createRequire } from 'node:module';
let runtimePromise;
// 该包的主入口是 CommonJS + Emscripten Promise。ESM 默认导入在 Vitest 中会
// 变成带有 Promise.prototype.then 的命名空间包装对象，使用 createRequire 可
// 直接取得真实的 Emscripten Promise。
const require = createRequire(import.meta.url);
const cvModule = require('@techstark/opencv-js');
const isPromiseLike = (value) => (typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function');
const initializeOpenCv = async () => {
    const module = cvModule;
    if (isPromiseLike(module)) {
        return await module;
    }
    if (typeof module.Mat === 'function') {
        return module;
    }
    return await new Promise((resolve, reject) => {
        try {
            const previousHandler = module.onRuntimeInitialized;
            module.onRuntimeInitialized = () => {
                previousHandler?.();
                resolve(module);
            };
        }
        catch (error) {
            reject(new Error('failed to initialize OpenCV.js runtime', { cause: error }));
        }
    });
};
/** 返回共享的 OpenCV.js WASM 运行时，避免每个模板重复初始化。 */
export const getOpenCv = async () => {
    runtimePromise ??= initializeOpenCv();
    return await runtimePromise;
};
