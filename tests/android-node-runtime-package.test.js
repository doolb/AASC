'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const {
    OFFLINE_MODEL_FILES,
    REQUIRED_RUNTIME_LIBRARIES,
    createModelCompatibilityMetadata,
    prepareAndroidNodeRuntime
} = require('../scripts/ops/prepare-android-node-runtime');

let tempDir;

beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-android-node-test-'));
});

afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
});

test('model compatibility 指纹使用与 Android 一致的 locale-independent 文件名顺序', () => {
    const compatibility = createModelCompatibilityMetadata([{
        modelId: 'm',
        revision: 'r',
        files: [
            { name: 'a_b', size: 2, sha256: 'b'.repeat(64) },
            { name: 'a-b', size: 1, sha256: 'a'.repeat(64) }
        ]
    }]);

    assert.deepEqual(compatibility.models[0].files.map(file => file.name), ['a-b', 'a_b']);
    assert.equal(compatibility.modelCompatibilitySha256, '31b71f35b06ce06a77b31a3ebc22a1963af3705cbc36d6014b24d5adece8c20a');
});

async function createServerPackage(rootDir, files = {}) {
    const packageDir = path.join(rootDir, 'package');
    await fs.promises.mkdir(path.join(packageDir, 'src', 'apps', 'server', 'boot'), { recursive: true });
    await fs.promises.writeFile(
        path.join(packageDir, 'src', 'apps', 'server', 'boot', 'server-launcher.js'),
        files.launcher || 'console.log("launcher");',
        'utf8'
    );
    await fs.promises.writeFile(path.join(packageDir, 'package.json'), '{"name":"aasc-server"}\n', 'utf8');
    await fs.promises.writeFile(path.join(packageDir, 'package-lock.json'), '{}\n', 'utf8');
    return packageDir;
}

async function createRuntime(rootDir, { includeLibraries = true } = {}) {
    const runtimeDir = path.join(rootDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.writeFile(path.join(runtimeDir, 'node'), '#!/system/bin/sh\n', 'utf8');
    if (includeLibraries) {
        const libraryDir = path.join(runtimeDir, 'lib');
        await fs.promises.mkdir(libraryDir, { recursive: true });
        for (const libraryName of REQUIRED_RUNTIME_LIBRARIES) {
            await fs.promises.writeFile(
                path.join(libraryDir, libraryName),
                `library:${libraryName}\n`,
                'utf8'
            );
        }
    }
    return runtimeDir;
}

test('Runtime 输入缺少 node 时拒绝生成 assets', async () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    const packageDir = await createServerPackage(tempDir);

    await assert.rejects(
        () => prepareAndroidNodeRuntime({
            runtimeDir,
            packageDir,
            outputDir: path.join(tempDir, 'output')
        }),
        /node.*不存在/u
    );
});

test('Runtime 输入缺少 Node 动态库时拒绝生成 assets', async () => {
    const runtimeDir = await createRuntime(tempDir, { includeLibraries: false });
    const packageDir = await createServerPackage(tempDir);

    await assert.rejects(
        () => prepareAndroidNodeRuntime({
            runtimeDir,
            packageDir,
            outputDir: path.join(tempDir, 'output')
        }),
        /动态库.*libz\.so\.1/u
    );
});

test('服务器运行包不能通过路径穿越写出 assets 目录', async () => {
    const packageDir = await createServerPackage(tempDir);
    const outsideFile = path.join(tempDir, 'escape.txt');
    await fs.promises.writeFile(outsideFile, 'escape', 'utf8');
    await fs.promises.symlink(outsideFile, path.join(packageDir, 'src', 'escape.txt'));
    const runtimeDir = await createRuntime(tempDir);

    await assert.rejects(
        () => prepareAndroidNodeRuntime({ runtimeDir, packageDir, outputDir: path.join(tempDir, 'output') }),
        /服务器运行包不允许符号链接/u
    );
});

