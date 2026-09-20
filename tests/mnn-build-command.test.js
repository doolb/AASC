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

test('MNN 编译提供独立 npm 命令并复用 APK 准备脚本', () => {
    assert.equal(packageJson.scripts['build:mnnllm-android'], 'node scripts/ops/prepare-mnnllm-android.js');
    assert.equal(packageJson.scripts['prepare:mnnllm-android'], 'node scripts/ops/prepare-mnnllm-android.js');
});

test('MNN 编译默认使用仓库 checkout、固定 revision 和 NDK 版本', () => {
    assert.match(prepareScript, /path\.join\(projectRoot, 'build', 'third_party', 'MNN'\)/u);
    assert.match(prepareScript, /d407447ed56c4121a11ccbd266dc184ca1ead0c2/u);
    assert.match(prepareScript, /ndk', '28\.2\.13676358'/u);
});

test('MNN 编译仍保留环境变量覆盖入口', () => {
    assert.match(prepareScript, /process\.env\.AASC_MNN_ROOT/u);
    assert.match(prepareScript, /process\.env\.AASC_MNN_REVISION/u);
    assert.match(prepareScript, /process\.env\.ANDROID_NDK_HOME/u);
});
