'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Offline 绑定网页媒体后立即提供端点，启动不等待进程连接', () => {
    const source = fs.readFileSync('src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt', 'utf8');
    const begin = source.indexOf('private fun ensureBrowserMediaEndpoint()');
    const end = source.indexOf('private val serviceUpdateApplying', begin);
    assert.ok(begin >= 0 && end > begin);
    const binding = source.slice(begin, end);
    assert.match(binding, /bindService\(intent, connection, Context\.BIND_AUTO_CREATE\)/);
    assert.match(binding, /BrowserMediaWebViewService\.PORT to secret/);
    assert.doesNotMatch(binding, /\.await\(|CountDownLatch|Thread\.sleep/);
    assert.doesNotMatch(binding, /onServiceDisconnected[^\n]*browserMediaEndpoint\s*=\s*null/);
});
