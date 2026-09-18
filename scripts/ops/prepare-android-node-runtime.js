'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadOfflineUpdatePublicKey } = require('./offline-update-signing');

const ANDROID_ABI = 'arm64-v8a';
const DEFAULT_RUNTIME_DIR = path.resolve(__dirname, '../../3rd/android-node-runtime', ANDROID_ABI);
const NODE_LIBRARY_NAME = 'libaasc_node.so';
const NODE_LIBRARY_PATH = `native/${ANDROID_ABI}/${NODE_LIBRARY_NAME}`;
const REQUIRED_RUNTIME_LIBRARIES = Object.freeze([
    'libz.so.1',
    'libcares.so',
    'libsqlite3.so',
    'libffi.so',
    'libcrypto.so.3',
    'libssl.so.3',
    'libicui18n.so.78',
    'libicuuc.so.78',
    'libicudata.so.78'
]);
const REQUIRED_PACKAGE_ENTRIES = [
    'src/apps/server/boot/server-launcher.js',
    'package.json',
    'package-lock.json'
];
const CERTIFICATE_ENTRIES = ['cert.pem', 'key.pem'];
const RUNTIME_MODE_FILE = 'runtime-mode.txt';
const OFFLINE_MODEL_METADATA_FILE = 'offline-model-manifest.json';
const DISPLAY_MODEL_ASSET_PREFIX = 'display-models';
const APK_PROFILE_METADATA_FILE = 'apk-profile.json';
const OFFLINE_CONFIG_SEED_FILE = 'offline-config.json';
const RELEASE_CONFIG_SEED_FILE = 'release-config.json';
const RELEASE_USER_CONFIG_PREFIX = 'release-userconfig';
const TASK_LINKS_MARKER_FILE = 'task-links.marker';
const TASK_LATEST_MARKER_FILE = 'latest.marker';
// Android aapt/AssetManager 不保证隐藏文件进入 assets；Pi SDK 的 Provider manifest
// 必须在安装后恢复到原始文件名，因此先使用不带点号的安全 marker。
const ANDROID_HIDDEN_MANIFEST_MARKER = 'aasc-bundled-manifest.json';
const { resolveSelectedModelFiles } = require('./apk-build-profile');
// 历史兼容测试使用的模型列表。正式 profile 构建通过 model ID 和 manifest 解析文件，
// 此常量仅保留导出，避免破坏旧调用方，不参与新的 release APK 资源选择。
const OFFLINE_MODEL_FILES = Object.freeze([
    'llm/manifest.json',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/.manifest.json',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/config.json',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/configuration.json',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/llm.mnn',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/llm.mnn.json',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/llm.mnn.weight',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/llm_config.json',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/tokenizer.txt',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/visual.mnn',
    'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/visual.mnn.weight',
    'sensevoice/model.int8.onnx',
    'sensevoice/model.int8.onnx.sha256',
    'sensevoice/tokens.txt',
    'sensevoice/tokens.txt.sha256',
    'streaming-zipformer/encoder.int8.onnx',
    'streaming-zipformer/decoder.int8.onnx',
    'streaming-zipformer/joiner.int8.onnx',
    'streaming-zipformer/tokens.txt',
    'voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    'voiceprint/pyannote_segmentation_3_0_int8.onnx',
    'speech-enhancement/gtcrn_simple.onnx',
    'tts/2052.INI',
    'tts/MSTTSLocEnUS.dat',
    'tts/MSTTSLocZhCN.dat',
    'tts/MSTTSLocZhCN.ini',
    'tts/Tokens.xml',
    'tts/ZhCN.address.dat',
    'tts/ZhCN.message.dat',
    'tts/ZhCN.mixlingual.dat',
    'tts/ZhCN.name.dat',
    'tts/am_v5_decoder.bin',
    'tts/am_v5_encoder.bin',
    'tts/device_vocoder_v6_streaming.bin',
    'tts/manifest.json',
    'tts/phones.txt',
    'tts/punc.txt',
    'rapidocr/PP-OCRv6_det_small.onnx',
    'rapidocr/PP-OCRv6_rec_small.onnx',
    'rapidocr/ch_ppocr_mobile_v2.0_cls_mobile.onnx',
    'rapidocr/ppocrv6_dict.txt',
    'yolo11/yolo11n.onnx',
    'yolo11/yolo11n.classes.json'
]);

