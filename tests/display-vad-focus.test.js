'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const DEVICE_LIST = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/device-list.js');

function createDeviceListContext() {
    const eventHandlers = new Map();
    const vadInput = {
        dataset: { displayId: 'display-1' },
        matches(selector) {
            return selector === '[data-vad-threshold]';
        }
    };
    const panel = {
        innerHTML: '<existing-vad-input>',
        dataset: {},
        contains(element) {
            return element === vadInput;
        },
        querySelector(selector) {
            return selector === '[data-vad-threshold]' ? vadInput : null;
        },
        addEventListener(type, handler) {
            eventHandlers.set(type, handler);
        }
    };
    const window = {
        currentDisplayId: 'display-1'
    };
    const document = {
        activeElement: vadInput,
        getElementById(id) {
            return id === 'voiceVadPanel' ? panel : null;
        }
    };
    const context = {
        window,
        document,
        console,
        setTimeout(callback) {
            callback();
        }
    };

    vm.runInNewContext(fs.readFileSync(DEVICE_LIST, 'utf8'), context, { filename: DEVICE_LIST });
    window.DeviceList.list = [{
        id: 'display-1',
        ip: '192.168.1.10',
        capabilities: { cameraCapture: false, voiceRecording: true },
        voiceRecordingMode: 'asr'
    }];

    return { api: window.DeviceList, document, eventHandlers, panel };
}

test('VAD 输入框聚焦时设备状态刷新不替换输入框 DOM', () => {
    const { api, panel } = createDeviceListContext();
    const previousHtml = panel.innerHTML;

    api.renderVoiceVadPanel();

    assert.equal(panel.innerHTML, previousHtml);
    assert.equal(panel.dataset.voiceVadRefreshPending, '1');
});

test('VAD 输入框失焦后执行待处理的面板刷新', () => {
    const { api, document, eventHandlers, panel } = createDeviceListContext();
    api.renderVoiceVadPanel();
    const focusout = eventHandlers.get('focusout');
    assert.equal(typeof focusout, 'function');

    document.activeElement = null;
    focusout();

    assert.notEqual(panel.innerHTML, '<existing-vad-input>');
    assert.equal(panel.dataset.voiceVadRefreshPending, undefined);
});
