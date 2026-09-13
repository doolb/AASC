'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('LLM 能力关闭会通知原生桥并释放运行时而保留缓存', () => {
    const display = read('src/apps/web-mediacenter/ui/public/display.html');
    const bridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
    const manager = read('src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmModelManager.kt');

    assert.match(display, /nativeBridge\.llmSetEnabled\(llmEnabled\)/);
    assert.match(bridge, /fun llmSetEnabled\(enabled: Boolean\)/);
    assert.match(manager, /state = when \{[\s\S]{0,100}!enabled -> "disabled"/);
    assert.match(manager, /fun setEnabled\(baseUrl: String, requestedEnabled: Boolean\)/);
    assert.match(manager, /engineToRelease\?\.release\(\)/);
    assert.match(manager, /不删除已经下载的模型文件/);
    assert.match(manager, /if \(!install\.changed\) return/);
});
