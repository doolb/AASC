'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const deviceListSource = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/js/device-list.js'), 'utf8');
const voiceprintPanelSource = fs.readFileSync(path.join(root, 'src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js'), 'utf8');

function createHarness(fetch) {
    let nextUrl = 0;
    const revokedUrls = [];
    const window = { currentDisplayId: 'display-a' };
    const document = { addEventListener() {} };
    class AudioMock {
        play() { return Promise.resolve(); }
        pause() {}
    }
    const context = {
        window, document, Blob, FormData, fetch, atob, Audio: AudioMock,
        URL: {
            createObjectURL: () => `blob:recording-${++nextUrl}`,
            revokeObjectURL: url => revokedUrls.push(url)
        },
        console
    };
    vm.runInNewContext(deviceListSource, context);
    vm.runInNewContext(voiceprintPanelSource, context);
    const deviceList = window.DeviceList;
    const voiceprintPanel = window.VoiceprintPanel;
    deviceList.render = () => {};
    deviceList.renderVoiceVadPanel = () => {};
    voiceprintPanel.refreshList = async () => {};
    return { deviceList, voiceprintPanel, revokedUrls };
}

test('显示端最近一次单次录音复用现有声纹注册接口，重录后不提交旧音频', async () => {
    const requests = [];
    const { deviceList, revokedUrls } = createHarness(async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ status: 'success', message: '已注册小明的声纹' }) };
    });
    deviceList.handleDisplayRecordingResult({ displayId: 'display-a', mode: 'single',
        audioData: Buffer.from('first').toString('base64'), mimeType: 'audio/wav' });
    const first = deviceList.displayRecordingPlaybackByDisplay.get('display-a');
    first.voiceprintName = '小明';
    deviceList.handleDisplayRecordingResult({ displayId: 'display-a', mode: 'single',
        audioData: Buffer.from('second').toString('base64'), mimeType: 'audio/wav' });
    const latest = deviceList.displayRecordingPlaybackByDisplay.get('display-a');
    assert.notEqual(latest, first);
    assert.equal(latest.voiceprintName, '小明');
    assert.deepEqual(revokedUrls, ['blob:recording-1']);
    assert.equal(await deviceList.registerSingleRecordingVoiceprint('display-a'), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/voiceprint/register');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.body.get('name'), '小明');
    assert.equal(await requests[0].options.body.get('audio').text(), 'second');
    assert.equal(latest.voiceprintStatus, '已注册小明的声纹');
});

test('空名字不注册，提交期间阻止重复点击，失败显示在录音卡片', async () => {
    let requestCount = 0;
    let resolveRequest;
    const { deviceList } = createHarness(async () => {
        requestCount += 1;
        return new Promise(resolve => { resolveRequest = resolve; });
    });
    deviceList.handleDisplayRecordingResult({ displayId: 'display-a', mode: 'single',
        audioData: Buffer.from('wav').toString('base64'), mimeType: 'audio/wav' });
    const playback = deviceList.displayRecordingPlaybackByDisplay.get('display-a');
    assert.equal(await deviceList.registerSingleRecordingVoiceprint('display-a'), false);
    assert.equal(playback.voiceprintStatus, '请先输入声纹名字');
    playback.voiceprintName = '小明';
    const pending = deviceList.registerSingleRecordingVoiceprint('display-a');
    assert.equal(playback.registering, true);
    assert.equal(await deviceList.registerSingleRecordingVoiceprint('display-a'), false);
    assert.equal(requestCount, 1);
    resolveRequest({ ok: false, status: 400, json: async () => ({ status: 'error', message: '声纹提取失败' }) });
    assert.equal(await pending, false);
    assert.equal(playback.registering, false);
    assert.equal(playback.voiceprintStatus, '注册失败：声纹提取失败');
});

test('录音卡片在单次结果状态后显示转注册表单，其他模式隐藏并转义姓名', () => {
    const { deviceList } = createHarness(async () => ({ ok: true, json: async () => ({ status: 'success' }) }));
    const display = { id: 'display-a', voiceRecordingMode: 'single', capabilities: { voiceRecording: true } };
    deviceList.getDisplayLabel = () => '测试显示端';
    deviceList.getVoiceVadThreshold = () => 0.01;
    deviceList.getVoiceCapabilities = item => item.capabilities;
    deviceList.getVoiceCaptureMode = () => 'webview';
    deviceList.getVoiceCaptureDeviceKeyForMode = () => 'default';
    deviceList.getVoiceInputDevices = () => [];
    deviceList.getAudioOutputDeviceKeyForDisplay = () => 'default';
    deviceList.getAudioOutputDevices = () => [];
    deviceList.isControlSocketOpen = () => true;
    assert.doesNotMatch(deviceList.renderVoiceVadCardHtml(display), /data-display-recording-voiceprint-register/u);
    deviceList.handleDisplayRecordingResult({ displayId: 'display-a', mode: 'single',
        audioData: Buffer.from('wav').toString('base64'), mimeType: 'audio/wav' });
    const playback = deviceList.displayRecordingPlaybackByDisplay.get('display-a');
    playback.voiceprintName = '小明"<';
    const html = deviceList.renderVoiceVadCardHtml(display);
    assert.ok(html.indexOf('已收到录音') < html.indexOf('data-display-recording-voiceprint-name'));
    assert.match(html, /value="小明&amp;quot;&amp;lt;"|value="小明&quot;&lt;"/u);
    assert.match(html, /data-display-recording-voiceprint-register/u);
    display.voiceRecordingMode = 'realtime';
    assert.doesNotMatch(deviceList.renderVoiceVadCardHtml(display), /data-display-recording-voiceprint-register/u);
    display.voiceRecordingMode = 'asr';
    assert.doesNotMatch(deviceList.renderVoiceVadCardHtml(display), /data-display-recording-voiceprint-register/u);
    assert.match(deviceListSource, /activeElement\.matches\('\[data-vad-threshold\], \[data-display-recording-voiceprint-name\]'\)/u);
    assert.match(deviceListSource, /playback\.voiceprintName = input\.value/u);
});
