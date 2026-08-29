const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('正式 APK 包含 GTCRN 降噪资源和快速多段实现', () => {
    const gradle = read('src/apps/android-display/app/build.gradle.kts');
    const bridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
    const voiceprint = read('src/apps/android-display/app/src/main/java/com/aasc/display/VoiceprintEngine.kt');
    assert.match(gradle, /speech-enhancement/);
    assert.match(gradle, /gtcrn_simple\.onnx/);
    assert.match(bridge, /asrRecognizeAsyncWithOptions/);
    assert.match(bridge, /DenoiseAudioPolicy\.prepare/);
    assert.match(bridge, /VoiceprintFastPath\.representatives/);
    assert.match(voiceprint, /numClusters = speakerCount/);
});

test('正式显示端固定中文，降噪由声纹面板统一配置', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const tts = read('src/apps/web-mediacenter/ui/public/js/tts.js');
    const voiceprintPanel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const server = read('src/apps/server/boot/server-app.js');
    const bridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
    const languageMode = read('src/apps/android-display/app/src/main/java/com/aasc/display/AsrLanguageMode.kt');
    assert.match(display, /asrRecognizeAsyncWithOptions/);
    assert.match(display, /asrDenoiseEnabled/);
    assert.match(display, /asrLanguageMode = 'zh'/);
    assert.match(upload, /vpDenoiseCheck/);
    assert.match(voiceprintPanel, /vpDenoiseCheck/);
    assert.match(voiceprintPanel, /denoise:/);
    assert.match(server, /asr\.denoise/);
    assert.match(server, /languageMode: 'zh'/);
    assert.doesNotMatch(upload, /显示端 ASR 处理/);
    assert.doesNotMatch(upload, /asrLanguageModeInput|asrDenoiseInput|asrOptionsSaveBtn/);
    assert.doesNotMatch(tts, /AsrOptions|asrOptions/);
    assert.doesNotMatch(upload, /asrFilterOtherTextInput|zh-en-filter/);
    assert.doesNotMatch(tts, /filterOtherText|zh-en-filter/);
    assert.doesNotMatch(server, /filterOtherText|zh-en-filter|filterChineseEnglishText/);
    assert.doesNotMatch(display, /asrFilterOtherText|filterOtherText|zh-en-filter/);
    assert.doesNotMatch(bridge, /asrFilterOtherText|filterOtherText|ChineseEnglishTextFilter/);
    assert.doesNotMatch(languageMode, /ZH_EN_FILTER|zh-en-filter|filtersText|postProcess/);
});

test('声纹配置限制快速模式人数为 AUTO 或 1 到 5', () => {
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const server = read('src/apps/server/boot/server-app.js');
    assert.match(panel, /vpSpeakerCountSel/);
    assert.match(panel, /speakerCount/);
    assert.match(server, /speakerCount 必须是 AUTO 或 1-5/);
});
