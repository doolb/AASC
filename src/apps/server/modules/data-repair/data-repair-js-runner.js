'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fsPromises = fs.promises;
const FORMAT = 'aasc-offline-data-repair';
const SCHEMA_VERSION = 1;
const STATE_FILE = 'data-repair/state.json';
const PENDING_FILE = 'data-repair/pending-repair.json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REPAIR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_EXECUTION_MS = 30_000;
const MAX_REPAIR_LOG_CHARS = 512;

// 修复脚本只能看到这些业务能力。方法名来自现有服务对象，脚本不直接拿到
// dataStore、文件系统对象或 Node 原生模块，避免把一次性修复包变成任意代码入口。
const CAPABILITY_METHODS = Object.freeze({
    config: Object.freeze([
        'get',
        'set',
        'getTtsConfig',
        'setTtsConfig',
        'getCpuAffinityConfig',
        'applyCpuAffinityConfigUpdate',
        'normalizeControlTheme'
    ]),
    'user-config': Object.freeze([
        'getDisplayState',
        'getDisplayStateById',
        'setDisplayState',
        'updateDisplayState',
        'updateDisplayStateById',
        'addToPlaylist',
        'removeFromPlaylist',
        'clearPlaylist',
        'getPlaylist',
        'getAllDisplayStates',
        'getDeviceEvents',
        'getDeviceEvent',
        'setDeviceEvent',
        'removeDeviceEvent'
    ]),
    'chat2api.config': Object.freeze(['getConfig', 'saveConfig']),
    'chat2api.providers': Object.freeze(['listProviders', 'saveProvider', 'deleteProvider']),
    'chat2api.accounts': Object.freeze(['listAccounts', 'updateAccount', 'deleteAccount']),
    'chat2api.model-mappings': Object.freeze([
        'listModelMappings',
        'saveModelMapping',
        'deleteModelMapping'
    ])
});

const cloneValue = (value) => {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
};

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const isNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

function sha256Buffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

function isSafeRelativePath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '' ||
        relativePath.startsWith('/') || relativePath.includes('\\')) {
        return false;
    }
    return relativePath.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function assertSafeRelativePath(relativePath, name) {
    if (!isSafeRelativePath(relativePath)) {
        throw new Error(`${name} 路径不安全`);
    }
}

function normalizeCapabilities(capabilities) {
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
        throw new Error('dataRepair.capabilities 不能为空');
    }
    const normalized = [...new Set(capabilities.map((value) => String(value).trim()))];
    normalized.forEach((capability) => {
        if (!Object.prototype.hasOwnProperty.call(CAPABILITY_METHODS, capability)) {
            throw new Error(`dataRepair 能力未注册: ${capability}`);
        }
    });
    return normalized;
}

function validatePendingRepair(rawValue) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        throw new Error('待执行数据修复清单必须是对象');
    }
    if (rawValue.format !== FORMAT || rawValue.schemaVersion !== SCHEMA_VERSION) {
        throw new Error('待执行数据修复清单格式或版本不支持');
    }
    if (!REPAIR_ID_PATTERN.test(rawValue.repairId || '')) {
        throw new Error('待执行数据修复 repairId 无效');
    }
    ['repairVersion', 'requiredCodeVersion'].forEach((field) => {
        if (!isPositiveInteger(rawValue[field])) throw new Error(`待执行数据修复 ${field} 无效`);
    });
    ['requiredDataVersion', 'targetDataVersion'].forEach((field) => {
        if (!isNonNegativeInteger(rawValue[field])) throw new Error(`待执行数据修复 ${field} 无效`);
    });
    if (rawValue.targetDataVersion < rawValue.requiredDataVersion) {
        throw new Error('待执行数据修复 targetDataVersion 不能小于 requiredDataVersion');
    }
    if (rawValue.requiredApkVersionCode !== undefined &&
        !isPositiveInteger(rawValue.requiredApkVersionCode)) {
        throw new Error('待执行数据修复 requiredApkVersionCode 无效');
    }
    assertSafeRelativePath(rawValue.script, '待执行数据修复脚本');
    if (path.posix.basename(rawValue.script) !== 'repair.js') {
        throw new Error('待执行数据修复脚本必须命名为 repair.js');
    }
    if (!isSha256(rawValue.scriptSha256)) {
        throw new Error('待执行数据修复 scriptSha256 无效');
    }
    const capabilities = normalizeCapabilities(rawValue.capabilities);
    if (capabilities.includes('chat2api.accounts') && rawValue.sensitive !== true) {
        throw new Error('访问 Chat2API 账号必须显式声明 sensitive');
    }
    if (rawValue.sensitive !== undefined && typeof rawValue.sensitive !== 'boolean') {
        throw new Error('待执行数据修复 sensitive 必须是布尔值');
    }
    return {
        ...rawValue,
        capabilities,
        sensitive: rawValue.sensitive === true
    };
}

