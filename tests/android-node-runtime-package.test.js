'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const { prepareAndroidNodeRuntime } = require('../scripts/ops/prepare-android-node-runtime');

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

test('服务器运行包不能通过路径穿越写出 assets 目录', async () => {
    const packageDir = await createServerPackage(tempDir);
    const outsideFile = path.join(tempDir, 'escape.txt');
    await fs.promises.writeFile(outsideFile, 'escape', 'utf8');
    await fs.promises.symlink(outsideFile, path.join(packageDir, 'src', 'escape.txt'));
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.writeFile(path.join(runtimeDir, 'node'), '#!/system/bin/sh\n', 'utf8');

    await assert.rejects(
        () => prepareAndroidNodeRuntime({ runtimeDir, packageDir, outputDir: path.join(tempDir, 'output') }),
        /服务器运行包不允许符号链接/u
    );
});

test('正常输入生成固定 ABI manifest 和 Node 启动入口', async () => {
    const packageDir = await createServerPackage(tempDir);
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.writeFile(path.join(runtimeDir, 'node'), '#!/system/bin/sh\n', 'utf8');

    const outputDir = path.join(tempDir, 'output');
    const result = await prepareAndroidNodeRuntime({ runtimeDir, packageDir, outputDir });
    const manifest = JSON.parse(await fs.promises.readFile(path.join(outputDir, 'runtime-manifest.json'), 'utf8'));

    assert.equal(result.manifest.abi, 'arm64-v8a');
    assert.equal(manifest.entrypoint, 'server/src/apps/server/boot/server-launcher.js');
    assert.equal(manifest.nodePath, 'native/arm64-v8a/libaasc_node.so');
    assert.equal(manifest.files.some(file => file.path === 'runtime/arm64-v8a/node'), false);
    assert.equal(manifest.files.some(file => file.path === 'server/package.json'), true);
    assert.equal(
        (await fs.promises.stat(path.join(tempDir, 'jniLibs', 'arm64-v8a', 'libaasc_node.so'))).mode & 0o111,
        0o111
    );
});

test('服务器运行包忽略 npm 的 .bin 工具软链接', async () => {
    const packageDir = await createServerPackage(tempDir);
    const binDir = path.join(packageDir, 'node_modules', '.bin');
    await fs.promises.mkdir(binDir, { recursive: true });
    await fs.promises.writeFile(path.join(packageDir, 'node_modules', 'tool.js'), 'module.exports = true;\n', 'utf8');
    await fs.promises.symlink('../tool.js', path.join(binDir, 'tool'));
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.writeFile(path.join(runtimeDir, 'node'), '#!/system/bin/sh\n', 'utf8');

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
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.writeFile(path.join(runtimeDir, 'node'), '#!/system/bin/sh\n', 'utf8');

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
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.writeFile(path.join(runtimeDir, 'node'), '#!/system/bin/sh\n', 'utf8');

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
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    await fs.promises.writeFile(path.join(runtimeDir, 'node'), '#!/system/bin/sh\n', 'utf8');

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
