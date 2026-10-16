'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { loadOfflineUpdateKeyPair } = require('./offline-update-signing');
const {
    readGitSourceMetadata,
    validateGitSourceMetadata
} = require('./git-source-metadata');
const { stageNodeMinSeeds } = require('./node-min-seeds');
const { prepareReleaseRepairs } = require('./offline-data-repair-seeds');
const { normalizeCompatibleDataVersions } = require('../../src/apps/server/modules/data-repair/data-repair-js-runner');
const { RUNTIME_COMPATIBILITY, validateRuntimeCompatibility } = require('./offline-runtime-contract');

const execFileAsync = promisify(execFile);
const sharedUpdate = require('../../src/apps/server/modules/aasc/shared-update-manifest');
const { buildDependencyGroups } = require('./dependency-groups');
const { stageVoiceDisplayNodePackage } = require('./voice-display-node-package');
const CODE_ENTRYPOINT = 'src/apps/server/boot/server-launcher.js';
const DATA_REPAIR_ENTRYPOINT = 'repair.js';
const DATA_REPAIR_CAPABILITIES = Object.freeze([
    'config',
    'user-config',
    'chat2api.config',
    'chat2api.providers',
    'chat2api.accounts',
    'chat2api.model-mappings'
]);
const SIGNATURE_ALGORITHM = 'SHA256withRSA';
const MAX_NODE_MIN_SEEDS_ARCHIVE_BYTES = 64 * 1024 * 1024;
const HOME_LAN_UPDATE_BASE_URL = 'http://192.168.1.39/mnt/aasc-offline/';
const COMPANY_LAN_UPDATE_BASE_URL = 'http://10.221.70.87/mnt/aasc-offline/';
// 公网域名当前可能被代理返回 403；构建阶段使用已解析的公网 IP，Android 端仍负责域名解析。
const WAN_UPDATE_BASE_URL = 'http://120.79.245.103/mnt/aasc-offline/';
const UPDATE_BASE_URLS = Object.freeze([
    HOME_LAN_UPDATE_BASE_URL,
    COMPANY_LAN_UPDATE_BASE_URL,
    WAN_UPDATE_BASE_URL
]);

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
    }
    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
}

function signManifestPayload(payload, privateKeyPem) {
    if (!privateKeyPem) throw new Error('Offline 更新清单签名私钥未提供');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonicalJson(payload), 'utf8');
    signer.end();
    return {
        algorithm: SIGNATURE_ALGORITHM,
        value: signer.sign(privateKeyPem, 'base64')
    };
}

function validateSignedManifestEnvelope(manifest) {
    if (!manifest || typeof manifest !== 'object' || !manifest.payload || !manifest.signature) {
        throw new Error('Offline 更新清单格式无效');
    }
    if (manifest.signature.algorithm !== SIGNATURE_ALGORITHM ||
        typeof manifest.signature.value !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature.value)) {
        throw new Error('Offline 更新清单签名字段无效');
    }
    return true;
}

function verifySignedManifest(manifest, publicKeyPem) {
    validateSignedManifestEnvelope(manifest);
    if (!publicKeyPem) throw new Error('Offline 更新清单验证公钥未提供');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalJson(manifest.payload), 'utf8');
    verifier.end();
    if (!verifier.verify(publicKeyPem, manifest.signature.value, 'base64')) {
        throw new Error('Offline 更新清单签名验证失败');
    }
    return true;
}

function isSha256(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateArtifactEntry(entry, name) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Offline 清单 ${name} 组件无效`);
    }
    assertVersion(entry.version, `${name}.version`);
    if (typeof entry.relativeUrl !== 'string' || entry.relativeUrl.trim() === '' ||
        entry.relativeUrl.startsWith('/') || entry.relativeUrl.includes('\\') ||
        entry.relativeUrl.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Offline 清单 ${name}.relativeUrl 不安全`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 1 || !isSha256(entry.sha256)) {
        throw new Error(`Offline 清单 ${name} 大小或 SHA-256 无效`);
    }
}

function validateManifestComponents(manifest) {
    if (manifest.payload.schemaVersion !== 1 ||
        !manifest.payload.components || typeof manifest.payload.components !== 'object' ||
        Array.isArray(manifest.payload.components)) {
        throw new Error('Offline 更新清单 schemaVersion/components 无效');
    }
    const { code, dependencies, apkMin } = manifest.payload.components;
    if (manifest.payload.components.taskCode !== undefined) {
        require('../../src/apps/server/modules/aasc/task-code-contract').validateArtifact(
            manifest.payload.components.taskCode, manifest.payload.components);
    }
    sharedUpdate.validateTaskDependencies(manifest.payload.components.taskDependencies);
    if (code?.runtimeCompatibility !== undefined) validateRuntimeCompatibility(code.runtimeCompatibility);
    if (apkMin?.runtimeCompatibility !== undefined) validateRuntimeCompatibility(apkMin.runtimeCompatibility);
    validateArtifactEntry(code, 'code');
    if (dependencies?.groups) sharedUpdate.validateDependencies(dependencies);
    else validateArtifactEntry(dependencies, 'dependencies');
    if (manifest.payload.components.nodeMinSeeds !== undefined) {
        validateArtifactEntry(manifest.payload.components.nodeMinSeeds, 'nodeMinSeeds');
        validateGitSourceMetadata(manifest.payload.components.nodeMinSeeds.source, 'components.nodeMinSeeds.source');
    }
    validateGitSourceMetadata(code.source, 'components.code.source');
    validateGitSourceMetadata(dependencies.source, 'components.dependencies.source');
    assertVersion(code.requiredDependencyVersion, 'code.requiredDependencyVersion');
    if (code.requiredDependencyVersion !== dependencies.version ||
        !isSha256(code.requiredLockSha256) || code.requiredLockSha256 !== dependencies.lockSha256 ||
        !isSha256(dependencies.lockSha256)) {
        throw new Error('Offline 清单 code/dependencies 版本或 lockfile 指纹不匹配');
    }
    if (apkMin !== undefined) {
        validateArtifactEntry({ ...apkMin, version: apkMin.versionCode }, 'apkMin');
        validateGitSourceMetadata(apkMin.source, 'components.apkMin.source');
        if (typeof apkMin.versionName !== 'string' || apkMin.versionName.trim() === '') {
            throw new Error('Offline 清单 apkMin.versionName 无效');
        }
        if (apkMin.packageName !== 'com.aasc.display.offline' ||
            !isSha256(apkMin.signerSha256) || !isSha256(apkMin.modelCompatibilitySha256)) {
            throw new Error('Offline 清单 apkMin 包名、签名证书或模型兼容指纹无效');
        }
    }
    if (manifest.payload.components.dataRepair !== undefined) {
        validateDataRepairComponent(manifest.payload.components.dataRepair);
    }
}

