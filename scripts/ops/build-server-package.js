'use strict';

const path = require('node:path');
const { ServerReleaseService } = require('../../src/apps/server/modules/aasc/server-release-service');

async function main() {
    const projectRoot = path.resolve(__dirname, '../..');
    const service = new ServerReleaseService({ projectRoot });
    const packageInfo = await service.buildPackage();

    process.stdout.write([
        '共享发布文件已校验',
        `文件: ${packageInfo.filePath}`,
        `版本: ${packageInfo.manifest.payload.components.code.version}`,
        `大小: ${packageInfo.size} bytes`,
        `SHA-256: ${packageInfo.sha256}`
    ].join('\n') + '\n');
}

main().catch(error => {
    console.error(`生成服务器发布包失败: ${error.message}`);
    process.exitCode = 1;
});
