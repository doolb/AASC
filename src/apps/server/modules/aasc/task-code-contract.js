'use strict';

// .src/framework/task-code-sync.md：构建、发布与运行时共用同一份任务包契约。
const crypto = require('node:crypto');
const API_VERSION = 1;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1024;
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CODE = /\.(?:js|cjs|mjs|html|css)$/i;
const RESERVED = new Set(['results', 'logs', 'models', 'node_modules', 'inputs', 'outputs', 'latest']);

function canonicalJson(value) {
    const normalize = item => Array.isArray(item) ? item.map(normalize)
        : item && typeof item === 'object'
            ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])])) : item;
    return JSON.stringify(normalize(value));
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function positive(value) { return Number.isSafeInteger(value) && value > 0 && value <= 2147483647; }
function assert(condition, message) { if (!condition) throw new Error(`任务代码包：${message}`); }
function validName(value) {
    return typeof value === 'string' && value.length <= 128 && NAME.test(value) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}
function isCodePath(value) { return typeof value === 'string' && CODE.test(value); }
function validateCodePath(value) {
    assert(typeof value === 'string' && isCodePath(value) && value.length <= 512, '代码路径或类型无效');
    const parts = value.split('/');
    assert(parts.every(part => validName(part) && !RESERVED.has(part.toLowerCase())), '代码路径越界或包含保留目录');
    assert(!/(?:^|[./_-])(?:test|tests|spec|smoke)(?:[./_-]|$)/i.test(value), '不能发布测试代码');
    return value;
}
function normalizeCodeRequirement(value) {
    assert(value && positive(value.minimumVersion) && value.taskCodeApiVersion === API_VERSION, '缺少服务代码版本/API 依赖');
    assert(value.maximumVersion === undefined || positive(value.maximumVersion) && value.maximumVersion >= value.minimumVersion, '服务代码版本区间无效');
    return { minimumVersion: value.minimumVersion,
        ...(value.maximumVersion === undefined ? {} : { maximumVersion: value.maximumVersion }), taskCodeApiVersion: API_VERSION };
}
function normalizeDependencyRequirement(value) {
    if (value === null) return null;
    assert(value && positive(value.version) && typeof value.lockSha256 === 'string' && HASH.test(value.lockSha256), '依赖版本/锁指纹必须成对声明，或明确为 null');
    return { version: value.version, lockSha256: value.lockSha256 };
}
function aggregateRequirements(tasks) {
    assert(Array.isArray(tasks) && tasks.length > 0 && tasks.length <= MAX_FILES, '任务列表为空或超限');
    const codes = tasks.map(task => normalizeCodeRequirement(task.codeRequirement));
    const requiredCodeVersion = Math.max(...codes.map(code => code.minimumVersion));
    const bounds = codes.flatMap(code => code.maximumVersion === undefined ? [] : [code.maximumVersion]);
    const maximumCodeVersion = bounds.length ? Math.min(...bounds) : undefined;
    assert(maximumCodeVersion === undefined || maximumCodeVersion >= requiredCodeVersion, `任务的服务代码版本区间没有交集: ${tasks.map(task => task.taskName).join(', ')}`);
    const dependencies = tasks.map(task => normalizeDependencyRequirement(task.dependencyRequirement)).filter(Boolean);
    const first = dependencies[0];
    assert(dependencies.every(item => item.version === first.version && item.lockSha256 === first.lockSha256), `多个任务的依赖版本/锁指纹冲突: ${tasks.map(task => task.taskName).join(', ')}`);
    return { taskCodeApiVersion: API_VERSION, requiredCodeVersion,
        ...(maximumCodeVersion === undefined ? {} : { maximumCodeVersion }),
        ...(first ? { requiredDependencyVersion: first.version, requiredLockSha256: first.lockSha256 } : {}) };
}
function compatibility(value) {
    const keys = ['taskCodeApiVersion', 'requiredCodeVersion', 'maximumCodeVersion', 'requiredApkVersionCode',
        'requiredDependencyVersion', 'requiredLockSha256'];
    return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
function validateCompatibility(value) {
    assert(value && value.taskCodeApiVersion === API_VERSION && positive(value.requiredCodeVersion)
        && positive(value.requiredApkVersionCode), 'API/服务/APK 版本约束无效');
    assert(value.maximumCodeVersion === undefined || positive(value.maximumCodeVersion)
        && value.maximumCodeVersion >= value.requiredCodeVersion, '代码包上界无效');
    if (value.requiredDependencyVersion !== undefined || value.requiredLockSha256 !== undefined) {
        normalizeDependencyRequirement({ version: value.requiredDependencyVersion, lockSha256: value.requiredLockSha256 });
    }
    return value;
}
function assertCombination(task, code, dependencies, apkVersionCode) {
    if (!task) return;
    validateCompatibility(task);
    assert(code && code.version >= task.requiredCodeVersion
        && (task.maximumCodeVersion === undefined || code.version <= task.maximumCodeVersion)
        && code.taskCodeApiVersion === task.taskCodeApiVersion, '服务代码包版本或任务 API 不兼容');
    assert(dependencies && code.requiredDependencyVersion === dependencies.version
        && code.requiredLockSha256 === dependencies.lockSha256, '服务代码包与依赖版本/锁指纹不匹配');
    if (task.requiredDependencyVersion !== undefined) {
        assert(task.requiredDependencyVersion === dependencies.version && task.requiredLockSha256 === dependencies.lockSha256,
            '任务要求的依赖包版本/锁指纹不匹配');
    }
    if (apkVersionCode !== undefined) assert(apkVersionCode >= task.requiredApkVersionCode, '请先安装支持任务代码包的 min APK');
}
function validateArtifact(value, components) {
    validateCompatibility(value);
    assert(value.bundleSha256 === undefined || typeof value.bundleSha256 === 'string' && HASH.test(value.bundleSha256), '任务内容指纹无效');
    assert(positive(value.version) && positive(value.size) && value.size <= MAX_TOTAL_BYTES + 1024 * 1024
        && typeof value.sha256 === 'string' && HASH.test(value.sha256)
        && value.relativeUrl === `task-code/task-code-v${value.version}.zip`, '制品版本/路径/大小/摘要无效');
    if (components) assertCombination(value, components.code, components.dependencies);
    return value;
}
function taskRevision(task) {
    return hash(canonicalJson({ codeRequirement: task.codeRequirement, dependencyRequirement: task.dependencyRequirement, files: task.files }));
}
function bundleHash(manifest) {
    return hash(canonicalJson({ ...compatibility(manifest), tasks: manifest.tasks, retiredTaskNames: manifest.retiredTaskNames }));
}
function validateManifest(manifest, expected = null) {
    validateCompatibility(manifest);
    assert(manifest.format === 'aasc-task-code' && manifest.schemaVersion === 1 && positive(manifest.version), '包内格式/版本无效');
    assert(Array.isArray(manifest.retiredTaskNames) && manifest.retiredTaskNames.every(validName), '退役名称无效');
    const names = new Set(); const paths = new Set(); let total = 0; let count = 0;
    const directories = new Set(['tasks']);
    assert(Array.isArray(manifest.tasks) && manifest.tasks.length > 0, '缺少任务');
    for (const task of manifest.tasks) {
        assert(validName(task.taskName) && !names.has(task.taskName.toLowerCase()), '任务名称无效或重复');
        names.add(task.taskName.toLowerCase());
        normalizeCodeRequirement(task.codeRequirement); normalizeDependencyRequirement(task.dependencyRequirement);
        assert(Array.isArray(task.files) && task.files.length > 0, '任务代码文件为空');
        for (const file of task.files) {
            validateCodePath(file.path);
            const key = `${task.taskName}/${file.path}`.toLowerCase();
            assert(!paths.has(key) && Number.isSafeInteger(file.size) && file.size >= 0
                && file.size <= MAX_FILE_BYTES && typeof file.sha256 === 'string' && HASH.test(file.sha256), '代码文件重复/大小/摘要无效');
            paths.add(key); total += file.size; count++;
            const parts = `tasks/${task.taskName}/${file.path}`.split('/');
            for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'));
        }
        assert(task.revision === taskRevision(task), '任务 revision 不匹配');
    }
    for (const name of manifest.retiredTaskNames) {
        assert(!names.has(name.toLowerCase()), '退役名称重复或与活动任务冲突'); names.add(name.toLowerCase());
    }
    assert(count <= MAX_FILES && total <= MAX_TOTAL_BYTES, '代码总大小/数量超限');
    assert(count + directories.size + 1 <= 4096, 'ZIP目录和文件条目总数超限');
    const aggregate = aggregateRequirements(manifest.tasks);
    assert(canonicalJson(compatibility(manifest)) === canonicalJson({ ...aggregate, requiredApkVersionCode: manifest.requiredApkVersionCode }), '包级兼容要求与任务声明不一致');
    assert(manifest.bundleSha256 === bundleHash(manifest), '任务包内容摘要不匹配');
    if (expected) assert(manifest.version === expected.version
        && (expected.bundleSha256 === undefined || manifest.bundleSha256 === expected.bundleSha256)
        && canonicalJson(compatibility(manifest)) === canonicalJson(compatibility(expected)), '包内版本/契约与签名组件不一致');
    return manifest;
}
module.exports = { API_VERSION, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_FILES, canonicalJson, hash, positive,
    validName, isCodePath, validateCodePath, normalizeCodeRequirement, normalizeDependencyRequirement,
    aggregateRequirements, compatibility, validateCompatibility, assertCombination, validateArtifact,
    taskRevision, bundleHash, validateManifest };