function validateDataRepairComponent(component) {
    validateArtifactEntry(component, 'dataRepair');
    if (component.repairVersion !== component.version ||
        typeof component.repairId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(component.repairId)) {
        throw new Error('Offline 清单 dataRepair repairId/repairVersion 无效');
    }
    if (!Number.isSafeInteger(component.requiredCodeVersion) || component.requiredCodeVersion < 1 ||
        !Number.isSafeInteger(component.requiredDataVersion) || component.requiredDataVersion < 0 ||
        !Number.isSafeInteger(component.targetDataVersion) || component.targetDataVersion < component.requiredDataVersion) {
        throw new Error('Offline 清单 dataRepair 版本门控字段无效');
    }
    if (component.requiredApkVersionCode !== undefined &&
        (!Number.isSafeInteger(component.requiredApkVersionCode) || component.requiredApkVersionCode < 1)) {
        throw new Error('Offline 清单 dataRepair.requiredApkVersionCode 无效');
    }
    normalizeCompatibleDataVersions(component.compatibleDataVersions, component.requiredDataVersion, component.targetDataVersion);
    if (component.compatibleDataVersions?.length > 1 && component.requiredApkVersionCode === undefined) {
        throw new Error('累计迁移必须声明最低APK版本');
    }
    if (!isSha256(component.scriptSha256)) throw new Error('Offline 清单 dataRepair.scriptSha256 无效');
    if (!Array.isArray(component.capabilities) || component.capabilities.length === 0 ||
        component.capabilities.some((value) => typeof value !== 'string' || value.trim() === '')) {
        throw new Error('Offline 清单 dataRepair.capabilities 无效');
    }
    if (new Set(component.capabilities).size !== component.capabilities.length ||
        component.capabilities.some((value) => !DATA_REPAIR_CAPABILITIES.includes(value))) {
        throw new Error('Offline 清单 dataRepair.capabilities 包含未注册能力');
    }
    if (component.sensitive !== undefined && typeof component.sensitive !== 'boolean') {
        throw new Error('Offline 清单 dataRepair.sensitive 必须是布尔值');
    }
    if (component.capabilities.includes('chat2api.accounts') && component.sensitive !== true) {
        throw new Error('Offline 清单 dataRepair 访问 Chat2API 账号必须声明 sensitive');
    }
    if (component.releaseNotes !== undefined &&
        (typeof component.releaseNotes !== 'string' || component.releaseNotes.trim().length > 4096)) {
        throw new Error('Offline 清单 dataRepair.releaseNotes 无效');
    }
}

function publicKeyFromPrivateKey(privateKeyPem) {
    return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem))
        .export({ type: 'spki', format: 'pem' });
}

async function fetchCurrentManifestFromNetwork(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 运行时不支持 fetch');
    const baseUrls = options.baseUrls || UPDATE_BASE_URLS;
    if (!Array.isArray(baseUrls) || baseUrls.length === 0) throw new Error('Offline 更新源列表不能为空');
    let notFoundCount = 0;
    let lastNetworkError = null;
    for (const baseUrl of baseUrls) {
        let response;
        try {
            response = await fetchImpl(new URL('manifest.json', baseUrl), {
                signal: AbortSignal.timeout(options.timeoutMs || 5000)
            });
        } catch (error) {
            lastNetworkError = error;
            continue;
        }
        if (response.status === 404) {
            notFoundCount += 1;
            continue;
        }
        if (!response.ok) {
            lastNetworkError = new Error(`读取更新清单失败，HTTP ${response.status}: ${baseUrl}`);
            continue;
        }
        try {
            return JSON.parse(await response.text());
        } catch (error) {
            throw new Error(`更新源返回的 manifest.json 不是有效 JSON: ${error.message}`, { cause: error });
        }
    }
    if (lastNetworkError) {
        throw new Error(`无法从局域网或外网读取当前 Offline 更新清单: ${lastNetworkError.message}`, {
            cause: lastNetworkError
        });
    }
    if (notFoundCount === baseUrls.length) return null;
    throw new Error('局域网和外网更新源均未返回清单');
}

