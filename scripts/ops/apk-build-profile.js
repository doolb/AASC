'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APK_PROFILES = Object.freeze({
    noserver: Object.freeze({ offline: false, embeddedNode: false }),
    withserver: Object.freeze({ offline: false, embeddedNode: true }),
    allserver: Object.freeze({ offline: true, embeddedNode: true }),
    'allserver-min': Object.freeze({ offline: true, embeddedNode: true, updateOnly: true })
});

function assertStringArray(value, fieldName, profileName) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
        throw new Error(`${profileName}/app.json 的 ${fieldName} 必须是非空字符串数组`);
    }
    const normalized = value.map((item) => item.trim());
    if (new Set(normalized).size !== normalized.length) {
        throw new Error(`${profileName}/app.json 的 ${fieldName} 不能重复`);
    }
    return normalized;
}

async function loadApkProfile(options = {}) {
    const profileName = String(options.profile || '').trim();
    const profileRules = APK_PROFILES[profileName];
    if (!profileRules) throw new Error(`未知 APK profile: ${profileName || '(空)'}`);

    const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '../..'));
    const buildRoot = path.join(projectRoot, 'release', 'apkbuild', profileName);
    const appConfigFile = path.join(buildRoot, 'app.json');
    let rawProfile;
    try {
        rawProfile = JSON.parse(await fs.promises.readFile(appConfigFile, 'utf8'));
    } catch (error) {
        throw new Error(`读取 APK profile 配置失败: ${appConfigFile}: ${error.message}`);
    }
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
        throw new Error(`APK profile 配置必须是对象: ${appConfigFile}`);
    }
    if (rawProfile.schemaVersion !== 1) {
        throw new Error(`APK profile schemaVersion 必须为 1: ${appConfigFile}`);
    }
    if (typeof rawProfile.embeddedNode !== 'boolean') {
        throw new Error(`APK profile embeddedNode 必须是布尔值: ${appConfigFile}`);
    }
    if (rawProfile.embeddedNode !== profileRules.embeddedNode) {
        throw new Error(`${profileName} profile 的 embeddedNode 必须为 ${profileRules.embeddedNode}`);
    }
    const features = assertStringArray(rawProfile.features, 'features', profileName);
    const models = assertStringArray(rawProfile.models, 'models', profileName);
    if (rawProfile.updateOnly !== undefined && typeof rawProfile.updateOnly !== 'boolean') {
        throw new Error(`${profileName}/app.json 的 updateOnly 必须为布尔值`);
    }
    const updateOnly = rawProfile.updateOnly === true;
    const versionCode = rawProfile.versionCode === undefined ? 1 : rawProfile.versionCode;
    const versionName = rawProfile.versionName === undefined ? '0.1.0' : rawProfile.versionName;
    const rawServiceVersions = rawProfile.serviceVersions === undefined
        ? { codeVersion: 1, dependencyVersion: 1 }
        : rawProfile.serviceVersions;
    if (!rawServiceVersions || typeof rawServiceVersions !== 'object' || Array.isArray(rawServiceVersions)) {
        throw new Error(`${profileName}/app.json 的 serviceVersions 必须是对象`);
    }
    const serviceVersions = {
        codeVersion: rawServiceVersions.codeVersion,
        dependencyVersion: rawServiceVersions.dependencyVersion
    };
    for (const [name, value] of Object.entries(serviceVersions)) {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new Error(`${profileName}/app.json 的 serviceVersions.${name} 必须是正整数`);
        }
    }
    if (updateOnly !== (profileRules.updateOnly === true)) {
        throw new Error(`${profileName} profile 的 updateOnly 必须为 ${profileRules.updateOnly === true}`);
    }
    if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
        throw new Error(`${profileName}/app.json 的 versionCode 必须是大于 0 的安全整数`);
    }
    if (typeof versionName !== 'string' || versionName.trim() === '') {
        throw new Error(`${profileName}/app.json 的 versionName 必须是非空字符串`);
    }
    const verifyRuntime = rawProfile.verifyRuntime === undefined ? true : rawProfile.verifyRuntime;
    if (typeof verifyRuntime !== 'boolean') {
        throw new Error(`${profileName}/app.json 的 verifyRuntime 必须为布尔值`);
    }
    if (!rawProfile.embeddedNode && models.length > 0) {
        throw new Error(`${profileName} profile 不允许配置 models；noserver 不内置 Node Runtime 和模型`);
    }
    if (updateOnly && models.length > 0) {
        throw new Error(`${profileName} update-only profile 不允许内置模型`);
    }

    return {
        profile: profileName,
        offline: profileRules.offline,
        embeddedNode: rawProfile.embeddedNode,
        updateOnly,
        versionCode,
        versionName: versionName.trim(),
        serviceVersions,
        features,
        models,
        verifyRuntime,
        buildRoot
    };
}