test('正常输入生成固定 ABI manifest 和 Node 启动入口', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);

    const outputDir = path.join(tempDir, 'output');
    const result = await prepareAndroidNodeRuntime({ runtimeDir, packageDir, outputDir });
    const manifest = JSON.parse(await fs.promises.readFile(path.join(outputDir, 'runtime-manifest.json'), 'utf8'));
    const runtimeVersion = await fs.promises.readFile(
        path.join(outputDir, 'runtime-version.txt'),
        'utf8'
    );

    assert.equal(result.manifest.abi, 'arm64-v8a');
    assert.equal(runtimeVersion.trim(), manifest.version);
    assert.equal(manifest.entrypoint, 'server/src/apps/server/boot/server-launcher.js');
    assert.equal(manifest.nodePath, 'native/arm64-v8a/libaasc_node.so');
    assert.equal(manifest.files.some(file => file.path === 'runtime/arm64-v8a/node'), false);
    assert.equal(manifest.files.some(file => file.path === 'server/package.json'), true);
    assert.equal(
        (await fs.promises.stat(path.join(tempDir, 'jniLibs', 'arm64-v8a', 'libaasc_node.so'))).mode & 0o111,
        0o111
    );
});

test('Runtime manifest 默认开启且支持关闭完整内容校验', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);
    const outputDir = path.join(tempDir, 'output');
    const result = await prepareAndroidNodeRuntime({
        packageDir,
        runtimeDir,
        verifyRuntime: false,
        outputDir
    });
    const manifest = JSON.parse(await fs.promises.readFile(path.join(outputDir, 'runtime-manifest.json'), 'utf8'));

    assert.equal(result.manifest.verifyRuntime, false);
    assert.equal(manifest.verifyRuntime, false);
});

test('update-only Runtime 生成允许列表动态库资产并保留 Node 可执行库，不包含服务包和模型', async () => {
    const runtimeDir = await createRuntime(tempDir);
    const outputDir = path.join(tempDir, 'update-only-assets');
    const nativeOutputDir = path.join(tempDir, 'update-only-jniLibs');

    const result = await prepareAndroidNodeRuntime({
        runtimeDir,
        updateOnly: true,
        outputDir,
        nativeOutputDir
    });
    const manifest = JSON.parse(await fs.promises.readFile(path.join(outputDir, 'runtime-manifest.json'), 'utf8'));
    const allowedPaths = REQUIRED_RUNTIME_LIBRARIES.map((name) => `runtime/arm64-v8a/lib/${name}`).sort();

    assert.equal(manifest.updateOnly, true);
    assert.deepEqual(manifest.files.map((file) => file.path).sort(), allowedPaths);
    assert.equal(manifest.files.some((file) => file.path.startsWith('server/')), false);
    assert.equal(manifest.files.some((file) => file.path.endsWith('/node')), false);
    assert.equal(fs.existsSync(path.join(outputDir, 'offline-model-manifest.json')), false);
    assert.deepEqual(await fs.promises.readdir(path.join(nativeOutputDir, 'arm64-v8a')), [
        'libaasc_node.so'
    ]);
    assert.ok((await fs.promises.stat(
        path.join(nativeOutputDir, 'arm64-v8a', 'libaasc_node.so')
    )).size > 0);
});