function isSha256(value) {
    return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function normalizeState(rawValue) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        return { dataVersion: 0, latestRepairVersion: 0, appliedRepairs: [] };
    }
    const appliedRepairs = Array.isArray(rawValue.appliedRepairs)
        ? rawValue.appliedRepairs.filter((item) => item && typeof item.repairId === 'string')
        : [];
    return {
        dataVersion: isNonNegativeInteger(rawValue.dataVersion) ? rawValue.dataVersion : 0,
        latestRepairVersion: isNonNegativeInteger(rawValue.latestRepairVersion)
            ? rawValue.latestRepairVersion
            : 0,
        appliedRepairs
    };
}

async function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return cloneValue(fallback);
        throw error;
    }
}

async function writeJsonAtomically(filePath, value) {
    const directory = path.dirname(filePath);
    await fsPromises.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(
        directory,
        `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`
    );
    try {
        await fsPromises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
            flag: 'wx',
            mode: 0o600
        });
        await fsPromises.rename(temporaryPath, filePath);
        await fsPromises.chmod(filePath, 0o600);
    } finally {
        await fsPromises.rm(temporaryPath, { force: true });
    }
}

async function snapshotFiles(filePaths) {
    const snapshots = [];
    for (const filePath of [...new Set(filePaths.map((item) => path.resolve(item)))]) {
        const stat = await fsPromises.lstat(filePath).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (stat?.isSymbolicLink()) throw new Error(`数据修复目标不能是符号链接: ${filePath}`);
        snapshots.push({
            filePath,
            exists: Boolean(stat),
            content: stat ? await fsPromises.readFile(filePath) : null,
            mode: stat ? stat.mode & 0o777 : 0o600
        });
    }
    return snapshots;
}

async function restoreSnapshots(snapshots) {
    for (const snapshot of snapshots) {
        const current = await fsPromises.lstat(snapshot.filePath).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (current?.isSymbolicLink()) throw new Error(`回滚目标不能是符号链接: ${snapshot.filePath}`);
        if (!snapshot.exists) {
            await fsPromises.rm(snapshot.filePath, { force: true });
            continue;
        }
        await fsPromises.mkdir(path.dirname(snapshot.filePath), { recursive: true });
        const temporaryPath = path.join(
            path.dirname(snapshot.filePath),
            `.${path.basename(snapshot.filePath)}.rollback-${process.pid}-${crypto.randomUUID()}`
        );
        try {
            await fsPromises.writeFile(temporaryPath, snapshot.content, { flag: 'wx', mode: snapshot.mode });
            await fsPromises.rename(temporaryPath, snapshot.filePath);
            await fsPromises.chmod(snapshot.filePath, snapshot.mode);
        } finally {
            await fsPromises.rm(temporaryPath, { force: true });
        }
    }
}

function bindCapabilityService(service, capabilities) {
    if (!service || typeof service !== 'object') return {};
    const methodNames = new Set(capabilities.flatMap((capability) => CAPABILITY_METHODS[capability]));
    return Object.fromEntries([...methodNames]
        .filter((methodName) => typeof service[methodName] === 'function')
        .map((methodName) => [methodName, service[methodName].bind(service)]));
}

