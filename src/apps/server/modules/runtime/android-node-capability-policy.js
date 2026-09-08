'use strict';

const ANDROID_NODE_CAPABILITIES = Object.freeze({
    mediaLibrary: true,
    displayGateway: true,
    hotUpdate: true
});

const ANDROID_NODE_DISABLED_FEATURES = Object.freeze([
    'asr',
    'tts',
    'puppeteer',
    'externalCli',
    'taskRuntime'
]);

function isAndroidNode(environment = process.env) {
    return environment?.AASC_ANDROID_NODE === '1';
}

function getAndroidNodePolicy(environment = process.env) {
    if (!isAndroidNode(environment)) {
        return {
            enabled: false,
            capabilities: null,
            disabledFeatures: []
        };
    }

    return {
        enabled: true,
        capabilities: { ...ANDROID_NODE_CAPABILITIES },
        disabledFeatures: [...ANDROID_NODE_DISABLED_FEATURES]
    };
}

function createAndroidCapabilityUnavailableError(feature) {
    const normalizedFeature = String(feature || 'unknown').trim() || 'unknown';
    const error = new Error(`Android APK 节点不支持能力: ${normalizedFeature}`);
    error.code = 'androidCapabilityUnavailable';
    error.feature = normalizedFeature;
    return error;
}

module.exports = {
    ANDROID_NODE_CAPABILITIES,
    ANDROID_NODE_DISABLED_FEATURES,
    createAndroidCapabilityUnavailableError,
    getAndroidNodePolicy,
    isAndroidNode
};