function isExcludedModelPath(relativePath) {
    const segments = relativePath.split(path.sep);
    return segments.includes('test_wavs')
        || segments.includes('results')
        || segments.some((segment) => segment === '.mmap' || segment.startsWith('.mmap.') ||
            segment.endsWith('.mmap') || segment.includes('.mmap.'));
}

function assertModelRelativePath(relativePath) {
    const normalized = path.normalize(relativePath);
    if (path.isAbsolute(relativePath) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
        throw new Error(`模型 manifest 文件路径不安全: ${relativePath}`);
    }
}

async function collectDirectoryFiles(rootDir, relativeDir, files = []) {
    const currentDir = path.join(rootDir, relativeDir);
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
        const relativePath = path.join(relativeDir, entry.name);
        assertModelRelativePath(relativePath);
        // 空模型目录使用 .gitkeep 保持在 Git 中，但它不是模型文件；如果把它
        // 写进离线模型 manifest，Android AssetManager 过滤隐藏文件后会造成清单不一致。
        if (entry.name === '.gitkeep') continue;
        if (isExcludedModelPath(relativePath)) continue;
        if (entry.isSymbolicLink()) {
            throw new Error(`模型目录不允许符号链接: ${relativePath}`);
        }
        if (entry.isDirectory()) {
            await collectDirectoryFiles(rootDir, relativePath, files);
            continue;
        }
        if (!entry.isFile()) throw new Error(`模型目录包含不支持的文件类型: ${relativePath}`);
        files.push(relativePath);
    }
    return files;
}

async function readLlmManifest(modelRoot) {
    const manifestRelativePath = path.join('llm', 'manifest.json');
    const manifestPath = path.join(modelRoot, manifestRelativePath);
    try {
        const source = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        if (!source || !Array.isArray(source.models)) throw new Error('models 必须是数组');
        return source.models;
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw new Error(`读取 LLM 模型 manifest 失败: ${manifestPath}: ${error.message}`);
    }
}

async function resolveSelectedModelFiles(options = {}) {
    const modelRoot = path.resolve(options.modelRoot || '');
    const modelIds = Array.isArray(options.modelIds) ? options.modelIds : [];
    if (modelIds.length === 0) return [];
    let llmModels = [];
    let llmManifestError = null;
    try {
        llmModels = await readLlmManifest(modelRoot);
    } catch (error) {
        llmManifestError = error;
    }
    const llmById = new Map(llmModels.map((model) => [model?.modelId, model]));
    const files = new Map();

    const addFile = async (relativePath) => {
        assertModelRelativePath(relativePath);
        if (isExcludedModelPath(relativePath) || files.has(relativePath)) return;
        const sourcePath = path.join(modelRoot, relativePath);
        let stat;
        try {
            stat = await fs.promises.lstat(sourcePath);
        } catch (error) {
            throw new Error(`模型文件不存在: ${relativePath}`);
        }
        if (!stat.isFile()) throw new Error(`模型路径不是普通文件: ${relativePath}`);
        files.set(relativePath, { relativePath, sourcePath });
    };

    for (const modelId of modelIds) {
        const normalizedId = typeof modelId === 'string' ? modelId.trim() : '';
        if (!normalizedId) throw new Error('模型 ID 不能为空');
        const llmModel = llmById.get(normalizedId);
        if (llmModel) {
            const directory = typeof llmModel.directory === 'string' ? llmModel.directory.trim() : '';
            if (!directory) throw new Error(`LLM 模型缺少 directory: ${normalizedId}`);
            assertModelRelativePath(path.join('llm', directory));
            await addFile(path.join('llm', 'manifest.json'));
            const markerPath = path.join('llm', directory, '.manifest.json');
            if (fs.existsSync(path.join(modelRoot, markerPath))) await addFile(markerPath);
            const declaredFiles = Array.isArray(llmModel.files) ? llmModel.files : [];
            if (declaredFiles.length === 0) throw new Error(`LLM 模型没有声明文件: ${normalizedId}`);
            for (const file of declaredFiles) {
                if (!file || typeof file.name !== 'string' || file.name.trim() === '') {
                    throw new Error(`LLM 模型文件声明无效: ${normalizedId}`);
                }
                await addFile(path.join('llm', directory, file.name.trim()));
            }
            continue;
        }

        const directoryPath = path.join(modelRoot, normalizedId);
        try {
            const stat = await fs.promises.lstat(directoryPath);
            if (!stat.isDirectory()) throw new Error('不是目录');
        } catch (error) {
            if (llmManifestError) throw llmManifestError;
            throw new Error(`未知模型 ID ${normalizedId}，未找到对应模型目录或 LLM manifest: ${modelRoot}`);
        }
        const directoryFiles = await collectDirectoryFiles(modelRoot, normalizedId);
        for (const relativePath of directoryFiles) await addFile(relativePath);
    }

    return [...files.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

module.exports = {
    APK_PROFILES,
    isExcludedModelPath,
    loadApkProfile,
    resolveSelectedModelFiles
};