function assertVersion(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} 必须是大于 0 的安全整数`);
    }
}

function assertNewVersion(next, previous, name) {
    assertVersion(next, name);
    if (Number.isSafeInteger(previous) && next <= previous) {
        throw new Error(`${name} 必须大于当前已发布版本 ${previous}`);
    }
}

function resolveUpdatePlan(options = {}) {
    const {
        requestedMode,
        currentDependencies,
        lockSha256,
        dependencyVersion: configuredDependencyVersion
    } = options;
    if (requestedMode === 'all') {
        const dependencyVersion = Number(configuredDependencyVersion);
        assertVersion(dependencyVersion, 'dependencyVersion');
        assertNewVersion(dependencyVersion, currentDependencies?.version, 'dependencyVersion');
        return {
            mode: 'all',
            dependencyVersion,
            autoDependencyUpgrade: false
        };
    }
    if (requestedMode !== 'code-only') {
        throw new Error(`不支持的 Offline 更新模式: ${requestedMode}`);
    }
    if (!currentDependencies || !Number.isSafeInteger(currentDependencies.version) ||
        typeof currentDependencies.lockSha256 !== 'string') {
        throw new Error('code-only 需要有效的已发布 dependencies 版本和 lock 指纹');
    }
    if (lockSha256 === currentDependencies.lockSha256) {
        return {
            mode: 'code-only',
            dependencyVersion: currentDependencies.version,
            autoDependencyUpgrade: false
        };
    }
    const dependencyVersion = configuredDependencyVersion === undefined
        ? currentDependencies.version + 1
        : Number(configuredDependencyVersion);
    assertNewVersion(dependencyVersion, currentDependencies.version, 'dependencyVersion');
    return {
        mode: 'all',
        dependencyVersion,
        autoDependencyUpgrade: true
    };
}

function sha256Buffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function describeArtifact(filePath, relativeUrl) {
    const stat = await fs.promises.stat(filePath);
    return {
        relativeUrl,
        size: stat.size,
        sha256: await sha256File(filePath)
    };
}

function createOutputTemporaryPath(destinationPath) {
    return path.join(
        path.dirname(destinationPath),
        `.${path.basename(destinationPath)}.tmp-${process.pid}-${crypto.randomUUID()}`
    );
}

async function atomicallyCopyToOutput(sourcePath, destinationPath) {
    const temporaryPath = createOutputTemporaryPath(destinationPath);
    try {
        await fs.promises.copyFile(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
        await fs.promises.rename(temporaryPath, destinationPath);
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
    }
}

async function atomicallyWriteOutput(destinationPath, contents) {
    const temporaryPath = createOutputTemporaryPath(destinationPath);
    try {
        await fs.promises.writeFile(temporaryPath, contents, { flag: 'wx' });
        await fs.promises.rename(temporaryPath, destinationPath);
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
    }
}

async function copyCodeSnapshot(projectRoot, stagingDirectory) {
    const sourceRoot = path.join(projectRoot, 'src');
    const targetRoot = path.join(stagingDirectory, 'src');
    const sourceStat = await fs.promises.lstat(sourceRoot).catch(() => null);
    if (!sourceStat?.isDirectory()) throw new Error(`服务源码目录不存在: ${sourceRoot}`);
    if (sourceStat.isSymbolicLink()) throw new Error(`服务源码根目录不能是符号链接: ${sourceRoot}`);

    await fs.promises.mkdir(targetRoot, { recursive: true });
    const excludedPaths = [
        path.resolve(sourceRoot, 'apps', 'android-display'),
        path.resolve(sourceRoot, 'apps', 'voice-display-node')
    ];
    const copySelectedTree = async (relativePath = '') => {
        const sourceDirectory = path.join(sourceRoot, relativePath);
        const entries = await fs.promises.readdir(sourceDirectory, { withFileTypes: true });
        for (const entry of entries) {
            const childRelativePath = path.join(relativePath, entry.name);
            const sourcePath = path.join(sourceRoot, childRelativePath);
            if (excludedPaths.some(excludedPath => path.resolve(sourcePath) === excludedPath ||
                path.resolve(sourcePath).startsWith(`${excludedPath}${path.sep}`))) {
                continue;
            }
            const stat = await fs.promises.lstat(sourcePath);
            if (stat.isSymbolicLink()) throw new Error(`源码发布包不允许符号链接: ${childRelativePath}`);
            const targetPath = path.join(targetRoot, childRelativePath);
            if (stat.isDirectory()) {
                await fs.promises.mkdir(targetPath, { recursive: true });
                await copySelectedTree(childRelativePath);
            } else if (stat.isFile()) {
                await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.promises.copyFile(sourcePath, targetPath);
            } else {
                throw new Error(`源码发布包包含不支持的文件类型: ${childRelativePath}`);
            }
        }
    };
    await copySelectedTree();
    for (const fileName of ['package.json', 'package-lock.json']) {
        const sourcePath = path.join(projectRoot, fileName);
        const stat = await fs.promises.lstat(sourcePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${fileName} 必须是普通文件`);
        await fs.promises.copyFile(sourcePath, path.join(stagingDirectory, fileName));
    }
    if (!fs.existsSync(path.join(stagingDirectory, CODE_ENTRYPOINT))) {
        throw new Error(`源码发布包缺少服务器入口: ${CODE_ENTRYPOINT}`);
    }
}

async function createZip(stagingDirectory, archivePath, commandRunner) {
    await fs.promises.mkdir(path.dirname(archivePath), { recursive: true });
    await commandRunner('zip', ['-X', '-q', '-r', archivePath, '.'], { cwd: stagingDirectory });
    if (!fs.existsSync(archivePath) || (await fs.promises.stat(archivePath)).size === 0) {
        throw new Error(`生成更新档案失败: ${archivePath}`);
    }
}

async function nextNodeMinSeedVersion(outputDir, minimum) {
    const directory = path.join(outputDir, 'node-min-seeds');
    const stat = await fs.promises.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (!stat) return minimum;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('首装种子输出目录不能是链接或文件');
    let version = minimum;
    for (const name of await fs.promises.readdir(directory)) {
        const match = /^node-min-seeds-v([0-9]+)\.zip$/u.exec(name);
        if (!match) continue;
        const entry = await fs.promises.lstat(path.join(directory, name));
        if (entry.isSymbolicLink()) throw new Error('首装种子版本文件不能是链接');
        const existing = Number(match[1]);
        if (entry.isFile() && Number.isSafeInteger(existing)) version = Math.max(version, existing + 1);
    }
    assertVersion(version, 'nodeMinSeedVersion');
    return version;
}