test('update-only APK 可携带验证公钥但公钥不进入可安装 Runtime 文件列表', async () => {
    const runtimeDir = await createRuntime(tempDir);
    const projectRoot = path.join(tempDir, 'project');
    const publicKeyPath = path.join(projectRoot, 'release', 'offline-update', 'public-key.pem');
    const publicKeyPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
        .publicKey.export({ type: 'spki', format: 'pem' });
    await fs.promises.mkdir(path.dirname(publicKeyPath), { recursive: true });
    await fs.promises.writeFile(publicKeyPath, publicKeyPem);
    const outputDir = path.join(tempDir, 'update-only-key-assets');

    const result = await prepareAndroidNodeRuntime({
        projectRoot,
        runtimeDir,
        updateOnly: true,
        offlineUpdatePublicKeyPath: publicKeyPath,
        outputDir,
        nativeOutputDir: path.join(tempDir, 'update-only-key-jniLibs')
    });
    const manifest = JSON.parse(await fs.promises.readFile(path.join(outputDir, 'runtime-manifest.json'), 'utf8'));

    const stagedPublicKey = await fs.promises.readFile(
        path.join(outputDir, 'offline-update-public-key.pem'), 'utf8'
    );
    assert.equal(stagedPublicKey, publicKeyPem);
    assert.doesNotMatch(stagedPublicKey, /BEGIN PRIVATE KEY/);
    assert.equal(manifest.files.some((file) => file.path === 'offline-update-public-key.pem'), false);
    assert.equal(result.manifest.updateOnly, true);
});

test('Offline Runtime 写入服务基线版本和实际 package-lock 指纹', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);
    const projectRoot = path.join(tempDir, 'offline-project');
    const publicKeyPath = path.join(projectRoot, 'release', 'offline-update', 'public-key.pem');
    const publicKeyPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
        .publicKey.export({ type: 'spki', format: 'pem' });
    await fs.promises.mkdir(path.dirname(publicKeyPath), { recursive: true });
    await fs.promises.writeFile(publicKeyPath, publicKeyPem);
    const outputDir = path.join(tempDir, 'offline-assets');

    const result = await prepareAndroidNodeRuntime({
        projectRoot,
        packageDir,
        runtimeDir,
        profileMetadata: {
            offline: true,
            updateOnly: false,
            serviceVersions: { codeVersion: 4, dependencyVersion: 2 }
        },
        offlineUpdatePublicKeyPath: publicKeyPath,
        outputDir,
        nativeOutputDir: path.join(tempDir, 'offline-jniLibs')
    });
    const client = JSON.parse(await fs.promises.readFile(path.join(outputDir, 'offline-update-client.json'), 'utf8'));
    const lock = await fs.promises.readFile(path.join(packageDir, 'package-lock.json'));

    assert.equal(client.schemaVersion, 1);
    assert.equal(client.codeVersion, 4);
    assert.equal(client.dependencyVersion, 2);
    assert.equal(client.lockSha256, crypto.createHash('sha256').update(lock).digest('hex'));
    assert.equal(result.manifest.files.some((file) => file.path === 'offline-update-client.json'), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'offline-update-public-key.pem')), true);
});

test('offline Runtime 将当前 llm/chat 配置写为首次安装种子且不带其他主机配置', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);
    const modelRoot = path.join(tempDir, 'models');
    for (const relativePath of OFFLINE_MODEL_FILES) {
        const filePath = path.join(modelRoot, relativePath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, `model:${relativePath}\n`, 'utf8');
    }
    const configFile = path.join(tempDir, 'config.json');
    await fs.promises.writeFile(configFile, JSON.stringify({
        server: { port: 9999 },
        task: { autoStart: ['not-for-apk'] },
        llm: { defaultModelMappings: [{ externalModelName: 'qwen', modelId: 'qwen-local' }] },
        chat: { activeProfile: 'qwen3.5', protocol: 'openai-responses' }
    }), 'utf8');

    const outputDir = path.join(tempDir, 'output');
    const result = await prepareAndroidNodeRuntime({
        packageDir,
        runtimeDir,
        modelRoot,
        modelIds: ['llm'],
        configFile,
        includeOfflineModels: true,
        outputDir
    });
    const seed = JSON.parse(await fs.promises.readFile(path.join(outputDir, 'offline-config.json'), 'utf8'));

    assert.equal(result.manifest.files.some((file) => file.path === 'offline-config.json'), true);
    assert.deepEqual(seed, {
        llm: { defaultModelMappings: [{ externalModelName: 'qwen', modelId: 'qwen-local' }] },
        chat: { activeProfile: 'qwen3.5', protocol: 'openai-responses' }
    });
    assert.equal(Object.hasOwn(seed, 'server'), false);
});