function buildScriptServices(services, capabilities) {
    const result = {};
    const configCapabilities = capabilities.filter((capability) => capability === 'config' || capability === 'user-config');
    if (configCapabilities.length > 0) {
        const configService = services.config || services.userConfig;
        result.config = bindCapabilityService(configService, configCapabilities);
    }
    if (capabilities.some((capability) => capability.startsWith('chat2api.'))) {
        result.chat2api = bindCapabilityService(
            services.chat2api,
            capabilities.filter((capability) => capability.startsWith('chat2api.'))
        );
    }
    return result;
}

function getVersionFromRuntimeFiles(projectRoot) {
    const candidates = [
        path.join(projectRoot, 'updates', 'active-release.json'),
        path.join(projectRoot, 'offline-update-client.json')
    ];
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            if (isPositiveInteger(value.codeVersion)) return value.codeVersion;
        } catch (_error) {
            // 版本指针不存在时继续检查下一个来源。
        }
    }
    const environmentValue = Number(process.env.AASC_SERVER_CODE_VERSION);
    return isPositiveInteger(environmentValue) ? environmentValue : 0;
}

function createScriptSandbox(scriptSource, scriptPath) {
    const module = { exports: {} };
    const sandbox = {
        module,
        exports: module.exports,
        Object,
        Array,
        Boolean,
        Date,
        Error,
        JSON,
        Math,
        Number,
        Promise,
        RegExp,
        String,
        Symbol,
        Uint8Array
    };
    const context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false }
    });
    const script = new vm.Script(`'use strict';\n${scriptSource}\n`, {
        filename: scriptPath,
        displayErrors: true
    });
    script.runInContext(context, { timeout: MAX_EXECUTION_MS });
    const entry = module.exports?.default || module.exports;
    if (typeof entry !== 'function') throw new Error('repair.js 必须导出一个修复函数');
    return entry;
}