async function readManifest(value) {
    if (typeof value === 'string') {
        return JSON.parse(await fs.promises.readFile(value, 'utf8'));
    }
    return value;
}

async function loadCurrentManifest(options, publicKeyPem) {
    if (options.currentManifest) {
        const manifest = await readManifest(options.currentManifest);
        verifySignedManifest(manifest, publicKeyPem);
        validateManifestComponents(manifest);
        return manifest;
    }
    if (!options.fetchCurrentManifest) return null;
    const manifest = await options.fetchCurrentManifest(UPDATE_BASE_URLS);
    if (!manifest) return null;
    verifySignedManifest(manifest, publicKeyPem);
    validateManifestComponents(manifest);
    return manifest;
}

function parseRepairCapabilities(value) {
    const capabilities = Array.isArray(value)
        ? value
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    const normalized = [...new Set(capabilities.map((item) => String(item).trim()))];
    if (normalized.length === 0) throw new Error('dataRepair 至少需要一个 capability');
    return normalized;
}

async function createDataRepairArtifacts(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'release/offline-update/output'));
    const keyPair = await loadOfflineUpdateKeyPair(options);
    const { privateKeyPem, publicKeyPem } = keyPair;
    const currentManifest = await loadCurrentManifest(options, publicKeyPem);
    if (!currentManifest) throw new Error('构建 dataRepair 必须先取得当前已发布 Offline 清单');
    const repairFile = path.resolve(options.dataRepairFile || '');
    const repairStat = await fs.promises.lstat(repairFile).catch(() => null);
    if (!repairStat?.isFile() || repairStat.isSymbolicLink()) {
        throw new Error(`dataRepair 脚本必须是普通文件: ${repairFile}`);
    }
    if (path.basename(repairFile) !== DATA_REPAIR_ENTRYPOINT) {
        throw new Error(`dataRepair 脚本必须命名为 ${DATA_REPAIR_ENTRYPOINT}`);
    }
    if (repairStat.size < 1 || repairStat.size > 512 * 1024) {
        throw new Error('dataRepair 脚本大小必须在 1 到 524288 字节之间');
    }
    const repairVersion = Number(options.repairVersion);
    assertVersion(repairVersion, 'repairVersion');
    const currentComponent = currentManifest.payload.components.dataRepair;
    assertNewVersion(repairVersion, currentComponent?.version, 'repairVersion');
    const requiredCodeVersion = Number(options.requiredCodeVersion || currentManifest.payload.components.code.version);
    assertVersion(requiredCodeVersion, 'requiredCodeVersion');
    const requiredDataVersion = options.requiredDataVersion === undefined
        ? Number(currentComponent?.targetDataVersion || 0)
        : Number(options.requiredDataVersion);
    const targetDataVersion = options.targetDataVersion === undefined
        ? requiredDataVersion + 1
        : Number(options.targetDataVersion);
    if (!Number.isSafeInteger(requiredDataVersion) || requiredDataVersion < 0 ||
        !Number.isSafeInteger(targetDataVersion) || targetDataVersion <= requiredDataVersion) {
        throw new Error('requiredDataVersion/targetDataVersion 无效');
    }
    const repairId = String(options.repairId || `data-repair-${repairVersion}`).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(repairId)) throw new Error('repairId 无效');
    const capabilities = parseRepairCapabilities(options.repairCapabilities || options.capabilities);
    const sensitive = options.sensitive === true || options.sensitive === 'true';
    if (capabilities.includes('chat2api.accounts') && !sensitive) {
        throw new Error('dataRepair 访问 Chat2API 账号必须通过 --sensitive=true 显式允许');
    }
    const compatibleDataVersions = options.compatibleDataVersions === undefined ? undefined
        : normalizeCompatibleDataVersions(typeof options.compatibleDataVersions === 'string'
            ? options.compatibleDataVersions.split(',').map(Number) : options.compatibleDataVersions, requiredDataVersion, targetDataVersion);
    if (compatibleDataVersions && targetDataVersion <= Math.max(...compatibleDataVersions)) {
        throw new Error('新修复目标数据版本必须高于全部兼容前置版本');
    }
    if (compatibleDataVersions?.length > 1 && options.requiredApkVersionCode === undefined) {
        throw new Error('多前置版本的累计修复必须声明支持它的最低 APK 版本');
    }
    const repairSource = await fs.promises.readFile(repairFile);
    const workDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-data-repair-'));
    const stagingDirectory = path.join(workDirectory, 'data-repair');
    const archivePath = path.join(workDirectory, `data-repair-v${repairVersion}.zip`);
    const finalArchivePath = path.join(outputDir, 'data', path.basename(archivePath));
    try {
        await fs.promises.mkdir(stagingDirectory, { recursive: true });
        await fs.promises.writeFile(path.join(stagingDirectory, DATA_REPAIR_ENTRYPOINT), repairSource, { flag: 'wx' });
        await createZip(stagingDirectory, archivePath, options.zipRunner || execFileAsync);
        if (fs.existsSync(finalArchivePath)) throw new Error(`dataRepair 版本文件已存在，拒绝覆盖: ${finalArchivePath}`);
        const dataRepair = {
            version: repairVersion,
            repairVersion,
            repairId,
            requiredCodeVersion,
            ...(options.requiredApkVersionCode === undefined
                ? {}
                : { requiredApkVersionCode: Number(options.requiredApkVersionCode) }),
            requiredDataVersion,
            targetDataVersion,
            ...(compatibleDataVersions ? { compatibleDataVersions } : {}),
            capabilities,
            sensitive,
            scriptSha256: sha256Buffer(repairSource),
            ...(options.releaseNotes ? { releaseNotes: String(options.releaseNotes).trim() } : {}),
            ...(await describeArtifact(archivePath, `data/data-repair-v${repairVersion}.zip`))
        };
        // 同一脚本先真实修复隔离种子；新 min 首装与完整 APK 使用相同数据基线。
        const seedTransaction = await prepareReleaseRepairs({ projectRoot, outputDir,
            repairs: [{ script: repairFile, metadata: dataRepair }] });
        try {
            const seedVersion = await nextNodeMinSeedVersion(outputDir, Math.max(currentManifest.payload.components.code.version,
                (currentManifest.payload.components.nodeMinSeeds?.version || 0) + 1));
            dataRepair.releaseSeedVersion = seedVersion;
            const seedArchive = path.join(workDirectory, `node-min-seeds-v${seedVersion}.zip`);
            const seedDestination = path.join(outputDir, 'node-min-seeds', path.basename(seedArchive));
            if (fs.existsSync(seedDestination)) throw new Error(`Node min 种子版本已存在: ${seedDestination}`);
            const seedStage = path.join(workDirectory, 'node-min-seeds');
            await stageNodeMinSeeds(path.join(projectRoot, 'release'), seedStage,
                { configReleaseRoot: seedTransaction.releaseRoot });
            await createZip(seedStage, seedArchive, options.zipRunner || execFileAsync);
            if ((await fs.promises.stat(seedArchive)).size > MAX_NODE_MIN_SEEDS_ARCHIVE_BYTES) throw new Error('首装种子包超过大小限制');
            const seedSource = readGitSourceMetadata(projectRoot);
            if (seedSource.gitCommit) seedSource.gitDirty = true; // 种子包含本次暂存修复，尚未提交到来源提交。
            const payload = {
                ...currentManifest.payload,
                generatedAt: options.generatedAt || new Date().toISOString(),
                components: {
                    ...currentManifest.payload.components,
                    dataRepair,
                    nodeMinSeeds: { version: seedVersion, dataVersion: seedTransaction.baseline.dataVersion, source: seedSource,
                        ...(await describeArtifact(seedArchive, `node-min-seeds/${path.basename(seedArchive)}`)) }
                }
            };
            const manifest = {
                payload,
                signature: signManifestPayload(payload, privateKeyPem)
            };
            verifySignedManifest(manifest, publicKeyPem);
            validateManifestComponents(manifest);
            const manifestDirectory = path.join(outputDir, 'manifests');
            const manifestPath = path.join(manifestDirectory, `manifest-data-repair-v${repairVersion}.json`);
            if (fs.existsSync(manifestPath)) throw new Error(`dataRepair 清单文件已存在，拒绝覆盖: ${manifestPath}`);
            const stagedManifest = path.join(workDirectory, 'signed-manifest.json');
            await fs.promises.writeFile(stagedManifest, JSON.stringify(manifest, null, 2) + '\n');
            await seedTransaction.commit([
                { source: archivePath, destination: finalArchivePath },
                { source: seedArchive, destination: seedDestination },
                { source: stagedManifest, destination: manifestPath }
            ], options.beforeSeedCommit);
            return {
                requestedMode: 'data-repair',
                mode: 'data-repair',
                manifest,
                manifestPath,
                dataRepairArchivePath: finalArchivePath,
                nodeMinSeedsArchivePath: seedDestination,
                dataVersion: seedTransaction.baseline.dataVersion,
                publicKeyPem,
                publicKeyPath: keyPair.publicKeyPath
            };
        } finally { await seedTransaction.dispose(); }
    } finally {
        await fs.promises.rm(workDirectory, { recursive: true, force: true });
    }
}