test('未配置 Runtime 环境变量时使用项目内的 Android Runtime', async () => {
    const packageDir = await createServerPackage(tempDir);
    const outputDir = path.join(tempDir, 'output');
    const previousRuntimeDir = process.env.AASC_ANDROID_NODE_RUNTIME_DIR;
    delete process.env.AASC_ANDROID_NODE_RUNTIME_DIR;

    try {
        const result = await prepareAndroidNodeRuntime({ packageDir, outputDir });

        assert.equal(result.manifest.nodePath, 'native/arm64-v8a/libaasc_node.so');
        assert.equal(
            await fs.promises.stat(path.join(outputDir, 'runtime', 'arm64-v8a', 'lib', 'libz.so.1'))
                .then(() => true),
            true
        );
    } finally {
        if (previousRuntimeDir === undefined) {
            delete process.env.AASC_ANDROID_NODE_RUNTIME_DIR;
        } else {
            process.env.AASC_ANDROID_NODE_RUNTIME_DIR = previousRuntimeDir;
        }
    }
});

test('未显式版本时相同输入生成稳定内容版本', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);

    const first = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        outputDir: path.join(tempDir, 'output-first')
    });
    const second = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        outputDir: path.join(tempDir, 'output-second')
    });

    assert.match(first.manifest.version, /^content-[a-f0-9]{24}$/u);
    assert.equal(second.manifest.version, first.manifest.version);
});

test('服务器运行包内容变化时自动生成新内容版本', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);

    const first = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        outputDir: path.join(tempDir, 'output-first')
    });
    await fs.promises.writeFile(
        path.join(packageDir, 'src', 'apps', 'server', 'boot', 'server-launcher.js'),
        'console.log("launcher-updated");',
        'utf8'
    );
    const second = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        outputDir: path.join(tempDir, 'output-second')
    });

    assert.notEqual(second.manifest.version, first.manifest.version);
});

test('服务器运行包忽略 npm 的 .bin 工具软链接', async () => {
    const packageDir = await createServerPackage(tempDir);
    const binDir = path.join(packageDir, 'node_modules', '.bin');
    await fs.promises.mkdir(binDir, { recursive: true });
    await fs.promises.writeFile(path.join(packageDir, 'node_modules', 'tool.js'), 'module.exports = true;\n', 'utf8');
    await fs.promises.symlink('../tool.js', path.join(binDir, 'tool'));
    const runtimeDir = await createRuntime(tempDir);

    const result = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        outputDir: path.join(tempDir, 'output')
    });

    assert.equal(result.manifest.files.some(file => file.path.endsWith('/.bin/tool')), false);
});

test('服务器运行包忽略 npm 的内部 package-lock 文件', async () => {
    const packageDir = await createServerPackage(tempDir);
    const nodeModulesDir = path.join(packageDir, 'node_modules');
    await fs.promises.mkdir(nodeModulesDir, { recursive: true });
    await fs.promises.writeFile(path.join(nodeModulesDir, '.package-lock.json'), '{}\n', 'utf8');
    const runtimeDir = await createRuntime(tempDir);

    const result = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        outputDir: path.join(tempDir, 'output')
    });

    assert.equal(
        result.manifest.files.some(file => file.path === 'server/node_modules/.package-lock.json'),
        false
    );
});

