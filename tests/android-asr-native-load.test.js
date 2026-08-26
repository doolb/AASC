const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const productionFiles = [
    'src/apps/android-display/app/src/main/java/com/aasc/display/AsrEngine.kt',
    'src/apps/android-display/app/src/main/java/com/aasc/display/AsrEnginePool.kt'
].map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));

test('外部 APK 模型加载时不向 sherpa-onnx 传入 AssetManager', () => {
    const combinedSource = productionFiles.join('\n');

    assert.match(combinedSource, /OfflineRecognizer\(null,\s*config\)/);
    assert.doesNotMatch(combinedSource, /OfflineRecognizer\(appContext\.assets,\s*config\)/);
});
