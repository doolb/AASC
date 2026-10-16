'use strict';
const FORMAT = 'aasc-offline-data-baseline';
const BASELINE_FILE = 'config/data-repair-state.json';
// 与已有数据修复基线保持相同字段校验，引导时不加载业务runner。
function validateBaseline(value) {
    if (Buffer.byteLength(JSON.stringify(value, null, 2) || '') > 64 * 1024) throw new Error('release 数据基线超过大小限制');
    if (value?.format !== FORMAT || value.schemaVersion !== 1
        || !Number.isSafeInteger(value.dataVersion) || value.dataVersion < 0
        || !Number.isSafeInteger(value.latestRepairVersion) || value.latestRepairVersion < 0
        || !Array.isArray(value.includedRepairs) || value.includedRepairs.length > 256
        || !Array.isArray(value.files) || value.files.length > 256) throw new Error('release 数据基线无效');
    const ids = new Set();
    for (const item of value.includedRepairs) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(item?.repairId || '') || ids.has(item.repairId)
            || !Number.isSafeInteger(item.repairVersion) || item.repairVersion < 1 || item.repairVersion > value.latestRepairVersion
            || !Number.isSafeInteger(item.targetDataVersion) || item.targetDataVersion < 0 || item.targetDataVersion > value.dataVersion
            || !/^[a-f0-9]{64}$/u.test(item.scriptSha256 || '')) throw new Error('release 修复记录无效');
        ids.add(item.repairId);
    }
    const names = new Set();
    for (const file of value.files) {
        if (typeof file.path !== 'string' || !/^(?:config|userconfig)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(file.path)
            || file.path.split('/').some(part => !part || part === '.' || part === '..')
            || file.path === BASELINE_FILE || names.has(file.path)
            || !Number.isSafeInteger(file.size) || file.size < 1 || !/^[a-f0-9]{64}$/u.test(file.sha256 || '')) {
            throw new Error('release 基线文件声明无效');
        }
        names.add(file.path);
    }
    if (!names.has('config/config.json')) throw new Error('release 基线缺少配置摘要');
    return value;
}


module.exports = { validateBaseline };