test('服务器运行包忽略 Android assets 不支持的隐藏目录和下划线生成目录', async () => {
    const packageDir = await createServerPackage(tempDir);
    await fs.promises.mkdir(path.join(packageDir, 'node_modules', '@pixi', 'assets', 'lib', '_virtual'), {
        recursive: true
    });
    await fs.promises.mkdir(path.join(packageDir, 'node_modules', 'ismobilejs', 'src', '__tests__'), {
        recursive: true
    });
    await fs.promises.mkdir(path.join(packageDir, 'node_modules', 'hidden'), { recursive: true });
    await fs.promises.writeFile(
        path.join(packageDir, 'node_modules', '@pixi', 'assets', 'lib', '_virtual', 'worker.js'),
        'worker',
        'utf8'
    );
    await fs.promises.writeFile(
        path.join(packageDir, 'node_modules', 'ismobilejs', 'src', '__tests__', 'mobile.test.ts'),
        'test',
        'utf8'
    );
    await fs.promises.writeFile(path.join(packageDir, 'node_modules', 'hidden', '.npmignore'), '*\n', 'utf8');
    const runtimeDir = await createRuntime(tempDir);

    const result = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        outputDir: path.join(tempDir, 'output')
    });

    assert.equal(result.manifest.files.some(file => file.path.includes('/_virtual/')), false);
    assert.equal(result.manifest.files.some(file => file.path.includes('/__tests__/')), false);
    assert.equal(result.manifest.files.some(file => file.path.endsWith('/.npmignore')), false);
});

test('服务器运行包将 OpenAI _vendor parser 映射为可打包 marker', async () => {
    const packageDir = await createServerPackage(tempDir);
    const parserPath = path.join(
        packageDir,
        'node_modules',
        'openai',
        '_vendor',
        'partial-json-parser',
        'parser.mjs'
    );
    await fs.promises.mkdir(path.dirname(parserPath), { recursive: true });
    await fs.promises.writeFile(parserPath, 'export const parse = () => null;\n', 'utf8');
    const nestedParserPath = path.join(
        packageDir,
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'node_modules',
        'openai',
        '_vendor',
        'partial-json-parser',
        'parser.mjs'
    );
    await fs.promises.mkdir(path.dirname(nestedParserPath), { recursive: true });
    await fs.promises.writeFile(nestedParserPath, 'export const parse = () => null;\n', 'utf8');
    const runtimeDir = await createRuntime(tempDir);
    const outputDir = path.join(tempDir, 'output');

    const result = await prepareAndroidNodeRuntime({ packageDir, runtimeDir, outputDir });
    const assetPath = 'server/node_modules/openai/aasc-openai-vendor/partial-json-parser/parser.mjs';

    assert.equal(result.manifest.files.some(file => file.path === assetPath), true);
    assert.equal(fs.existsSync(path.join(outputDir, assetPath)), true);
    assert.equal(
        result.manifest.files.some(file => file.path === 'server/node_modules/openai/_vendor/partial-json-parser/parser.mjs'),
        false
    );
    assert.equal(
        fs.existsSync(path.join(outputDir, 'server', 'node_modules', 'openai', '_vendor', 'partial-json-parser', 'parser.mjs')),
        false
    );
    assert.equal(
        fs.existsSync(path.join(
            outputDir,
            'server',
            'node_modules',
            '@earendil-works',
            'pi-coding-agent',
            'node_modules',
            'openai',
            'aasc-openai-vendor',
            'partial-json-parser',
            'parser.mjs'
        )),
        true
    );
});

test('服务器运行包缺少 OpenAI Responses parser 时在构建前失败', async () => {
    const packageDir = await createServerPackage(tempDir);
    await fs.promises.mkdir(path.join(packageDir, 'node_modules', 'openai'), { recursive: true });
    const runtimeDir = await createRuntime(tempDir);

    await assert.rejects(
        () => prepareAndroidNodeRuntime({
            packageDir,
            runtimeDir,
            outputDir: path.join(tempDir, 'output')
        }),
        /缺少 OpenAI Responses parser/u
    );
});