function resolveRequiredDirectory(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label} 未配置`);
    }
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error(`${label} 不存在: ${resolved}`);
    }
    return resolved;
}

function assertRuntimeLibraries(runtimeDir) {
    const libraryDir = path.join(runtimeDir, 'lib');
    let libraryStat;
    try {
        libraryStat = fs.lstatSync(libraryDir);
    } catch {
        throw new Error(`Android Node Runtime 缺少动态库目录: lib（至少需要 ${REQUIRED_RUNTIME_LIBRARIES[0]}）`);
    }
    if (!libraryStat.isDirectory()) {
        throw new Error('Android Node Runtime 动态库目录不是目录: lib');
    }
    for (const libraryName of REQUIRED_RUNTIME_LIBRARIES) {
        const libraryPath = path.join(libraryDir, libraryName);
        let libraryFileStat;
        try {
            libraryFileStat = fs.lstatSync(libraryPath);
        } catch {
            throw new Error(`Android Node Runtime 动态库缺少文件: ${libraryName}`);
        }
        if (!libraryFileStat.isFile()) {
            throw new Error(`Android Node Runtime 动态库不是普通文件: ${libraryName}`);
        }
    }
}

function assertSafeRelativePath(relativePath) {
    const normalized = path.normalize(relativePath);
    if (path.isAbsolute(relativePath) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
        throw new Error(`发现不安全的资产路径: ${relativePath}`);
    }
}

function isNpmToolShim(relativePath) {
    return relativePath.split(path.sep).includes('.bin');
}

function isNpmInternalMetadata(relativePath) {
    const segments = relativePath.split(path.sep);
    return segments.at(-1) === '.package-lock.json' && segments.at(-2) === 'node_modules';
}

function isAndroidAssetExcluded(relativePath, isDirectory = false) {
    const segments = relativePath.split(path.sep);
    // 只有目录名会影响 Android AssetManager 的遍历；Node 依赖中存在大量以下划线
    // 开头的合法 JavaScript 文件（例如 readable-stream/lib/_stream_readable.js），
    // 不能按文件名过滤，否则运行时会出现 MODULE_NOT_FOUND。
    const directorySegments = isDirectory ? segments : segments.slice(0, -1);
    const hasUnsupportedDirectory = directorySegments.some(
        segment => segment.startsWith('.') || segment.startsWith('_')
    );
    const isHiddenFile = !isDirectory && segments.at(-1)?.startsWith('.');
    const isNodeModuleManifest = !isDirectory && segments.includes('node_modules') &&
        segments.at(-1) === '.manifest.json';
    if (isNodeModuleManifest) return hasUnsupportedDirectory;
    return hasUnsupportedDirectory || isHiddenFile;
}

async function listFiles(sourceRoot, relativePath = '') {
    const currentPath = path.join(sourceRoot, relativePath);
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const childRelativePath = path.join(relativePath, entry.name);
        assertSafeRelativePath(childRelativePath);
        // aapt2/AssetManager 会过滤隐藏路径以及 npm/Pixi 的下划线生成目录；
        // 这些文件不会进入 APK，必须同步从 manifest 排除，避免安装时校验落空。
        if (isAndroidAssetExcluded(childRelativePath, entry.isDirectory())) continue;
        // npm v7+ 会在每个 node_modules 根目录生成隐藏的内部锁文件；它不参与
        // Node.js 运行，且 Android AssetManager/Gradle 不保证打包隐藏文件。
        if (isNpmInternalMetadata(childRelativePath)) continue;
        if (entry.isSymbolicLink()) {
            // npm 会在每级 node_modules/.bin 创建指向包内脚本的软链接；APK
            // 节点不执行 npm CLI，因此安全地跳过这些工具入口，避免把软链接
            // 原样写进 assets。其他软链接仍全部拒绝，防止代码包越界读取。
            if (isNpmToolShim(childRelativePath)) continue;
            throw new Error(`服务器运行包不允许符号链接: ${childRelativePath}`);
        }
        if (entry.isDirectory()) {
            files.push(...await listFiles(sourceRoot, childRelativePath));
            continue;
        }
        if (!entry.isFile()) {
            throw new Error(`服务器运行包包含不支持的文件类型: ${childRelativePath}`);
        }
        files.push(childRelativePath);
    }

    return files;
}

async function copyFileWithManifest(sourceRoot, relativePath, outputRoot, outputRelativePath = relativePath) {
    assertSafeRelativePath(relativePath);
    assertSafeRelativePath(outputRelativePath);
    const sourcePath = path.join(sourceRoot, relativePath);
    const outputPath = path.join(outputRoot, outputRelativePath);
    const outputParent = path.dirname(outputPath);
    await fs.promises.mkdir(outputParent, { recursive: true });
    await fs.promises.copyFile(sourcePath, outputPath);
    if (outputRelativePath.endsWith('/node') || outputRelativePath === 'runtime/arm64-v8a/node') {
        await fs.promises.chmod(outputPath, 0o755);
    }
    const content = await fs.promises.readFile(outputPath);
    return {
        path: outputRelativePath.split(path.sep).join('/'),
        size: content.length,
        sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
}

async function copyOfflineModels(modelRoot, outputRoot, modelIds = []) {
    const serverFiles = [];
    const modelAssets = [];
    const bundledModels = new Map();
    const definitions = await readOfflineLlmDefinitions(modelRoot);
    const selectedFiles = await resolveSelectedModelFiles({ modelRoot, modelIds });
    for (const { relativePath } of selectedFiles) {
        const modelPath = parseOfflineLlmModelPath(relativePath);
        if (!modelPath) {
            serverFiles.push(await copyFileWithManifest(
                modelRoot,
                relativePath,
                outputRoot,
                offlineModelAssetPath(relativePath)
            ));
            continue;
        }
        const definition = definitions.get(modelPath.modelDirectory);
        const modelId = definition?.modelId || modelPath.modelDirectory;
        const outputRelativePath = modelPath.isMarker
            ? path.join(DISPLAY_MODEL_ASSET_PREFIX, modelId, 'bundled-manifest.json')
            : path.join(DISPLAY_MODEL_ASSET_PREFIX, modelId, modelPath.filename);
        const file = await copyFileWithManifest(
            modelRoot,
            relativePath,
            outputRoot,
            outputRelativePath
        );
        modelAssets.push(file);
        if (!modelPath.isMarker) {
            const model = bundledModels.get(modelId) || {
                modelId,
                revision: definition?.revision || modelId,
                assetPrefix: path.join(DISPLAY_MODEL_ASSET_PREFIX, modelId).split(path.sep).join('/'),
                files: []
            };
            model.files.push({
                name: modelPath.filename,
                assetPath: file.path,
                size: file.size,
                sha256: file.sha256
            });
            bundledModels.set(modelId, model);
        }
    }
    return {
        files: serverFiles,
        modelAssets,
        models: [...bundledModels.values()].sort((left, right) => left.modelId.localeCompare(right.modelId))
    };
}

function parseOfflineLlmModelPath(relativePath) {
    const normalizedPath = relativePath.split(path.sep).join('/');
    const segments = normalizedPath.split('/');
    if (segments[0] !== 'llm' || segments.length < 3 || segments[1] === 'manifest.json') return null;
    const modelDirectory = segments[1];
    const filename = segments.slice(2).join('/');
    return {
        modelDirectory,
        filename,
        isMarker: filename === '.manifest.json'
    };
}

async function readOfflineLlmDefinitions(modelRoot) {
    const manifestPath = path.join(modelRoot, 'llm', 'manifest.json');
    try {
        const source = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        const definitions = new Map();
        for (const definition of Array.isArray(source?.models) ? source.models : []) {
            if (!definition || typeof definition !== 'object') continue;
            const directory = typeof definition.directory === 'string'
                ? definition.directory.trim()
                : '';
            const modelId = typeof definition.modelId === 'string'
                ? definition.modelId.trim()
                : '';
            if (directory && modelId) definitions.set(directory, {
                ...definition,
                modelId
            });
        }
        return new Map([...definitions.values()].map((definition) => [
            definition.directory,
            definition
        ]));
    } catch (error) {
        // 模型文件白名单仍由 resolveSelectedModelFiles 负责；这里的定义仅用于补充
        // bundled metadata。旧构建输入可能只有目录白名单或没有可解析的 manifest，
        // 此时使用目录名作为稳定 modelId，不能阻断非 LLM 离线资源打包。
        return new Map();
    }
}

// aapt/AssetManager 不保留隐藏文件；将模型缓存 marker 改成可打包名称，安装器再恢复运行时约定的 .manifest.json。
function offlineModelAssetPath(relativePath) {
    const outputPath = path.join('server', 'res', 'models', relativePath);
    return relativePath.endsWith('/.manifest.json')
        ? path.join(path.dirname(outputPath), 'bundled-manifest.json')
        : outputPath;
}

async function listOfflineTaskFiles(sourceRoot, relativePath = '') {
    const currentPath = path.join(sourceRoot, relativePath);
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const childRelativePath = path.join(relativePath, entry.name);
        assertSafeRelativePath(childRelativePath);
        // Android AssetManager 不支持隐藏文件和以下划线开头的目录；任务链和 latest
        // 通过下方 marker 单独打包，普通 results 文件必须保留用于首次恢复服务实例。
        if (entry.name === '.task-links.json') continue;
        const pathSegments = childRelativePath.split(path.sep);
        // latest 可能来自不同平台的任务结果同步：软链接和文本实例 ID 都只作为
        // 输入 marker 处理，不能把原始文件写入 APK，否则会阻止安装器创建软链接。
        if (entry.name === 'latest' && pathSegments.at(-2) === 'results') continue;
        if (isAndroidAssetExcluded(childRelativePath, entry.isDirectory())) continue;
        if (entry.isSymbolicLink()) {
            throw new Error(`离线任务目录不允许符号链接: ${childRelativePath}`);
        }
        if (entry.isDirectory()) {
            files.push(...await listOfflineTaskFiles(sourceRoot, childRelativePath));
            continue;
        }
        if (!entry.isFile()) {
            throw new Error(`离线任务目录包含不支持的文件类型: ${childRelativePath}`);
        }
        files.push(childRelativePath);
    }

    return files;
}

function normalizeTaskInstanceId(value) {
    const instanceId = typeof value === 'string' ? value.trim() : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(instanceId)) {
        throw new Error(`任务结果 latest 指向了不安全的实例 ID: ${value}`);
    }
    return instanceId;
}

async function validateTaskResultIndexes(taskRoot) {
    const taskEntries = await fs.promises.readdir(taskRoot, { withFileTypes: true });
    for (const taskEntry of taskEntries) {
        if (!taskEntry.isDirectory() || taskEntry.name.startsWith('.') || taskEntry.name.startsWith('_')) continue;
        const resultsDir = path.join(taskRoot, taskEntry.name, 'results');
        if (!fs.existsSync(resultsDir)) continue;
        const indexPath = path.join(resultsDir, 'index.json');
        let index;
        try {
            index = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'));
        } catch (error) {
            throw new Error(`任务 results/index.json 无法解析: ${indexPath}: ${error.message}`);
        }
        if (!index || typeof index !== 'object' || !Array.isArray(index.instances)) {
            throw new Error(`任务 results/index.json 必须包含 instances 数组: ${indexPath}`);
        }
        for (const instance of index.instances) {
            if (!instance || typeof instance !== 'object' ||
                typeof instance.instanceId !== 'string' || instance.instanceId.trim() === '' ||
                typeof instance.status !== 'string' || instance.status.trim() === '') {
                throw new Error(`任务 results/index.json 实例缺少 instanceId 或 status: ${indexPath}`);
            }
            normalizeTaskInstanceId(instance.instanceId);
        }
    }
}

async function copyTaskMarkers(taskRoot, outputRoot) {
    const files = [];
    const taskLinksPath = path.join(taskRoot, '.task-links.json');
    if (fs.existsSync(taskLinksPath)) {
        let taskLinks;
        try {
            taskLinks = JSON.parse(await fs.promises.readFile(taskLinksPath, 'utf8'));
        } catch (error) {
            throw new Error(`任务链文件无法解析: ${taskLinksPath}: ${error.message}`);
        }
        if (!taskLinks || typeof taskLinks !== 'object' || Array.isArray(taskLinks)) {
            throw new Error(`任务链文件必须是 JSON 对象: ${taskLinksPath}`);
        }
        files.push(await writeGeneratedFileWithManifest(
            outputRoot,
            path.join('server', 'res', 'tasks', TASK_LINKS_MARKER_FILE),
            JSON.stringify(taskLinks, null, 2) + '\n'
        ));
    }

    const taskEntries = await fs.promises.readdir(taskRoot, { withFileTypes: true });
    for (const taskEntry of taskEntries) {
        if (!taskEntry.isDirectory() || taskEntry.name.startsWith('.') || taskEntry.name.startsWith('_')) continue;
        const resultsDir = path.join(taskRoot, taskEntry.name, 'results');
        const latestPath = path.join(resultsDir, 'latest');
        let target;
        try {
            const latestStat = await fs.promises.lstat(latestPath);
            if (latestStat.isSymbolicLink()) {
                target = await fs.promises.readlink(latestPath);
            } else if (latestStat.isFile()) {
                // Windows/同步目录可能把 latest 软链接降级为文本文件，内容仍是实例 ID。
                target = await fs.promises.readFile(latestPath, 'utf8');
            } else {
                throw new Error('latest 不是软链接或普通文件');
            }
        } catch (error) {
            if (error.code === 'ENOENT') continue;
            throw new Error(`任务 latest marker 无法读取: ${latestPath}: ${error.message}`);
        }
        const instanceId = normalizeTaskInstanceId(target);
        const targetPath = path.resolve(resultsDir, instanceId);
        if (targetPath !== path.join(resultsDir, instanceId) || !fs.existsSync(targetPath)) {
            throw new Error(`任务 latest 指向不存在的实例: ${latestPath} -> ${target}`);
        }
        files.push(await writeGeneratedFileWithManifest(
            outputRoot,
            path.join('server', 'res', 'tasks', taskEntry.name, 'results', TASK_LATEST_MARKER_FILE),
            `${instanceId}\n`
        ));
    }
    return files;
}

async function copyOfflineTasks(taskRoot, outputRoot) {
    await validateTaskResultIndexes(taskRoot);
    const files = [];
    for (const relativePath of await listOfflineTaskFiles(taskRoot)) {
        files.push(await copyFileWithManifest(
            taskRoot,
            relativePath,
            outputRoot,
            path.join('server', 'res', 'tasks', relativePath)
        ));
    }
    files.push(...await copyTaskMarkers(taskRoot, outputRoot));
    return files;
}

async function writeGeneratedFileWithManifest(outputRoot, relativePath, content) {
    const outputPath = path.join(outputRoot, relativePath);
    assertSafeRelativePath(relativePath);
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, content, 'utf8');
    const buffer = Buffer.from(content, 'utf8');
    return {
        path: relativePath.split(path.sep).join('/'),
        size: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex')
    };
}

async function copyOfflineUpdatePublicKey(outputRoot, options = {}) {
    const loadedKey = await loadOfflineUpdatePublicKey({
        publicKeyPem: options.publicKeyPem,
        publicKeyPath: options.publicKeyPath,
        homeDir: options.homeDir,
        required: options.required === true
    });
    if (!loadedKey) return false;
    await fs.promises.writeFile(
        path.join(outputRoot, 'offline-update-public-key.pem'),
        loadedKey.publicKeyPem,
        'utf8'
    );
    return true;
}

async function copyDirectoryWithManifest(sourceRoot, outputRoot, outputPrefix = '', options = {}) {
    const sourceFiles = await listFiles(sourceRoot);
    const excludedPaths = new Set(options.excludedPaths || []);
    const excludedPrefixes = options.excludedPrefixes || [];
    const files = [];
    for (const relativePath of sourceFiles) {
        if (excludedPaths.has(relativePath) || excludedPrefixes.some(prefix => (
            relativePath === prefix || relativePath.startsWith(`${prefix}${path.sep}`)
        ))) {
            continue;
        }
        const outputRelativePath = mapPackagedAssetPath(relativePath, outputPrefix);
        files.push(await copyFileWithManifest(sourceRoot, relativePath, outputRoot, outputRelativePath));
    }
    return files;
}

function mapPackagedAssetPath(relativePath, outputPrefix = '') {
    const outputRelativePath = outputPrefix
        ? path.join(outputPrefix, relativePath)
        : relativePath;
    const segments = relativePath.split(path.sep);
    if (outputPrefix === 'server' && segments.includes('node_modules') &&
        segments.at(-1) === '.manifest.json') {
        return path.join(path.dirname(outputRelativePath), ANDROID_HIDDEN_MANIFEST_MARKER);
    }
    return outputRelativePath;
}

async function copyNodeLibrary(runtimeDir, nativeOutputDir) {
    // 原生 Node 库不放入 Android assets，但必须参与内容版本计算，避免 Node 库变更后
    // 设备仍错误复用旧的 nativeLibraryDir 文件。
    const metadata = await copyFileWithManifest(
        runtimeDir,
        'node',
        nativeOutputDir,
        path.join(ANDROID_ABI, NODE_LIBRARY_NAME)
    );
    const outputPath = path.join(nativeOutputDir, ANDROID_ABI, NODE_LIBRARY_NAME);
    await fs.promises.chmod(outputPath, 0o755);
    return metadata;
}

function deriveContentVersion(files, nodeFile, modelAssets = []) {
    // 构建输入的文件列表可能受文件系统遍历顺序影响，先按路径排序后再计算指纹，
    // 保证相同输入重复构建时版本稳定，只有实际内容变化才触发 APK 首次启动安装。
    const fingerprintInput = JSON.stringify({
        files: [...files].sort((left, right) => left.path.localeCompare(right.path)),
        modelAssets: [...modelAssets].sort((left, right) => left.path.localeCompare(right.path)),
        node: {
            size: nodeFile.size,
            sha256: nodeFile.sha256
        }
    });
    const digest = crypto.createHash('sha256').update(fingerprintInput, 'utf8').digest('hex');
    return `content-${digest.slice(0, 24)}`;
}

function canonicalJson(value) {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
    }
    return value;
}

function createModelCompatibilityMetadata(models) {
    const compareStableText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    const stableModels = [...models]
        .map((model) => ({
            modelId: model.modelId,
            revision: model.revision,
            files: [...model.files]
                .map(({ name, size, sha256 }) => ({ name, size, sha256: sha256.toLowerCase() }))
                .sort((left, right) => compareStableText(left.name, right.name))
        }))
        .sort((left, right) => compareStableText(left.modelId, right.modelId));
    const payload = { schemaVersion: 1, models: stableModels };
    const modelCompatibilitySha256 = crypto.createHash('sha256')
        .update(JSON.stringify(canonicalJson(payload)), 'utf8')
        .digest('hex');
    return { ...payload, modelCompatibilitySha256 };
}

function assertRequiredPackageEntries(packageDir) {
    for (const requiredEntry of REQUIRED_PACKAGE_ENTRIES) {
        const entryPath = path.join(packageDir, requiredEntry);
        if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
            throw new Error(`服务器运行包缺少必需文件: ${requiredEntry}`);
        }
    }
}

async function copyCertificates(certDir, outputDir) {
    if (!certDir) return [];
    const resolvedCertDir = resolveRequiredDirectory(certDir, 'AASC_ANDROID_NODE_CERT_DIR');
    const files = [];
    for (const certificateName of CERTIFICATE_ENTRIES) {
        const sourcePath = path.join(resolvedCertDir, certificateName);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Android 子服务器证书缺少文件: ${certificateName}`);
        }
        files.push(await copyFileWithManifest(
            resolvedCertDir,
            certificateName,
            outputDir,
            path.join('res', 'certs', certificateName)
        ));
    }
    return files;
}

