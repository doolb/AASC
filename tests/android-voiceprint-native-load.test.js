const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const voiceprintSource = fs.readFileSync(
    path.join(projectRoot, 'src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintEngine.kt'),
    'utf8'
);

test('外部 APK 声纹模型加载时不向 sherpa-onnx 传入 AssetManager', () => {
    assert.match(voiceprintSource, /SpeakerEmbeddingExtractor\(null,\s*SpeakerEmbeddingExtractorConfig/);
    assert.match(voiceprintSource, /OfflineSpeakerDiarization\(null,\s*OfflineSpeakerDiarizationConfig/);
    assert.doesNotMatch(voiceprintSource, /SpeakerEmbeddingExtractor\(appContext\.assets/);
    assert.doesNotMatch(voiceprintSource, /OfflineSpeakerDiarization\(appContext\.assets/);
});