function createDataRepairRunner(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const services = options.services || {};
    const managedFiles = Array.isArray(options.managedFiles) ? options.managedFiles : [];
    const logger = options.logger || console;
    const codeVersion = Number.isSafeInteger(options.codeVersion)
        ? options.codeVersion
        : getVersionFromRuntimeFiles(projectRoot);
    const apkVersionCode = Number.isSafeInteger(options.apkVersionCode)
        ? options.apkVersionCode
        : Number(process.env.AASC_APK_VERSION_CODE) || 0;
    let operation = Promise.resolve();

    const log = (event, details = {}) => {
        const safeEvent = String(event || 'repair').slice(0, MAX_REPAIR_LOG_CHARS);
        const safeDetails = details && typeof details === 'object' ? {
            repairId: details.repairId,
            repairVersion: details.repairVersion,
            service: details.service,
            status: details.status,
            errorCode: details.errorCode
        } : {};
        logger.info?.(`[数据修复] ${safeEvent} ${JSON.stringify(safeDetails)}`);
    };

    const enqueue = (task) => {
        const next = operation.then(task, task);
        operation = next.catch(() => undefined);
        return next;
    };

    const applyPendingRepair = () => enqueue(async () => {
        const pendingPath = path.join(projectRoot, PENDING_FILE);
        const pendingRaw = await readJsonFile(pendingPath, null);
        if (!pendingRaw) return { status: 'not-found' };
        const pending = validatePendingRepair(pendingRaw);
        const statePath = path.join(projectRoot, STATE_FILE);
        const state = normalizeState(await readJsonFile(statePath, null));
        const applied = state.appliedRepairs.some((item) => item.repairId === pending.repairId);
        if (applied) {
            await fsPromises.rm(pendingPath, { force: true });
            log('跳过已成功应用的修复', pending);
            return { status: 'skipped', repairId: pending.repairId };
        }
        if (codeVersion < pending.requiredCodeVersion) {
            return { status: 'waiting-code-version', repairId: pending.repairId };
        }
        if (pending.requiredApkVersionCode !== undefined &&
            apkVersionCode < pending.requiredApkVersionCode) {
            return { status: 'waiting-apk-version', repairId: pending.repairId };
        }
        if (state.dataVersion !== pending.requiredDataVersion) {
            return { status: 'rejected-data-version', repairId: pending.repairId };
        }
        if (pending.repairVersion <= state.latestRepairVersion) {
            await fsPromises.rm(pendingPath, { force: true });
            log('跳过较旧修复版本', pending);
            return { status: 'skipped-old-version', repairId: pending.repairId };
        }

        const scriptPath = path.resolve(projectRoot, pending.script);
        if (scriptPath !== projectRoot && !scriptPath.startsWith(`${projectRoot}${path.sep}`)) {
            throw new Error('修复脚本路径越界');
        }
        const scriptStat = await fsPromises.stat(scriptPath);
        if (!scriptStat.isFile() || scriptStat.size > MAX_SCRIPT_BYTES) {
            throw new Error('repair.js 文件无效或超过大小限制');
        }
        const scriptSource = await fsPromises.readFile(scriptPath, 'utf8');
        if (sha256Buffer(Buffer.from(scriptSource, 'utf8')) !== pending.scriptSha256) {
            throw new Error('repair.js SHA-256 与签名清单不匹配');
        }
        const snapshots = await snapshotFiles(managedFiles);
        const stateSnapshot = await snapshotFiles([statePath]);
        const scriptServices = buildScriptServices(services, pending.capabilities);
        const entry = createScriptSandbox(scriptSource, scriptPath);
        const context = Object.freeze({
            services: Object.freeze(scriptServices),
            readVersion: () => ({ codeVersion, apkVersionCode, dataVersion: state.dataVersion }),
            assert: (condition, message) => {
                if (!condition) throw new Error(String(message || '修复前置条件不满足'));
            },
            log: (event, details) => log(event, { ...details, repairId: pending.repairId, repairVersion: pending.repairVersion })
        });

        try {
            let timeoutHandle;
            try {
                await Promise.race([
                    Promise.resolve(entry(context)),
                    new Promise((_, reject) => {
                        timeoutHandle = setTimeout(() => reject(new Error('repair.js 执行超时')), MAX_EXECUTION_MS);
                    })
                ]);
            } finally {
                clearTimeout(timeoutHandle);
            }
            const nextState = {
                dataVersion: pending.targetDataVersion,
                latestRepairVersion: pending.repairVersion,
                appliedRepairs: [
                    ...state.appliedRepairs,
                    {
                        repairId: pending.repairId,
                        repairVersion: pending.repairVersion,
                        targetDataVersion: pending.targetDataVersion,
                        appliedAt: new Date().toISOString(),
                        capabilities: pending.capabilities.slice()
                    }
                ]
            };
            await writeJsonAtomically(statePath, nextState);
            await fsPromises.rm(pendingPath, { force: true });
            options.onApplied?.(nextState, pending);
            log('数据修复已应用', { ...pending, status: 'applied' });
            return { status: 'applied', repairId: pending.repairId, state: nextState };
        } catch (error) {
            try {
                await restoreSnapshots(snapshots);
                await restoreSnapshots(stateSnapshot);
            } catch (rollbackError) {
                logger.error?.(`[数据修复] 回滚失败: ${rollbackError.message}`);
            }
            log('数据修复失败并已回滚', {
                ...pending,
                status: 'rolled-back',
                errorCode: error.code || 'repair_failed'
            });
            return {
                status: 'rolled-back',
                repairId: pending.repairId,
                error: error.message
            };
        }
    });

    return {
        applyPendingRepair,
        constants: {
            FORMAT,
            SCHEMA_VERSION,
            STATE_FILE,
            PENDING_FILE
        }
    };
}

module.exports = {
    CAPABILITY_METHODS,
    FORMAT,
    SCHEMA_VERSION,
    STATE_FILE,
    PENDING_FILE,
    createDataRepairRunner,
    validatePendingRepair,
    normalizeState,
    snapshotFiles,
    restoreSnapshots,
    sha256Buffer,
    sha256File
};