/** 独立任务包与联合服务更新复用相同构建流程；签名之前校验完整候选组合。 */
async function prepareTaskCode(options, projectRoot, workDirectory, outputDir, source) {
    const contract = require('../../src/apps/server/modules/aasc/task-code-contract');
    const version = Number(options.taskCodeVersion);
    assertVersion(version, 'taskCodeVersion');
    const root = path.join(workDirectory, 'task-code');
    const inner = await require('./task-code-package').stageTaskCode(projectRoot, root, version, options);
    const relativeUrl = `task-code/task-code-v${version}.zip`;
    const destination = path.join(outputDir, relativeUrl);
    if (fs.existsSync(destination)) throw new Error(`任务代码包版本已存在，拒绝覆盖: ${destination}`);
    const archive = path.join(workDirectory, `task-code-v${version}.zip`);
    await createZip(root, archive, options.zipRunner || execFileAsync);
    return { archive, destination, component: { version, ...contract.compatibility(inner), source,
        bundleSha256: inner.bundleSha256, ...(await describeArtifact(archive, relativeUrl)) } };
}

async function createTaskCodeArtifacts(options) {
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'release/offline-update/output'));
    const keyPair = await loadOfflineUpdateKeyPair(options);
    const current = await loadCurrentManifest(options, keyPair.publicKeyPem);
    if (!current) throw new Error('独立任务更新必须基于现有签名清单');
    validateManifestComponents(current);
    assertNewVersion(Number(options.taskCodeVersion), current.payload.components.taskCode?.version, 'taskCodeVersion');
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-task-code-'));
    try {
        const staged = await prepareTaskCode(options, projectRoot, work, outputDir, readGitSourceMetadata(projectRoot));
        const payload = { ...current.payload, generatedAt: options.generatedAt || new Date().toISOString(),
            components: { ...current.payload.components, taskCode: staged.component } };
        const manifest = { payload, signature: signManifestPayload(payload, keyPair.privateKeyPem) };
        verifySignedManifest(manifest, keyPair.publicKeyPem);
        validateManifestComponents(manifest);
        const manifestPath = path.join(outputDir, 'manifests', `manifest-task-code-v${staged.component.version}.json`);
        if (fs.existsSync(manifestPath)) throw new Error('任务清单版本已存在');
        await fs.promises.mkdir(path.dirname(staged.destination), { recursive: true });
        await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
        await atomicallyCopyToOutput(staged.archive, staged.destination);
        await atomicallyWriteOutput(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        return { requestedMode: 'task-code-only', mode: 'task-code-only', manifest, manifestPath,
            taskCodeArchivePath: staged.destination, publicKeyPem: keyPair.publicKeyPem, publicKeyPath: keyPair.publicKeyPath };
    } finally { await fs.promises.rm(work, { recursive: true, force: true }); }
}