async function readOfflineConfigSeed(configFile) {
    const sourcePath = path.resolve(configFile || path.join(process.cwd(), 'config', 'config.json'));
    try {
        const source = JSON.parse(await fs.promises.readFile(sourcePath, 'utf8'));
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new Error('配置根节点必须是对象');
        }
        return {
            // 旧 offline-config 资产只承载聊天和 LLM 配置，保留该格式兼容已安装 APK。
            llm: source && typeof source.llm === 'object' && !Array.isArray(source.llm) ? source.llm : {},
            chat: source && typeof source.chat === 'object' && !Array.isArray(source.chat) ? source.chat : {}
        };
    } catch (error) {
        throw new Error(`读取 offline 配置种子失败: ${sourcePath}: ${error.message}`);
    }
}

async function readReleaseConfigSeed(configFile) {
    const sourcePath = path.resolve(configFile || path.join(process.cwd(), 'config', 'config.json'));
    try {
        const source = JSON.parse(await fs.promises.readFile(sourcePath, 'utf8'));
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new Error('配置根节点必须是对象');
        }
        return source;
    } catch (error) {
        throw new Error(`读取 release 配置种子失败: ${sourcePath}: ${error.message}`);
    }
}

async function copyUserConfigSeeds(userConfigDir, outputRoot) {
    if (!userConfigDir) return [];
    const resolvedDir = resolveRequiredDirectory(userConfigDir, 'release 用户配置目录');
    const files = [];
    for (const relativePath of await listFiles(resolvedDir)) {
        files.push(await copyFileWithManifest(
            resolvedDir,
            relativePath,
            outputRoot,
            path.join(RELEASE_USER_CONFIG_PREFIX, relativePath)
        ));
    }
    return files;
}

