'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDataRepairRunner, writeJsonAtomically, sha256Buffer } = require('../../src/apps/server/modules/data-repair/data-repair-js-runner');

// 配置模块是按进程初始化的单例，必须在隔离子进程的 release 环境中加载。
// 将业务服务实际改变的字段合并回原输入，避免导入服务附带的默认值扩张污染种子。
function applyChanges(original, before, after) {
    const result = structuredClone(original || {});
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
        if (JSON.stringify(before?.[key]) === JSON.stringify(after?.[key])) continue;
        if (!Object.hasOwn(after || {}, key)) { delete result[key]; continue; }
        const value = after[key];
        result[key] = value && typeof value === 'object' && !Array.isArray(value)
            ? applyChanges(result[key], before?.[key], value) : value;
    }
    return result;
}

async function main() {
    const root = path.resolve(process.env.AASC_PROJECT_ROOT);
    const request = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    const configFile = path.join(root, 'release/config/config.json');
    // 对应.src/framework/qwen-api-data-repair.md：Provider保存在用户配置，必须与主配置一同回滚。
    const userConfigFile = path.join(root, 'release/userconfig/userconfig.json');
    const original = JSON.parse(await fs.readFile(configFile, 'utf8'));
    const config = require('../../src/apps/server/modules/config/config-app-service');
    const before = JSON.parse(JSON.stringify(config._data));
    let chat2api;
    if (request.repairs.some(item => item.metadata.capabilities.some(capability => capability.startsWith('chat2api.')))) {
        chat2api = require('../../src/apps/server/modules/chat2api/chat2api-runtime').createChat2ApiRuntime({
            rootDir: path.join(root, 'release/userconfig/chat2api'), projectRoot: root, restoreLegacyAccounts: false,
            legacyDataPath: path.join(root, 'home/.chat2api/data.json')
        });
    }
    try {
        for (const repair of request.repairs) {
            const script = path.join(root, 'repair.js');
            await fs.copyFile(repair.script, script);
            const bytes = await fs.readFile(script);
            if (sha256Buffer(bytes) !== repair.metadata.scriptSha256) throw new Error('种子修复脚本摘要不匹配');
            await writeJsonAtomically(path.join(root, 'data-repair/pending-repair.json'), {
                ...repair.metadata, format: 'aasc-offline-data-repair', schemaVersion: 1, script: 'repair.js'
            });
            const runner = createDataRepairRunner({ projectRoot: root, codeVersion: repair.metadata.requiredCodeVersion,
                apkVersionCode: repair.metadata.requiredApkVersionCode || 1,
                services: { config, chat2api: chat2api?.managementService }, managedFiles: [configFile, userConfigFile],
                logger: { info() {}, error() {} } });
            const result = await runner.applyPendingRepair();
            if (result.status !== 'applied' && result.status !== 'skipped') throw new Error(`release 修复未完成: ${result.status}`);
        }
        const after = JSON.parse(JSON.stringify(config._data));
        await writeJsonAtomically(configFile, applyChanges(original, before, after));
    } finally { await chat2api?.stop(); }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
