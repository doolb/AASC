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
    assert.equal(packageJson.scripts['build:mnnllm-android'], 'node scripts/ops/prepare-mnnllm-android.js');
    assert.equal(packageJson.scripts['prepare:mnnllm-android'], 'node scripts/ops/prepare-mnnllm-android.js');
});

test('MNN 编译默认使用仓库 checkout、固定 revision 和 NDK 版本', () => {
    assert.match(configScript, /path\.join\(projectRoot, 'build', 'third_party', 'MNN'\)/u);
    assert.match(configScript, /d407447ed56c4121a11ccbd266dc184ca1ead0c2/u);
    assert.match(prepareScript, /ndk', '28\.2\.13676358'/u);
});

test('MNN 编译仍保留环境变量覆盖入口', () => {
    assert.match(configScript, /environment\.AASC_MNN_ROOT/u);
    assert.match(configScript, /environment\.AASC_MNN_REVISION/u);
    assert.match(prepareScript, /process\.env\.ANDROID_NDK_HOME/u);
});

test('MNN 配置空环境时复用仓库 checkout 和固定 revision', () => {
    const config = resolveMnnBuildConfig({ projectRoot, environment: {} });
    assert.equal(config.root, path.join(projectRoot, 'build', 'third_party', 'MNN'));
    assert.equal(config.revision, DEFAULT_MNN_REVISION);
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

test('Gradle 直接运行时回退到仓库 MNN checkout', () => {
    assert.match(gradleScript, /rootProject\.file\("\.\.\/\.\.\/\.\.\/build\/third_party\/MNN"\)/u);
    assert.match(gradleScript, /defaultMnnRevision = "d407447ed56c4121a11ccbd266dc184ca1ead0c2"/u);
    assert.match(gradleScript, /CMakeLists\.txt/u);
});
