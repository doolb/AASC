const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const asrEngineSource = fs.readFileSync(
    path.join(projectRoot, 'src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt'),
    'utf8'
);

test('外部 APK 模型加载时不向 sherpa-onnx 传入 AssetManager', () => {
    assert.match(asrEngineSource, /OfflineRecognizer\(null,\s*config\)/);
    assert.doesNotMatch(asrEngineSource, /OfflineRecognizer\(appContext\.assets,\s*config\)/);
});
