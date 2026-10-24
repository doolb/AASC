'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DISPLAY = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');

test('显示端只把 url/base64 送入媒体播放，未知消息不清理或覆盖恢复媒体', () => {
    const source = fs.readFileSync(DISPLAY, 'utf8');
    const branchStart = source.indexOf("} else if (data.type === 'url' || data.type === 'base64') {");
    assert.ok(branchStart >= 0, '默认消息分发应显式限制媒体消息类型');
    const branchEnd = source.indexOf('\n                    }\n                } catch (e)', branchStart);
    assert.ok(branchEnd > branchStart, '媒体分支后应有独立的未知消息分支');
    const branches = source.slice(branchStart, branchEnd);
    const mediaBranchEnd = branches.indexOf('\n                    } else {');
    assert.ok(mediaBranchEnd > 0, 'url/base64 媒体分支应有独立处理区');

    const mediaBranch = branches.slice(0, mediaBranchEnd);
    const unknownBranch = branches.slice(mediaBranchEnd);
    assert.match(mediaBranch, /stopPlaylist\(\)/);
    assert.match(mediaBranch, /showMedia\(data\)/);
    assert.match(mediaBranch, /sendCommandAck\('media', true, data\.type\)/);
    assert.doesNotMatch(unknownBranch, /stopPlaylist\(|showMedia\(|sendCommandAck\('media'/);
});
