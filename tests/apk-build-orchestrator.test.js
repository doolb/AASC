'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
    createApkBuildPlan
} = require('../scripts/ops/build-apk');
const { prepareAndroidServerPackage } = require('../scripts/ops/prepare-android-server-package');

const projectRoot = path.resolve(__dirname, '..');

test('npm 脚本固定映射三个 release APK profile', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts;

    assert.match(scripts['build:apk'], /build-apk\.js.*withserver/u);
    assert.match(scripts['build:apk:offline'], /build-apk\.js.*allserver/u);
    assert.match(scripts['build:apk:noserver'], /build-apk\.js.*noserver/u);
});

test('profile 中间目录按 profile 隔离', () => {
    const plan = createApkBuildPlan({ projectRoot: '/repo', profileName: 'allserver' });

    assert.equal(plan.buildRoot, '/repo/release/apkbuild/allserver');
    assert.equal(plan.packageDir, '/repo/release/apkbuild/allserver/package');
    assert.equal(plan.runtimeDir, '/repo/release/apkbuild/allserver/runtime');
    assert.equal(plan.gradleDir, '/repo/release/apkbuild/allserver/gradle');
    assert.equal(plan.outputDir, '/repo/release/apkbuild/allserver/output');
});

test('构建计划保留旧 output，临时目录独立', () => {
    const plan = createApkBuildPlan({ projectRoot: '/repo', profileName: 'withserver' });

    assert.equal(plan.outputDir.endsWith('/output'), true);
    assert.match(plan.packageTempPrefix, /package\.tmp-/u);
    assert.match(plan.runtimeAssetsDir, /runtime\/assets/u);
    assert.match(plan.runtimeJniLibsDir, /runtime\/jniLibs/u);
});

test('自动生成服务器运行包时排除 Android 源码并校验 express 依赖', async (t) => {
    const fixtureRoot = await fs.promises.mkdtemp(path.join(require('node:os').tmpdir(), 'aasc-server-package-'));
    t.after(() => fs.promises.rm(fixtureRoot, { recursive: true, force: true }));
    const files = {
        'src/apps/server/boot/server-launcher.js': 'module.exports = {};\n',
        'src/apps/android-display/app/build.gradle.kts': 'must not copy\n',
        'package.json': JSON.stringify({ dependencies: { express: '^4.18.2' } }),
        'package-lock.json': '{}\n'
    };
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(fixtureRoot, relativePath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content, 'utf8');
    }

    const outputDir = path.join(fixtureRoot, 'release', 'package');
    const prepared = await prepareAndroidServerPackage({
        projectRoot: fixtureRoot,
        outputDir,
        commandRunner: async (_file, _args, commandOptions) => {
            await fs.promises.mkdir(path.join(commandOptions.cwd, 'node_modules', 'express'), { recursive: true });
        }
    });

    assert.equal(prepared, outputDir);
    assert.equal(fs.existsSync(path.join(outputDir, 'src/apps/server/boot/server-launcher.js')), true);
    assert.equal(fs.existsSync(path.join(outputDir, 'src/apps/android-display')), false);
});