async function prepareUpdateOnlyRuntime(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const runtimeDir = resolveRequiredDirectory(
        options.runtimeDir || process.env.AASC_ANDROID_NODE_RUNTIME_DIR || DEFAULT_RUNTIME_DIR,
        'Android Node Runtime'
    );
    const outputDir = path.resolve(options.outputDir || path.join(process.cwd(), 'release/apkbuild/allserver-min/runtime/assets'));
    const nativeOutputDir = path.resolve(options.nativeOutputDir || path.join(outputDir, '..', 'jniLibs'));
    assertRuntimeLibraries(runtimeDir);

    const suffix = `.tmp-${process.pid}-${Date.now()}`;
    const temporaryOutputDir = `${outputDir}${suffix}`;
    const temporaryNativeOutputDir = `${nativeOutputDir}${suffix}`;
    await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
    await fs.promises.rm(temporaryNativeOutputDir, { recursive: true, force: true });
    await fs.promises.mkdir(temporaryOutputDir, { recursive: true });
    await fs.promises.mkdir(temporaryNativeOutputDir, { recursive: true });

    try {
        const files = [];
        // Android 原位更新会替换旧 APK 的 nativeLibraryDir；即使 update-only
        // Runtime 不替换服务源码，也必须继续携带 Node 可执行库，否则安装后
        // NodeServerService 找不到原来的 libaasc_node.so，服务无法热启动。
        await copyNodeLibrary(runtimeDir, temporaryNativeOutputDir);
        for (const libraryName of REQUIRED_RUNTIME_LIBRARIES) {
            files.push(await copyFileWithManifest(
                runtimeDir,
                path.join('lib', libraryName),
                temporaryOutputDir,
                path.join('runtime', ANDROID_ABI, 'lib', libraryName)
            ));
        }
        const fingerprint = JSON.stringify([...files].sort((left, right) => left.path.localeCompare(right.path)));
        const version = `update-${crypto.createHash('sha256').update(fingerprint, 'utf8').digest('hex').slice(0, 24)}`;
        const manifest = {
            version,
            abi: ANDROID_ABI,
            updateOnly: true,
            verifyRuntime: options.verifyRuntime !== false,
            allowedRuntimeLibraryPaths: files.map((file) => file.path).sort(),
            files
        };
        await fs.promises.writeFile(
            path.join(temporaryOutputDir, 'runtime-manifest.json'),
            JSON.stringify(manifest, null, 2) + '\n',
            'utf8'
        );
        await fs.promises.writeFile(path.join(temporaryOutputDir, 'runtime-version.txt'), `${version}\n`, 'utf8');
        if (options.profileMetadata?.offline === true || options.offlineUpdatePublicKeyPem ||
            options.offlineUpdatePublicKeyPath) {
            await copyOfflineUpdatePublicKey(temporaryOutputDir, {
                publicKeyPem: options.offlineUpdatePublicKeyPem,
                publicKeyPath: options.offlineUpdatePublicKeyPath,
                homeDir: options.homeDir,
                required: options.profileMetadata?.offline === true
            });
        }
        if (options.profileMetadata) {
            await fs.promises.writeFile(
                path.join(temporaryOutputDir, APK_PROFILE_METADATA_FILE),
                JSON.stringify(options.profileMetadata, null, 2) + '\n',
                'utf8'
            );
        }
        await fs.promises.rm(outputDir, { recursive: true, force: true });
        await fs.promises.rm(nativeOutputDir, { recursive: true, force: true });
        await fs.promises.rename(temporaryOutputDir, outputDir);
        await fs.promises.rename(temporaryNativeOutputDir, nativeOutputDir);
        return { outputDir, nativeOutputDir, manifest };
    } catch (error) {
        await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
        await fs.promises.rm(temporaryNativeOutputDir, { recursive: true, force: true });
        throw error;
    }
}