async function createOfflineUpdateArtifacts(options = {}) {
    const requestedMode = String(options.mode || '').trim();
    if (requestedMode === 'task-code-only') return createTaskCodeArtifacts(options);
    if (requestedMode === 'data-repair') return createDataRepairArtifacts(options);
    if (!['code-only', 'all'].includes(requestedMode)) throw new Error('更新模式必须是 code-only 或 all');
    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const source = readGitSourceMetadata(projectRoot);
    const outputDir = path.resolve(options.outputDir || path.join(projectRoot, 'release/offline-update/output'));
    const codeVersion = Number(options.codeVersion);
    assertVersion(codeVersion, 'codeVersion');

    const keyPair = await loadOfflineUpdateKeyPair(options);
    const { privateKeyPem, publicKeyPem } = keyPair;
    const currentManifest = await loadCurrentManifest(options, publicKeyPem);
    const currentComponents = currentManifest?.payload?.components || {};
    if (currentManifest && currentManifest.payload.schemaVersion !== 1) {
        throw new Error('当前 Offline 更新清单 schemaVersion 不支持');
    }
    assertNewVersion(codeVersion, currentComponents.code?.version, 'codeVersion');
    if (options.taskCodeVersion !== undefined) assertNewVersion(Number(options.taskCodeVersion), currentComponents.taskCode?.version, 'taskCodeVersion');

    const packageLockPath = path.join(projectRoot, 'package-lock.json');
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const [packageJsonText, packageLockBuffer] = await Promise.all([
        fs.promises.readFile(packageJsonPath, 'utf8'),
        fs.promises.readFile(packageLockPath)
    ]);
    const packageJson = JSON.parse(packageJsonText);
    const lockSha256 = sha256Buffer(packageLockBuffer);
    if (!packageJson.dependencies || !Object.keys(packageJson.dependencies).length) {
        throw new Error('服务 package.json 缺少 production dependencies');
    }
    const migratingGroups = !currentComponents.dependencies?.groups;
    const updatePlan = resolveUpdatePlan({
        requestedMode: migratingGroups ? 'all' : requestedMode,
        currentDependencies: currentComponents.dependencies,
        lockSha256,
        dependencyVersion: options.dependencyVersion ?? (migratingGroups ? (currentComponents.dependencies?.version || 0) + 1 : undefined)
    });
    const { mode, dependencyVersion } = updatePlan;
    const autoDependencyUpgrade = updatePlan.autoDependencyUpgrade || (migratingGroups && requestedMode === 'code-only');
    const reuseNodeMinSeeds = options.reuseNodeMinSeeds === true;
    if (reuseNodeMinSeeds && (mode !== 'code-only' || !currentComponents.nodeMinSeeds)) {
        throw new Error('复用 Node min 种子只允许已有种子清单的 code-only 更新');
    }

    const zipRunner = options.zipRunner || execFileAsync;
    const commandRunner = options.commandRunner || execFileAsync;
    const workDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-offline-update-'));
    const stagedCodeArchive = path.join(workDirectory, `code-v${codeVersion}.zip`);
    const stagedNodeMinSeedsDirectory = path.join(workDirectory, 'node-min-seeds');
    const nodeMinSeedVersion = reuseNodeMinSeeds ? currentComponents.nodeMinSeeds.version
        : await nextNodeMinSeedVersion(outputDir, Math.max(codeVersion, (currentComponents.nodeMinSeeds?.version || 0) + 1));
    const stagedNodeMinSeedsArchive = path.join(workDirectory, `node-min-seeds-v${nodeMinSeedVersion}.zip`);
    const nodeMinSeedsArchivePath = path.join(outputDir, 'node-min-seeds', path.basename(stagedNodeMinSeedsArchive));
    let codeArchivePath = null;
    let finalNodeMinSeedsArchivePath = null;
    let finalVoiceDisplayNodeArchivePath = null;
    let finalVoiceDisplayNodeMetadataPath = null;
    try {
        const codeDirectory = path.join(workDirectory, 'code');
        await fs.promises.mkdir(codeDirectory, { recursive: true });
        await copyCodeSnapshot(projectRoot, codeDirectory);
        await createZip(codeDirectory, stagedCodeArchive, zipRunner);
        // 统一出包入口可只构建服务代码；旧入口仍默认附带独立 Node ZIP。
        const stagedVoiceDisplayNode = options.includeVoiceDisplayNode === false ? null : await stageVoiceDisplayNodePackage({
            projectRoot,
            workDirectory,
            outputDir,
            version: codeVersion,
            source,
            privateKeyPem,
            publicKeyPem,
            zipRunner
        });

        if (!reuseNodeMinSeeds) {
            if (fs.existsSync(nodeMinSeedsArchivePath)) {
                throw new Error(`Node min 种子包版本文件已存在，拒绝覆盖: ${nodeMinSeedsArchivePath}`);
            }
            await stageNodeMinSeeds(path.join(projectRoot, 'release'), stagedNodeMinSeedsDirectory);
            await createZip(stagedNodeMinSeedsDirectory, stagedNodeMinSeedsArchive, zipRunner);
            const stagedNodeMinSeedsStat = await fs.promises.stat(stagedNodeMinSeedsArchive);
            if (stagedNodeMinSeedsStat.size > MAX_NODE_MIN_SEEDS_ARCHIVE_BYTES) {
                throw new Error(`Node min 初始数据 ZIP 超过 ${MAX_NODE_MIN_SEEDS_ARCHIVE_BYTES} 字节上限`);
            }
        }

        const codeDestinationDirectory = path.join(outputDir, 'code');
        const codeDestination = path.join(codeDestinationDirectory, path.basename(stagedCodeArchive));
        if (fs.existsSync(codeDestination)) throw new Error(`代码包版本文件已存在，拒绝覆盖: ${codeDestination}`);
        await fs.promises.mkdir(codeDestinationDirectory, { recursive: true });

        let stagedDependencies = null;
        if (mode === 'all') {
            let dependencyRoots = options.dependencyRoots;
            if (typeof dependencyRoots === 'string') dependencyRoots = JSON.parse(await fs.promises.readFile(dependencyRoots, 'utf8'));
            stagedDependencies = await buildDependencyGroups({ projectRoot, workDirectory, dependencyVersion, lockSha256,
                source, outputDir, currentArtifactRoot: options.currentArtifactRoot, currentDependencies: currentComponents.dependencies,
                currentTaskDependencies: currentComponents.taskDependencies, commandRunner, dependencyRoots, nodeAbi: options.nodeAbi });
            for (const artifact of stagedDependencies.artifacts) {
                if (!artifact.reused && fs.existsSync(path.join(outputDir, artifact.relativeUrl))) throw new Error(`依赖组版本已存在，拒绝覆盖：${artifact.relativeUrl}`);
            }
        }

        const payload = {
            schemaVersion: 1,
            generatedAt: options.generatedAt || new Date().toISOString(),
            components: {
                ...currentComponents,
                code: {
                    version: codeVersion,
                    taskCodeApiVersion: 1,
                    requiredDependencyVersion: dependencyVersion,
                    requiredLockSha256: lockSha256,
                    runtimeCompatibility: RUNTIME_COMPATIBILITY,
                    source,
                    ...(await describeArtifact(stagedCodeArchive, `code/${path.basename(codeDestination)}`))
                },
                nodeMinSeeds: reuseNodeMinSeeds ? currentComponents.nodeMinSeeds : {
                    version: nodeMinSeedVersion,
                    source,
                    ...(await describeArtifact(stagedNodeMinSeedsArchive, `node-min-seeds/${path.basename(nodeMinSeedsArchivePath)}`))
                }
            }
        };
        if (mode === 'all') {
            payload.components.dependencies = stagedDependencies.dependencies;
            payload.components.taskDependencies = stagedDependencies.taskDependencies;
        }

        const stagedTaskCode = options.taskCodeVersion === undefined ? null
            : await prepareTaskCode(options, projectRoot, workDirectory, outputDir, source);
        if (stagedTaskCode) payload.components.taskCode = stagedTaskCode.component;

        const manifest = {
            payload,
            signature: signManifestPayload(payload, privateKeyPem)
        };
        verifySignedManifest(manifest, publicKeyPem);
        validateManifestComponents(manifest);
        const manifestDirectory = path.join(outputDir, 'manifests');
        const manifestPath = path.join(manifestDirectory, `manifest-code-v${codeVersion}.json`);
        if (fs.existsSync(manifestPath)) throw new Error(`更新清单版本文件已存在，拒绝覆盖: ${manifestPath}`);

        await atomicallyCopyToOutput(stagedCodeArchive, codeDestination);
        if (stagedVoiceDisplayNode) {
            await fs.promises.mkdir(path.dirname(stagedVoiceDisplayNode.archiveDestination), { recursive: true });
            await atomicallyCopyToOutput(stagedVoiceDisplayNode.archivePath, stagedVoiceDisplayNode.archiveDestination);
            await atomicallyCopyToOutput(stagedVoiceDisplayNode.metadataPath, stagedVoiceDisplayNode.metadataDestination);
            finalVoiceDisplayNodeArchivePath = stagedVoiceDisplayNode.archiveDestination;
            finalVoiceDisplayNodeMetadataPath = stagedVoiceDisplayNode.metadataDestination;
        }
        if (stagedTaskCode) {
            await fs.promises.mkdir(path.dirname(stagedTaskCode.destination), { recursive: true });
            await atomicallyCopyToOutput(stagedTaskCode.archive, stagedTaskCode.destination);
        }
        codeArchivePath = codeDestination;
        if (!reuseNodeMinSeeds) {
            await fs.promises.mkdir(path.dirname(nodeMinSeedsArchivePath), { recursive: true });
            await atomicallyCopyToOutput(stagedNodeMinSeedsArchive, nodeMinSeedsArchivePath);
            finalNodeMinSeedsArchivePath = nodeMinSeedsArchivePath;
        }
        if (mode === 'all') {
            for (const artifact of stagedDependencies.artifacts) {
                const destination = path.join(outputDir, artifact.relativeUrl);
                await fs.promises.mkdir(path.dirname(destination), { recursive: true });
                await atomicallyCopyToOutput(artifact.archivePath, destination);
            }
        }
        await fs.promises.mkdir(manifestDirectory, { recursive: true });
        await atomicallyWriteOutput(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        return {
            requestedMode,
            mode,
            autoDependencyUpgrade,
            manifest,
            manifestPath,
            codeArchivePath,
            voiceDisplayNodeArchivePath: finalVoiceDisplayNodeArchivePath,
            voiceDisplayNodeMetadataPath: finalVoiceDisplayNodeMetadataPath,
            taskCodeArchivePath: stagedTaskCode?.destination || null,
            nodeMinSeedsArchivePath: finalNodeMinSeedsArchivePath,
            dependenciesArchivePath: null,
            dependencyArtifacts: stagedDependencies?.artifacts.map(artifact => path.join(outputDir, artifact.relativeUrl)) || [],
            publicKeyPem,
            publicKeyPath: keyPair.publicKeyPath
        };
    } catch (error) {
        throw new Error(`生成 Offline 更新包失败: ${error.message}`, { cause: error });
    } finally {
        await fs.promises.rm(workDirectory, { recursive: true, force: true });
    }
}

function parseCliArguments(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`不支持的位置参数: ${token}`);
        const equalIndex = token.indexOf('=');
        const key = equalIndex >= 0 ? token.slice(2, equalIndex) : token.slice(2);
        if (key === 'bootstrap') {
            if (equalIndex >= 0) throw new Error('参数 --bootstrap 不接收值');
            if (Object.hasOwn(parsed, 'bootstrap')) throw new Error('参数 --bootstrap 不能重复');
            parsed.bootstrap = true;
            continue;
        }
        const value = equalIndex >= 0 ? token.slice(equalIndex + 1) : argv[++index];
        if (!['mode', 'code-version', 'dependency-version', 'task-code-version', 'output-dir', 'manifest-file',
            'data-repair-file', 'repair-version', 'repair-id', 'required-code-version',
            'required-apk-version-code', 'required-data-version', 'target-data-version', 'compatible-data-versions',
            'repair-capabilities', 'release-notes', 'sensitive', 'reuse-node-min-seeds', 'include-voice-display-node',
            'dependency-roots', 'current-artifact-root', 'node-abi'].includes(key)) {
            throw new Error(`未知构建参数: --${key}`);
        }
        if (typeof value !== 'string' || value.startsWith('--')) throw new Error(`参数 --${key} 缺少值`);
        const fieldName = key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        if (Object.prototype.hasOwnProperty.call(parsed, fieldName)) throw new Error(`参数 --${key} 不能重复`);
        const numericKeys = new Set([
            'task-code-version',
            'code-version',
            'dependency-version',
            'repair-version',
            'required-code-version',
            'required-apk-version-code',
            'required-data-version',
            'target-data-version'
        ]);
        parsed[fieldName] = numericKeys.has(key) ? Number(value) :
            key === 'sensitive' || key === 'reuse-node-min-seeds' || key === 'include-voice-display-node' ? value === 'true' : value;
    }
    return parsed;
}

