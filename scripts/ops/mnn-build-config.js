'use strict';

const path = require('node:path');

const DEFAULT_MNN_REVISION = 'd407447ed56c4121a11ccbd266dc184ca1ead0c2';

/**
 * 解析 Android MNN native 构建的唯一默认配置。
 *
 * prepare 脚本、APK 编排脚本和 Gradle 入口必须使用同一组 root/revision，
 * 避免准备阶段找得到 MNN、Gradle 阶段却因为当前 shell 没有环境变量而失败。
 */
function resolveMnnBuildConfig(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const environment = options.environment || process.env;
    const configuredRoot = String(
        environment.AASC_MNN_ROOT || path.join(projectRoot, 'build', 'third_party', 'MNN')
    ).trim();
    const configuredRevision = String(
        environment.AASC_MNN_REVISION || DEFAULT_MNN_REVISION
    ).trim();
    return {
        root: path.resolve(configuredRoot),
        revision: configuredRevision
    };
}

module.exports = {
    DEFAULT_MNN_REVISION,
    resolveMnnBuildConfig
};
