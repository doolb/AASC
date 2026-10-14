'use strict';

// 当前 Android Runtime 为 arm64 Node v26.4.0；运行契约随原生兼容能力变更递增。
const RUNTIME_COMPATIBILITY = Object.freeze({ abi: 'arm64-v8a', nodeMajor: 26, contractVersion: 1 });
function validateRuntimeCompatibility(value) {
    if (!value || typeof value !== 'object' || value.abi !== 'arm64-v8a'
        || !Number.isSafeInteger(value.nodeMajor) || value.nodeMajor < 1
        || !Number.isSafeInteger(value.contractVersion) || value.contractVersion < 1) {
        throw new Error('Offline 原生运行兼容契约无效');
    }
    return value;
}
module.exports = { RUNTIME_COMPATIBILITY, validateRuntimeCompatibility };