async function runCli(argv = process.argv.slice(2)) {
    try {
        const cliOptions = parseCliArguments(argv);
        if (cliOptions.bootstrap && cliOptions.mode !== 'all') {
            throw new Error('--bootstrap 仅允许和 --mode=all 一起使用');
        }
        const currentManifest = cliOptions.manifestFile
            ? await readManifest(path.resolve(cliOptions.manifestFile))
            : cliOptions.bootstrap ? null : await fetchCurrentManifestFromNetwork();
        delete cliOptions.manifestFile;
        delete cliOptions.bootstrap;
        const projectRoot = path.resolve(__dirname, '../..');
        const result = await createOfflineUpdateArtifacts({
            ...cliOptions,
            currentManifest,
            projectRoot
        });
        console.log(`请求模式: ${result.requestedMode}`);
        console.log(`实际模式: ${result.mode}`);
        if (result.autoDependencyUpgrade) {
            console.log('检测到 package-lock.json 指纹变化，已自动生成新的 dependencies 包');
        }
        if (result.codeArchivePath) console.log(`代码包: ${result.codeArchivePath}`);
        if (result.voiceDisplayNodeArchivePath) console.log(`Node 子显示端独立 ZIP: ${result.voiceDisplayNodeArchivePath}`);
        if (result.voiceDisplayNodeMetadataPath) console.log(`Node 子显示端签名元数据: ${result.voiceDisplayNodeMetadataPath}`);
        if (result.taskCodeArchivePath) console.log(`任务代码包: ${result.taskCodeArchivePath}`);
        if (result.nodeMinSeedsArchivePath) console.log(`Node min 初始配置和任务包: ${result.nodeMinSeedsArchivePath}`);
        for (const file of result.dependencyArtifacts || []) console.log(`依赖组: ${file}`);
        if (result.dataRepairArchivePath) console.log(`数据修复包: ${result.dataRepairArchivePath}`);
        console.log(`签名清单: ${result.manifestPath}`);
        console.log(`验证公钥: ${result.publicKeyPath || '由调用方提供'}`);
    } catch (error) {
        console.error(`Offline 更新包构建失败: ${error.message}`);
        process.exitCode = 1;
    }
}

if (require.main === module) runCli();

module.exports = {
    createOfflineUpdateArtifacts,
    createDataRepairArtifacts,
    canonicalJson,
    signManifestPayload,
    validateSignedManifestEnvelope,
    verifySignedManifest,
    validateManifestComponents,
    publicKeyFromPrivateKey,
    sha256Buffer,
    UPDATE_BASE_URLS,
    fetchCurrentManifestFromNetwork,
    resolveUpdatePlan,
    validateDataRepairComponent,
    parseCliArguments,
    runCli,
    HOME_LAN_UPDATE_BASE_URL,
    COMPANY_LAN_UPDATE_BASE_URL,
    WAN_UPDATE_BASE_URL
};
