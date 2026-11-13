import { createRequire } from 'node:module';

let runtimePromise;
const require = createRequire(import.meta.url);
const cvModule = require('@techstark/opencv-js');

const isPromiseLike = (value) => (
  value !== null && typeof value === 'object'
    && typeof value.then === 'function'
);

const initializeOpenCv = async () => {
  if (isPromiseLike(cvModule)) return await cvModule;
  if (typeof cvModule.Mat === 'function') return cvModule;
  return await new Promise((resolve, reject) => {
    try {
      const previousHandler = cvModule.onRuntimeInitialized;
      cvModule.onRuntimeInitialized = () => {
        previousHandler?.();
        resolve(cvModule);
      };
    } catch (error) {
      reject(new Error('failed to initialize OpenCV.js runtime', { cause: error }));
    }
  });
};

/** Return the shared precompiled OpenCV.js runtime. */
export const getOpenCv = async () => {
  runtimePromise ??= initializeOpenCv();
  return await runtimePromise;
};
