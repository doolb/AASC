import { createRequire } from 'node:module';
import type { CV } from '@techstark/opencv-js';

export type OpenCvApi = CV & {
  onRuntimeInitialized?: () => void;
};

let runtimePromise: Promise<OpenCvApi> | undefined;

// 该包的主入口是 CommonJS + Emscripten Promise。ESM 默认导入在 Vitest 中会
// 变成带有 Promise.prototype.then 的命名空间包装对象，使用 createRequire 可
// 直接取得真实的 Emscripten Promise。
const require = createRequire(import.meta.url);
const cvModule = require('@techstark/opencv-js') as OpenCvApi | PromiseLike<OpenCvApi>;

const isPromiseLike = (value: unknown): value is PromiseLike<OpenCvApi> => (
  typeof value === 'object'
  && value !== null
  && 'then' in value
  && typeof value.then === 'function'
);

const initializeOpenCv = async (): Promise<OpenCvApi> => {
  const module = cvModule;

  if (isPromiseLike(module)) {
    return await module;
  }

  if (typeof module.Mat === 'function') {
    return module;
  }

  return await new Promise<OpenCvApi>((resolve, reject) => {
    try {
      const previousHandler = module.onRuntimeInitialized;
      module.onRuntimeInitialized = () => {
        previousHandler?.();
        resolve(module);
      };
    } catch (error: unknown) {
      reject(new Error('failed to initialize OpenCV.js runtime', { cause: error }));
    }
  });
};

/** 返回共享的 OpenCV.js WASM 运行时，避免每个模板重复初始化。 */
export const getOpenCv = async (): Promise<OpenCvApi> => {
  runtimePromise ??= initializeOpenCv();
  return await runtimePromise;
};
