'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { sha256Buffer, normalizeState, writeJsonAtomically } = require('./data-repair-js-runner');
const BASELINE_FILE = 'config/data-repair-state.json';
const FORMAT = 'aasc-offline-data-baseline';

// 基线只描述经过真实脚本校验的发行配置，不以 APK 或服务版本推断数据版本。
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

async function readBaseline(releaseRoot) {
    try {
        const file = path.join(releaseRoot, BASELINE_FILE);
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error('release 基线文件类型或大小无效');
        return validateBaseline(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function verifyBaselineFiles(releaseRoot, baseline) {
    releaseRoot = path.resolve(releaseRoot);
    validateBaseline(baseline);
    for (const entry of baseline.files) {
        const file = path.join(releaseRoot, entry.path);
        let ancestor = file;
        while (ancestor !== path.resolve(releaseRoot)) {
            if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('release 基线目标不能是链接');
            ancestor = path.dirname(ancestor);
        }
        const bytes = await fs.readFile(file);
        if (bytes.length !== entry.size || sha256Buffer(bytes) !== entry.sha256) throw new Error(`release 基线与配置不一致: ${entry.path}`);
    }
}

async function initializeReleaseBaseline(projectRoot, releaseRoot, freshConfiguration) {
    if (!freshConfiguration) return false;
    const stateFile = path.join(projectRoot, 'data-repair/state.json');
    if (await fs.lstat(stateFile).catch(error => { if (error.code !== 'ENOENT') throw error; return null; })) return false;
    const baseline = await readBaseline(releaseRoot);
    if (!baseline) return false;
    await verifyBaselineFiles(releaseRoot, baseline);
    await writeJsonAtomically(stateFile, normalizeState(baseline));
    return true;
}

module.exports = { BASELINE_FILE, FORMAT, validateBaseline, readBaseline, verifyBaselineFiles, initializeReleaseBaseline };
