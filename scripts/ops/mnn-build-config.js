'use strict';

const path = require('node:path');

const DEFAULT_MNN_REVISION = 'd407447ed56c4121a11ccbd266dc184ca1ead0c2';
const MNN_LIBRARY_RELATIVE_PATH = 'project/android/build_64/lib/libMNN.so';
const MNN_PACKAGE_DIRECTORIES = [
    'include',
    'transformers/llm/engine/include',
    'tools/audio/include',
    'tools/cv/include',
    '3rd_party',
    'apps/Android/MnnLlmChat/app/src/main/cpp'
];
const MNN_PACKAGE_SOURCE_FILES = [
    'apps/Android/MnnLlmChat/app/src/main/cpp/llm_session.cpp',
    'apps/Android/MnnLlmChat/app/src/main/cpp/processor.cpp',
    'apps/Android/MnnLlmChat/app/src/main/cpp/video/video_decoder.cpp',
    'apps/Android/MnnLlmChat/app/src/main/cpp/video/byte_buffer_decoder.cpp',
    'apps/Android/MnnLlmChat/app/src/main/cpp/video/image_utils.cpp',
    'apps/Android/MnnLlmChat/app/src/main/cpp/video/video_processor.cpp'
];
const MNN_BUILD_OPTIONS = [
    '-DMNN_LOW_MEMORY=true',
    '-DMNN_CPU_WEIGHT_DEQUANT_GEMM=true',
    '-DMNN_BUILD_LLM=true',
    '-DMNN_SUPPORT_TRANSFORMER_FUSE=true',
    '-DMNN_ARM82=true',
    '-DMNN_USE_LOGCAT=true',
    '-DMNN_OPENCL=true',
    '-DLLM_SUPPORT_VISION=true',
    '-DMNN_BUILD_OPENCV=true',
    '-DMNN_IMGCODECS=true',
    '-DLLM_SUPPORT_AUDIO=true',
    '-DMNN_BUILD_AUDIO=true',
    '-DMNN_SEP_BUILD=OFF',
    '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384',
    '-DCMAKE_INSTALL_PREFIX=.'
];

/**
 * 解析 Android MNN native 构建的唯一默认配置。
 *
 * prepare 脚本、APK 编排脚本和 Gradle 入口必须使用同一组 root/revision，
 * 默认指向 Git 内置预编译包，源码构建模式使用本机缓存目录。
 */
function resolveMnnBuildConfig(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const environment = options.environment || process.env;
    const configuredRevision = String(
        environment.AASC_MNN_REVISION || DEFAULT_MNN_REVISION
    ).trim();
    const mode = options.mode || 'prebuilt';
    const defaultRoot = mode === 'source'
        ? path.join(projectRoot, 'build', 'third_party', 'MNN')
        : path.join(projectRoot, '3rd', 'android-mnnllm-prebuilt', configuredRevision);
    const configuredRoot = String(environment.AASC_MNN_ROOT || defaultRoot).trim();
    return {
        root: path.resolve(configuredRoot),
        revision: configuredRevision,
        mode
    };
}

module.exports = {
    DEFAULT_MNN_REVISION,
    MNN_BUILD_OPTIONS,
    MNN_LIBRARY_RELATIVE_PATH,
    MNN_PACKAGE_DIRECTORIES,
    MNN_PACKAGE_SOURCE_FILES,
    resolveMnnBuildConfig
};