test('服务器运行包将 node_modules Provider manifest 改名为可打包 marker', async () => {
    const packageDir = await createServerPackage(tempDir);
    const manifestPath = path.join(
        packageDir,
        'node_modules',
        '@earendil-works',
        'pi-ai',
        'dist',
        'providers',
        'data',
        '.manifest.json'
    );
    await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.promises.writeFile(manifestPath, '{"providers":[]}' + '\n', 'utf8');
    const runtimeDir = await createRuntime(tempDir);
    const outputDir = path.join(tempDir, 'output');

    const result = await prepareAndroidNodeRuntime({ packageDir, runtimeDir, outputDir });
    const markerPath = 'server/node_modules/@earendil-works/pi-ai/dist/providers/data/aasc-bundled-manifest.json';

    assert.equal(result.manifest.files.some(file => file.path === markerPath), true);
    assert.equal(fs.existsSync(path.join(outputDir, markerPath)), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'server', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data', '.manifest.json')), false);
});

test('服务器运行包保留下划线命名的 Node 依赖文件', async () => {
    const packageDir = await createServerPackage(tempDir);
    const dependencyFile = path.join(
        packageDir,
        'node_modules',
        'readable-stream',
        'lib',
        '_stream_readable.js'
    );
    await fs.promises.mkdir(path.dirname(dependencyFile), { recursive: true });
    await fs.promises.writeFile(dependencyFile, 'module.exports = true;\n', 'utf8');
    const runtimeDir = await createRuntime(tempDir);

    const result = await prepareAndroidNodeRuntime({
        packageDir,
        runtimeDir,
        outputDir: path.join(tempDir, 'output')
    });

    assert.equal(
        result.manifest.files.some(file => file.path === 'server/node_modules/readable-stream/lib/_stream_readable.js'),
        true
    );
});

test('离线 Runtime 按选定模型复制并写入离线元数据', async () => {
    const packageDir = await createServerPackage(tempDir);
    await fs.promises.mkdir(path.join(packageDir, 'res', 'models', 'sensevoice'), { recursive: true });
    await fs.promises.writeFile(
        path.join(packageDir, 'res', 'models', 'sensevoice', 'model.int8.onnx'),
        'server-package-copy',
        'utf8'
    );
    const modelRoot = path.join(tempDir, 'models');
    for (const relativePath of OFFLINE_MODEL_FILES.filter((file) => file.startsWith('llm/'))) {
        const filePath = path.join(modelRoot, relativePath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, `model:${relativePath}\n`, 'utf8');
    }
    const runtimeDir = await createRuntime(tempDir);

    const outputDir = path.join(tempDir, 'output');
    const result = await prepareAndroidNodeRuntime({
        packageDir,
        runtimeDir,
        modelRoot,
        modelIds: ['llm'],
        includeOfflineModels: true,
        outputDir
    });

    const manifestPaths = result.manifest.files.map(file => file.path);
    const modelAssetPaths = result.manifest.modelAssets.map(file => file.path);
    assert.equal(new Set(manifestPaths).size, manifestPaths.length);
    assert.equal(new Set(modelAssetPaths).size, modelAssetPaths.length);
    assert.equal(manifestPaths.some(file => file === 'server/res/models/sensevoice/model.int8.onnx'), false);
    assert.equal(
        modelAssetPaths.some(file => file === 'display-models/qwen3.5-0.8b-claude-opus-distilled-mnn/config.json'),
        true
    );
    assert.equal(
        manifestPaths.some(file => file.startsWith('server/res/models/llm/qwen3.5-0.8b-claude-opus-distilled-mnn/')),
        false
    );
    assert.equal(await fs.promises.readFile(path.join(outputDir, 'runtime-mode.txt'), 'utf8'), 'offline\n');
    assert.equal(
        await fs.promises.stat(path.join(outputDir, 'offline-model-manifest.json')).then(() => true),
        true
    );
    const offlineModelManifest = JSON.parse(
        await fs.promises.readFile(path.join(outputDir, 'offline-model-manifest.json'), 'utf8')
    );
    const offlineCompatibility = JSON.parse(
        await fs.promises.readFile(path.join(outputDir, 'offline-model-compatibility.json'), 'utf8')
    );
    assert.equal(offlineModelManifest.models.length, 1);
    assert.equal(
        offlineModelManifest.models[0].modelId,
        'qwen3.5-0.8b-claude-opus-distilled-mnn'
    );
    assert.deepEqual(offlineCompatibility, createModelCompatibilityMetadata(offlineModelManifest.models));
    assert.equal(result.manifest.files.some((file) => file.path === 'offline-model-compatibility.json'), true);
    for (const relativePath of OFFLINE_MODEL_FILES.filter((file) => file.startsWith('llm/'))) {
        const outputRelativePath = relativePath.endsWith('/.manifest.json')
            ? relativePath.replace(
                /^llm\/([^/]+)\/\.manifest\.json$/u,
                'display-models/$1/bundled-manifest.json'
            )
            : relativePath === 'llm/manifest.json'
                ? 'server/res/models/llm/manifest.json'
                : relativePath.replace(/^llm\/([^/]+)\/(.+)$/u, 'display-models/$1/$2');
        const paths = outputRelativePath.startsWith('display-models/')
            ? modelAssetPaths
            : manifestPaths;
        assert.equal(paths.includes(outputRelativePath), true, relativePath);
        assert.equal(fs.existsSync(path.join(outputDir, outputRelativePath)), true);
    }
    assert.equal(
        fs.existsSync(path.join(
            outputDir,
            'display-models',
            'qwen3.5-0.8b-claude-opus-distilled-mnn',
            'bundled-manifest.json'
        )),
        true
    );
    assert.equal(manifestPaths.some(file => file.includes('test_wavs')), false);
    assert.equal(manifestPaths.some(file => file.endsWith('yolo11n-seg.pt')), false);
    assert.equal(manifestPaths.some(file => file.endsWith('yolo11s.onnx')), false);
});

test('Offline Runtime 不打包未被 profile 选择的 MMD PMX、VMD 或纹理', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);
    const mmdFiles = [
        ['res/models/mmd/miya/miya.pmx', 'PMX model'],
        ['res/models/mmd/miya/tex/1.png', 'texture'],
        ['res/models/mmd/motions/miya-default.vmd', 'VMD motion']
    ];
    for (const [relativePath, content] of mmdFiles) {
        const filePath = path.join(packageDir, ...relativePath.split('/'));
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content, 'utf8');
    }

    const result = await prepareAndroidNodeRuntime({
        packageDir,
        runtimeDir,
        outputDir: path.join(tempDir, 'output')
    });
    const packagedPaths = [
        ...result.manifest.files.map((file) => file.path),
        ...result.manifest.modelAssets.map((file) => file.path)
    ];

    assert.equal(packagedPaths.some((filePath) => filePath.startsWith('server/res/models/mmd/')), false);
    assert.equal(packagedPaths.some((filePath) => /\.(?:pmx|vmd)$/iu.test(filePath)), false);
    assert.equal(packagedPaths.includes('server/res/models/mmd/miya/tex/1.png'), false);
});