async function prepareAndroidNodeRuntime(options = {}) {
    if (options.updateOnly === true) return prepareUpdateOnlyRuntime(options);
    const projectRoot = path.resolve(options.projectRoot || process.cwd());
    const runtimeDir = resolveRequiredDirectory(
        options.runtimeDir || process.env.AASC_ANDROID_NODE_RUNTIME_DIR || DEFAULT_RUNTIME_DIR,
        'Android Node Runtime'
    );
    const packageDir = resolveRequiredDirectory(
        options.packageDir || process.env.AASC_ANDROID_NODE_PACKAGE_DIR,
        'AASC_ANDROID_NODE_PACKAGE_DIR'
    );
    const includeOfflineModels = options.includeOfflineModels === true;
    const verifyRuntime = options.verifyRuntime !== false;
    const modelRoot = includeOfflineModels
        ? resolveRequiredDirectory(
            options.modelRoot || path.join(process.cwd(), 'res', 'models'),
            '离线模型目录'
        )
        : null;
    const includeOfflineTasks = options.includeOfflineTasks === true;
    const taskRoot = includeOfflineTasks
        ? resolveRequiredDirectory(
            options.taskRoot || path.join(process.cwd(), 'res', 'tasks'),
            '离线任务目录'
        )
        : null;
    const outputDir = path.resolve(
        options.outputDir || path.join(process.cwd(), 'src/apps/android-display/app/build/generated/node-runtime/assets')
    );
    const nativeOutputDir = path.resolve(
        options.nativeOutputDir || path.join(outputDir, '..', 'jniLibs')
    );
    const nodePath = path.join(runtimeDir, 'node');

    if (!fs.existsSync(nodePath) || !fs.statSync(nodePath).isFile()) {
        throw new Error(`Android Node Runtime 的 node 不存在: ${nodePath}`);
    }
    assertRuntimeLibraries(runtimeDir);
    assertRequiredPackageEntries(packageDir);

    const temporaryOutputDir = `${outputDir}.tmp-${process.pid}-${Date.now()}`;
    const temporaryNativeOutputDir = `${nativeOutputDir}.tmp-${process.pid}-${Date.now()}`;
    await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
    await fs.promises.rm(temporaryNativeOutputDir, { recursive: true, force: true });
    await fs.promises.mkdir(temporaryOutputDir, { recursive: true });
    await fs.promises.mkdir(temporaryNativeOutputDir, { recursive: true });

    try {
        const files = [];
        const runtimeFiles = await copyDirectoryWithManifest(
            runtimeDir,
            temporaryOutputDir,
            path.join('runtime', ANDROID_ABI),
            { excludedPaths: ['node'] }
        );
        files.push(...runtimeFiles);
        const nodeFile = await copyNodeLibrary(runtimeDir, temporaryNativeOutputDir);
        const excludedPrefixes = [];
        if (includeOfflineModels) excludedPrefixes.push('res/models');
        if (includeOfflineTasks) excludedPrefixes.push('res/tasks');
        files.push(...await copyDirectoryWithManifest(
            packageDir,
            temporaryOutputDir,
            'server',
            excludedPrefixes.length > 0 ? { excludedPrefixes } : {}
        ));
        files.push(...await copyCertificates(
            options.certDir || process.env.AASC_ANDROID_NODE_CERT_DIR,
            temporaryOutputDir
        ));
        const offlineModelPackage = includeOfflineModels
            ? await copyOfflineModels(modelRoot, temporaryOutputDir, options.modelIds || [])
            : { files: [], modelAssets: [], models: [] };
        files.push(...offlineModelPackage.files);
        const modelAssets = offlineModelPackage.modelAssets;
        const offlineTaskFiles = includeOfflineTasks
            ? await copyOfflineTasks(taskRoot, temporaryOutputDir)
            : [];
        files.push(...offlineTaskFiles);

        if (options.configFile || includeOfflineModels) {
            const releaseConfig = await readReleaseConfigSeed(
                options.configFile || process.env.AASC_ANDROID_OFFLINE_CONFIG_FILE
            );
            files.push(await writeGeneratedFileWithManifest(
                temporaryOutputDir,
                RELEASE_CONFIG_SEED_FILE,
                JSON.stringify(releaseConfig, null, 2) + '\n'
            ));
            // 保留旧 APK 的离线配置资产名称，旧安装器可以继续识别，新安装器优先使用 release-config。
            files.push(await writeGeneratedFileWithManifest(
                temporaryOutputDir,
                OFFLINE_CONFIG_SEED_FILE,
                JSON.stringify(await readOfflineConfigSeed(
                    options.configFile || process.env.AASC_ANDROID_OFFLINE_CONFIG_FILE
                ), null, 2) + '\n'
            ));
        }
        files.push(...await copyUserConfigSeeds(options.userConfigDir, temporaryOutputDir));
        if (options.profileMetadata) {
            files.push(await writeGeneratedFileWithManifest(
                temporaryOutputDir,
                APK_PROFILE_METADATA_FILE,
                JSON.stringify(options.profileMetadata, null, 2) + '\n'
            ));
        }
        if (options.profileMetadata?.offline === true && options.profileMetadata.updateOnly !== true) {
            const versions = options.profileMetadata.serviceVersions || {};
            const codeVersion = versions.codeVersion === undefined ? 1 : versions.codeVersion;
            const dependencyVersion = versions.dependencyVersion === undefined ? 1 : versions.dependencyVersion;
            if (!Number.isSafeInteger(codeVersion) || codeVersion < 1 ||
                !Number.isSafeInteger(dependencyVersion) || dependencyVersion < 1) {
                throw new Error('Offline 服务基线 codeVersion/dependencyVersion 必须是正整数');
            }
            const lock = await fs.promises.readFile(path.join(packageDir, 'package-lock.json'));
            files.push(await writeGeneratedFileWithManifest(
                temporaryOutputDir,
                'offline-update-client.json',
                JSON.stringify({
                    schemaVersion: 1,
                    codeVersion,
                    dependencyVersion,
                    lockSha256: crypto.createHash('sha256').update(lock).digest('hex')
                }, null, 2) + '\n'
            ));
        }
        if (options.profileMetadata?.offline === true || options.offlineUpdatePublicKeyPem ||
            options.offlineUpdatePublicKeyPath) {
            await copyOfflineUpdatePublicKey(temporaryOutputDir, {
                publicKeyPem: options.offlineUpdatePublicKeyPem,
                publicKeyPath: options.offlineUpdatePublicKeyPath,
                homeDir: options.homeDir,
                required: options.profileMetadata?.offline === true
            });
        }

        const configuredVersion = String(
            options.version || process.env.AASC_ANDROID_NODE_RUNTIME_VERSION || ''
        ).trim();
        const version = configuredVersion || deriveContentVersion(files, nodeFile, modelAssets);
        const manifest = {
            version,
            abi: ANDROID_ABI,
            entrypoint: 'server/src/apps/server/boot/server-launcher.js',
            nodePath: NODE_LIBRARY_PATH,
            verifyRuntime,
            files,
            modelAssets
        };
        files.push(await writeGeneratedFileWithManifest(
            temporaryOutputDir,
            RUNTIME_MODE_FILE,
            `${includeOfflineModels ? 'offline' : 'online'}\n`
        ));
        if (includeOfflineModels) {
            const modelMetadata = {
                version,
                models: offlineModelPackage.models
            };
            files.push(await writeGeneratedFileWithManifest(
                temporaryOutputDir,
                OFFLINE_MODEL_METADATA_FILE,
                JSON.stringify(modelMetadata, null, 2) + '\n'
            ));
            files.push(await writeGeneratedFileWithManifest(
                temporaryOutputDir,
                'offline-model-compatibility.json',
                JSON.stringify(createModelCompatibilityMetadata(offlineModelPackage.models), null, 2) + '\n'
            ));
        }
        manifest.files = files;
        await fs.promises.writeFile(
            path.join(temporaryOutputDir, 'runtime-manifest.json'),
            JSON.stringify(manifest, null, 2) + '\n',
            'utf8'
        );
        // 启动时只读取这个小文件即可判断是否需要更新，避免每次启动都解析数 MB 的完整 manifest。
        await fs.promises.writeFile(
            path.join(temporaryOutputDir, 'runtime-version.txt'),
            `${version}\n`,
            'utf8'
        );

        await fs.promises.rm(outputDir, { recursive: true, force: true });
        await fs.promises.rm(nativeOutputDir, { recursive: true, force: true });
        await fs.promises.rename(temporaryOutputDir, outputDir);
        await fs.promises.rename(temporaryNativeOutputDir, nativeOutputDir);
        return { outputDir, nativeOutputDir, manifest };
    } catch (error) {
        await fs.promises.rm(temporaryOutputDir, { recursive: true, force: true });
        await fs.promises.rm(temporaryNativeOutputDir, { recursive: true, force: true });
        throw error;
    }
}

