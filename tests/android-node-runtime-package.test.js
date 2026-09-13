'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const {
    OFFLINE_MODEL_FILES,
    REQUIRED_RUNTIME_LIBRARIES,
    prepareAndroidNodeRuntime
} = require('../scripts/ops/prepare-android-node-runtime');

let tempDir;

beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-android-node-test-'));
});

afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
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

test('离线 Runtime 只复制正式模型白名单并写入离线元数据', async () => {
    const packageDir = await createServerPackage(tempDir);
    await fs.promises.mkdir(path.join(packageDir, 'res', 'models', 'sensevoice'), { recursive: true });
    await fs.promises.writeFile(
        path.join(packageDir, 'res', 'models', 'sensevoice', 'model.int8.onnx'),
        'server-package-copy',
        'utf8'
    );
    const modelRoot = path.join(tempDir, 'models');
    for (const relativePath of OFFLINE_MODEL_FILES) {
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
        includeOfflineModels: true,
        outputDir
    });

    const manifestPaths = result.manifest.files.map(file => file.path);
    assert.equal(new Set(manifestPaths).size, manifestPaths.length);
    assert.equal(await fs.promises.readFile(path.join(outputDir, 'runtime-mode.txt'), 'utf8'), 'offline\n');
    assert.equal(
        await fs.promises.stat(path.join(outputDir, 'offline-model-manifest.json')).then(() => true),
        true
    );
    for (const relativePath of OFFLINE_MODEL_FILES) {
        assert.equal(manifestPaths.includes(`server/res/models/${relativePath}`), true, relativePath);
        assert.equal(fs.existsSync(path.join(outputDir, 'server', 'res', 'models', relativePath)), true);
    }
    assert.equal(manifestPaths.some(file => file.includes('test_wavs')), false);
    assert.equal(manifestPaths.some(file => file.endsWith('yolo11n-seg.pt')), false);
    assert.equal(manifestPaths.some(file => file.endsWith('yolo11s.onnx')), false);
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
            includeOfflineModels: true,
            outputDir: path.join(tempDir, 'output')
        }),
        /离线模型文件不存在/u
    );
});

test('离线 Runtime 打包用户任务定义但排除运行结果', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = await createRuntime(tempDir);
    const taskRoot = path.join(tempDir, 'tasks');
    await fs.promises.mkdir(path.join(taskRoot, 'demo-task', 'results', 'instance-1'), { recursive: true });
    await fs.promises.writeFile(path.join(taskRoot, 'demo-task', 'task.js'), 'module.exports = { run: async () => ({ ok: true }) };\n', 'utf8');
    await fs.promises.writeFile(path.join(taskRoot, 'demo-task', 'config.json'), '{"enabled":true}\n', 'utf8');
    await fs.promises.writeFile(path.join(taskRoot, '.task-links.json'), '{}\n', 'utf8');
    await fs.promises.writeFile(path.join(taskRoot, 'demo-task', 'results', 'index.json'), '{"instances":[]}\n', 'utf8');
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
    assert.equal(manifestPaths.includes('server/res/tasks/.task-links.json'), true);
    assert.equal(manifestPaths.some(file => file.includes('/results/')), false);
    assert.equal(fs.existsSync(path.join(outputDir, 'server', 'res', 'tasks', 'demo-task', 'task.js')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'server', 'res', 'tasks', 'demo-task', 'results')), false);
});
