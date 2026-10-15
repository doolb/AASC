const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const prepareScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'ops', 'prepare-mnnllm-android.js'),
    'utf8'
);
const configScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'ops', 'mnn-build-config.js'),
    'utf8'
);
const buildApkScript = fs.readFileSync(
    path.join(projectRoot, 'scripts', 'ops', 'build-apk.js'),
    'utf8'
);
const gradleScript = fs.readFileSync(
    path.join(projectRoot, 'src', 'apps', 'android-display', 'app', 'build.gradle.kts'),
    'utf8'
);
const { DEFAULT_MNN_REVISION, resolveMnnBuildConfig } = require(
    path.join(projectRoot, 'scripts', 'ops', 'mnn-build-config.js')
);

test('MNN 编译提供独立 npm 命令并复用 APK 准备脚本', () => {
    assert.equal(packageJson.scripts['build:mnnllm-android'], 'node scripts/ops/prepare-mnnllm-android.js --build-source');
    assert.equal(packageJson.scripts['package:mnnllm-android'], 'node scripts/ops/package-mnnllm-android.js');
    assert.equal(packageJson.scripts['prepare:mnnllm-android'], 'node scripts/ops/prepare-mnnllm-android.js');
});

test('APK 默认使用 Git 内置预编译包，源码编译保留独立缓存路径', () => {
    assert.match(configScript, /android-mnnllm-prebuilt/u);
    assert.match(configScript, /mode === 'source'/u);
    assert.match(configScript, /d407447ed56c4121a11ccbd266dc184ca1ead0c2/u);
    assert.match(prepareScript, /ndk', '28\.2\.13676358'/u);
    assert.match(prepareScript, /SHA-256 不匹配/u);
    assert.match(prepareScript, /不会自动下载 MNN 上游源码/u);
});

test('MNN 编译仍保留环境变量覆盖入口', () => {
    assert.match(configScript, /environment\.AASC_MNN_ROOT/u);
    assert.match(configScript, /environment\.AASC_MNN_REVISION/u);
    assert.match(prepareScript, /process\.env\.ANDROID_NDK_HOME/u);
});

test('MNN 配置空环境时指向 Git 预编译包，源码模式使用本机 checkout', () => {
    const config = resolveMnnBuildConfig({ projectRoot, environment: {} });
    assert.equal(config.root, path.join(
        projectRoot,
        '3rd',
        'android-mnnllm-prebuilt',
        DEFAULT_MNN_REVISION
    ));
    assert.equal(config.revision, DEFAULT_MNN_REVISION);
    const sourceConfig = resolveMnnBuildConfig({
        projectRoot,
        environment: {},
        mode: 'source'
    });
    assert.equal(sourceConfig.root, path.join(projectRoot, 'build', 'third_party', 'MNN'));
});

test('MNN 配置仍支持环境变量覆盖', () => {
    const config = resolveMnnBuildConfig({
        projectRoot,
        environment: {
            AASC_MNN_ROOT: '/tmp/aasc-mnn',
            AASC_MNN_REVISION: 'custom-revision'
        }
    });
    assert.equal(config.root, '/tmp/aasc-mnn');
    assert.equal(config.revision, 'custom-revision');
});

test('APK 编排脚本将 MNN 配置显式传给准备脚本和 Gradle', () => {
    assert.match(buildApkScript, /commandEnvironment\.AASC_MNN_ROOT = mnnBuildConfig\.root/u);
    assert.match(buildApkScript, /commandEnvironment\.AASC_MNN_REVISION = mnnBuildConfig\.revision/u);
    assert.match(buildApkScript, /-PaascMnnRoot=\$\{mnnBuildConfig\.root\}/u);
    assert.match(buildApkScript, /-PaascMnnRevision=\$\{mnnBuildConfig\.revision\}/u);
});

test('Gradle 直接运行时回退到 Git 预编译包并传入 revision', () => {
    assert.match(gradleScript, /3rd\/android-mnnllm-prebuilt\/\$mnnRevision/u);
    assert.match(gradleScript, /manifest\.json/u);
    assert.match(gradleScript, /defaultMnnRevision = "d407447ed56c4121a11ccbd266dc184ca1ead0c2"/u);
    assert.match(gradleScript, /-DAASC_MNN_REVISION=\$mnnRevision/u);
    assert.match(gradleScript, /CMakeLists\.txt/u);
});