async function main() {
    const result = await prepareAndroidNodeRuntime({
        runtimeDir: process.env.AASC_ANDROID_NODE_RUNTIME_DIR,
        packageDir: process.env.AASC_ANDROID_NODE_PACKAGE_DIR,
        certDir: process.env.AASC_ANDROID_NODE_CERT_DIR,
        version: process.env.AASC_ANDROID_NODE_RUNTIME_VERSION
    });
    process.stdout.write([
        'Android Node Runtime assets 已生成',
        `目录: ${result.outputDir}`,
        `版本: ${result.manifest.version}`,
        `ABI: ${result.manifest.abi}`,
        `文件数: ${result.manifest.files.length}`
    ].join('\n') + '\n');
}

if (require.main === module) {
    main().catch(error => {
        console.error(`生成 Android Node Runtime assets 失败: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    ANDROID_ABI,
    CERTIFICATE_ENTRIES,
    NODE_LIBRARY_NAME,
    NODE_LIBRARY_PATH,
    OFFLINE_MODEL_FILES,
    OFFLINE_MODEL_METADATA_FILE,
    DISPLAY_MODEL_ASSET_PREFIX,
    APK_PROFILE_METADATA_FILE,
    OFFLINE_CONFIG_SEED_FILE,
    RELEASE_CONFIG_SEED_FILE,
    RELEASE_USER_CONFIG_PREFIX,
    TASK_LINKS_MARKER_FILE,
    TASK_LATEST_MARKER_FILE,
    ANDROID_HIDDEN_MANIFEST_MARKER,
    RUNTIME_MODE_FILE,
    REQUIRED_RUNTIME_LIBRARIES,
    REQUIRED_PACKAGE_ENTRIES,
    prepareUpdateOnlyRuntime,
    copyOfflineUpdatePublicKey,
    assertSafeRelativePath,
    assertRuntimeLibraries,
    isAndroidAssetExcluded,
    isNpmInternalMetadata,
    isNpmToolShim,
    mapPackagedAssetPath,
    deriveContentVersion,
    createModelCompatibilityMetadata,
    readOfflineConfigSeed,
    readReleaseConfigSeed,
    prepareAndroidNodeRuntime
};