test('离线 Runtime 必须包含 MNNChat 默认模型的清单和全部运行文件', () => {
    const requiredFiles = [
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
        'llm/qwen3.5-0.8b-claude-opus-distilled-mnn/visual.mnn.weight'
    ];

    for (const relativePath of requiredFiles) {
        assert.equal(OFFLINE_MODEL_FILES.includes(relativePath), true, relativePath);
    }
});

test('离线 Runtime 缺少白名单模型时拒绝生成 assets', async () => {
    const packageDir = await createServerPackage(tempDir);
    const modelRoot = path.join(tempDir, 'models');
    await fs.promises.mkdir(modelRoot, { recursive: true });
    const runtimeDir = await createRuntime(tempDir);

    await assert.rejects(
        () => prepareAndroidNodeRuntime({
            packageDir,
            runtimeDir,
            modelRoot,
            modelIds: ['llm'],
            includeOfflineModels: true,
            outputDir: path.join(tempDir, 'output')
        }),
        /未知模型 ID llm/u
    );
});

test('离线 Runtime 打包用户任务定义并保留运行结果 marker', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);
    const taskRoot = path.join(tempDir, 'tasks');
    await fs.promises.mkdir(path.join(taskRoot, 'demo-task', 'results', 'instance-1'), { recursive: true });
    await fs.promises.writeFile(path.join(taskRoot, 'demo-task', 'task.js'), 'module.exports = { run: async () => ({ ok: true }) };\n', 'utf8');
    await fs.promises.writeFile(path.join(taskRoot, 'demo-task', 'config.json'), '{"enabled":true}\n', 'utf8');
    await fs.promises.writeFile(path.join(taskRoot, '.task-links.json'), '{}\n', 'utf8');
    await fs.promises.writeFile(
        path.join(taskRoot, 'demo-task', 'results', 'index.json'),
        '{"instances":[{"instanceId":"instance-1","status":"completed"}]}\n',
        'utf8'
    );
    await fs.promises.writeFile(path.join(taskRoot, 'demo-task', 'results', 'instance-1', 'run.log'), 'old result\n', 'utf8');
    await fs.promises.symlink('instance-1', path.join(taskRoot, 'demo-task', 'results', 'latest'));

    const outputDir = path.join(tempDir, 'output');
    const result = await prepareAndroidNodeRuntime({
        packageDir,
        runtimeDir,
        includeOfflineTasks: true,
        taskRoot,
        outputDir
    });

    const manifestPaths = result.manifest.files.map(file => file.path);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/task.js'), true);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/config.json'), true);
    assert.equal(manifestPaths.includes('server/res/tasks/task-links.marker'), true);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/results/index.json'), true);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/results/instance-1/run.log'), true);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/results/latest'), false);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/results/latest.marker'), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'server', 'res', 'tasks', 'demo-task', 'task.js')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'server', 'res', 'tasks', 'task-links.marker')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'server', 'res', 'tasks', 'demo-task', 'results', 'index.json')), true);
    assert.equal(
        await fs.promises.readFile(
            path.join(outputDir, 'server', 'res', 'tasks', 'demo-task', 'results', 'latest.marker'),
            'utf8'
        ),
        'instance-1\n'
    );
});

