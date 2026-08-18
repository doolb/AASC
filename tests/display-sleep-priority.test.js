const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const displayPath = path.join(
    __dirname,
    '..',
    'src',
    'apps',
    'web-mediacenter',
    'ui',
    'public',
    'display.html'
);

function readDisplaySource() {
    return fs.readFileSync(displayPath, 'utf8');
}

function readBlock(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, '未找到代码片段: ' + startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, '未找到结束代码片段: ' + endMarker);
    return source.slice(start, end);
}

test('sleepOverride 应清除临时激活并优先于 activationUntil', () => {
    const source = readDisplaySource();
    const controlBlock = readBlock(source, "case 'sleepOverride':", 'break;');
    const checkBlock = readBlock(source, 'function checkSleepMode()', 'function activateTemporarily()');

    assert.match(controlBlock, /activationUntil\s*=\s*0\s*;/, '立即切换应清除未过期临时激活');
    assert.ok(
        checkBlock.indexOf("manualSleepMode === 'deep'") < checkBlock.indexOf('Date.now() < activationUntil'),
        'checkSleepMode 应先判断手动覆盖，再判断临时激活'
    );
});
