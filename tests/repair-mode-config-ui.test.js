'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('控制端声纹面板提供修复模式密码和工作 Agent 配置卡片', () => {
    const upload = read('src/apps/web-mediacenter/ui/public/upload.html');
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const voiceprintStart = upload.indexOf('<section class="panel" id="panel-voiceprint"');
    const voiceprintEnd = upload.indexOf('</section>', voiceprintStart);
    const voiceprintHtml = upload.slice(voiceprintStart, voiceprintEnd);

    assert.match(voiceprintHtml, /语音修复模式/);
    assert.match(voiceprintHtml, /id="repairModePassword"/);
    assert.match(voiceprintHtml, /id="repairModeRole"/);
    assert.match(voiceprintHtml, /id="repairModePasswordStatus"/);
    assert.match(voiceprintHtml, /id="repairModeClearPassword"/);
    assert.match(voiceprintHtml, /id="repairModeSaveBtn"/);
    assert.ok(panel.includes('/api/repair-mode/config'));
    assert.match(panel, /repairModePassword/);
    assert.match(panel, /repairModeRole/);
    assert.match(panel, /repairModeClearPassword/);
    assert.match(panel, /passwordConfigured/);
    assert.match(panel, /roles.map/);
});

test('控制端不能用服务端返回值回填修复模式密码', () => {
    const panel = read('src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js');
    const loadStart = panel.indexOf('async loadRepairModeConfig()');
    const loadEnd = panel.indexOf('async saveRepairModeConfig()', loadStart);
    const loadBody = panel.slice(loadStart, loadEnd);

    assert.ok(loadStart >= 0, '应存在修复模式配置加载函数');
    assert.doesNotMatch(loadBody, /repairModePassword\.value\s*=/);
    assert.match(panel, /passwordConfigured/);
});