test('离线 Runtime 接受文本形式的 latest marker 且不复制原始 latest 文件', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);
    const taskRoot = path.join(tempDir, 'tasks');
    const resultsDir = path.join(taskRoot, 'demo-task', 'results');
    await fs.promises.mkdir(path.join(resultsDir, 'instance-1'), { recursive: true });
    await fs.promises.writeFile(
        path.join(taskRoot, 'demo-task', 'task.js'),
        'module.exports = { run: async () => ({ ok: true }) };\n',
        'utf8'
    );
    await fs.promises.writeFile(
        path.join(resultsDir, 'index.json'),
        '{"instances":[{"instanceId":"instance-1","status":"completed"}]}\n',
        'utf8'
    );
    await fs.promises.writeFile(path.join(resultsDir, 'latest'), 'instance-1\n', 'utf8');

    const outputDir = path.join(tempDir, 'output');
    const result = await prepareAndroidNodeRuntime({
        packageDir,
        runtimeDir,
        includeOfflineTasks: true,
        taskRoot,
        outputDir
    });

    const manifestPaths = result.manifest.files.map(file => file.path);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/results/latest'), false);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-task/results/latest.marker'), true);
    assert.equal(
        await fs.promises.readFile(
            path.join(outputDir, 'server', 'res', 'tasks', 'demo-task', 'results', 'latest.marker'),
            'utf8'
        ),
        'instance-1\n'
    );
});
