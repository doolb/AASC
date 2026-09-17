'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    resolveReleaseRuntimeContext,
    validateReleaseRuntimeContext
} = require('../src/core/release-runtime-context');
const { loadApkProfile } = require('../scripts/ops/apk-build-profile');
const {
    REQUIRED_RUNTIME_LIBRARIES,
    prepareAndroidNodeRuntime
} = require('../scripts/ops/prepare-android-node-runtime');

async function writeFixtureFiles(rootDir, files) {
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(rootDir, relativePath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content, 'utf8');
    }
}

async function createFixtureRuntime(rootDir) {
    const runtimeDir = path.join(rootDir, 'android-runtime');
    await writeFixtureFiles(runtimeDir, {
        node: '#!/system/bin/sh\n'
    });
    for (const libraryName of REQUIRED_RUNTIME_LIBRARIES) {
        await writeFixtureFiles(runtimeDir, {
            [`lib/${libraryName}`]: `${libraryName}\n`
        });
    }
    return runtimeDir;
}

async function createFixturePackage(rootDir) {
    const packageDir = path.join(rootDir, 'server-package');
    await writeFixtureFiles(packageDir, {
        'src/apps/server/boot/server-launcher.js': 'module.exports = {};\n',
        'package.json': JSON.stringify({
            name: 'aasc-server-fixture',
            dependencies: { express: '^4.18.2' }
        }),
        'package-lock.json': '{}\n'
    });
    return packageDir;
}

test('release profile 集成输入包含结果索引和选定模型', async (t) => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-release-profile-'));
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));
    await writeFixtureFiles(projectRoot, {
        'release/config/config.json': JSON.stringify({ llm: { active: 'qwen-test' } }),
        'release/userconfig/userconfig.json': JSON.stringify({ theme: 'dark' }),
        'release/task/demo-service/task.js': 'module.exports = {};\n',
        'release/task/demo-service/results/index.json': JSON.stringify({
            instances: [{
                taskName: 'demo-service',
                instanceId: 'demo-1',
                mode: 'service',
                status: 'running',
                params: { enabled: true },
                entryFile: 'service.js'
            }]
        }),
        'release/task/demo-service/results/demo-1/run.log': 'running\n',
        'release/apkbuild/allserver/app.json': JSON.stringify({
            schemaVersion: 1,
            embeddedNode: true,
            features: ['llm'],
            models: ['qwen-test']
        }),
        'res/models/llm/manifest.json': JSON.stringify({
            models: [{
                modelId: 'qwen-test',
                directory: 'qwen-test',
                files: [{ name: 'model.bin' }]
            }]
        }),
        'res/models/llm/qwen-test/.manifest.json': '{}\n',
        'res/models/llm/qwen-test/model.bin': 'selected\n',
        'res/models/unselected/large.bin': 'must-not-be-packaged\n'
    });
    await fs.promises.symlink(
        'demo-1',
        path.join(projectRoot, 'release/task/demo-service/results/latest')
    );

    const context = resolveReleaseRuntimeContext({
        projectRoot,
        homeDir: '/home/unused',
        argv: ['node', 'server-launcher.js', '--release'],
        environment: {}
    });
    validateReleaseRuntimeContext(context);
    const profile = await loadApkProfile({ projectRoot, profile: 'allserver' });
    const runtimeDir = await createFixtureRuntime(projectRoot);
    const packageDir = await createFixturePackage(projectRoot);
    const prepared = await prepareAndroidNodeRuntime({
        runtimeDir,
        packageDir,
        modelRoot: path.join(projectRoot, 'res/models'),
        modelIds: profile.models,
        includeOfflineModels: true,
        taskRoot: context.taskDir,
        includeOfflineTasks: true,
        configFile: context.configFile,
        userConfigDir: context.userConfigDir,
        profileMetadata: profile,
        outputDir: path.join(projectRoot, 'release/apkbuild/allserver/runtime/assets'),
        nativeOutputDir: path.join(projectRoot, 'release/apkbuild/allserver/runtime/jniLibs')
    });

    const manifestPaths = prepared.manifest.files.map((file) => file.path);
    assert.equal(profile.models.includes('qwen-test'), true);
    assert.equal(Object.hasOwn(profile, 'tasks'), false);
    assert.equal(context.taskDir, path.join(projectRoot, 'release/task'));
    assert.equal(manifestPaths.includes('server/res/tasks/demo-service/results/index.json'), true);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-service/results/demo-1/run.log'), true);
    assert.equal(manifestPaths.includes('server/res/tasks/demo-service/results/latest.marker'), true);
    assert.equal(manifestPaths.includes('server/res/models/llm/manifest.json'), true);
    assert.equal(
        prepared.manifest.modelAssets.some((file) => file.path === 'display-models/qwen-test/model.bin'),
        true
    );
    assert.equal(manifestPaths.includes('server/res/models/llm/qwen-test/model.bin'), false);
    assert.equal(manifestPaths.includes('server/res/models/unselected/large.bin'), false);
    assert.equal(manifestPaths.includes('release-userconfig/userconfig.json'), true);
    assert.equal(manifestPaths.includes('apk-profile.json'), true);
});
