'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DISPLAY_HTML = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/display.html');
const UPLOAD_HTML = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/upload.html');
const TTS_JS = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/tts.js');
const WEBSOCKET_JS = path.join(ROOT, 'src/apps/web-mediacenter/ui/public/js/websocket.js');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function createInput(value) {
    return {
        value: value == null ? '' : String(value),
        textContent: '',
        style: {},
        disabled: false,
        dataset: {},
        addEventListener() {}
    };
}

function createButton(onclickCode) {
    const listeners = [];
    return {
        value: '',
        textContent: '',
        style: {},
        disabled: false,
        dataset: {},
        addEventListener(type, listener) {
            listeners.push({ type, listener });
        },
        getClickListenerCount() {
            return listeners.filter((entry) => entry.type === 'click').length;
        },
        async click(sandbox) {
            if (onclickCode) {
                await vm.runInNewContext(`(async () => { ${onclickCode} })()`, sandbox, {
                    filename: 'cpuAffinitySaveBtn.onclick'
                });
            }
            for (const entry of listeners) {
                if (entry.type === 'click') {
                    await entry.listener();
                }
            }
        }
    };
}

function flushMicrotasks() {
    return new Promise((resolve) => setImmediate(resolve));
}

function readSaveButtonOnclickCode() {
    const html = read(UPLOAD_HTML);
    const match = html.match(/id="cpuAffinitySaveBtn"[^>]*onclick="([^"]+)"/);
    return match ? match[1] : '';
}

function createCpuAffinitySandbox(options = {}) {
    const fetchCalls = [];
    const toasts = [];
    const elements = Object.assign({
        asrBigCoreCountInput: createInput('1'),
        asrLittleCoreCountInput: createInput('1'),
        ttsBigCoreCountInput: createInput('1'),
        ttsLittleCoreCountInput: createInput('1'),
        cpuAffinityStatus: createInput(''),
        cpuAffinitySaveBtn: createButton(options.saveButtonOnclickCode || '')
    }, options.elements || {});

    const sandbox = {
        console,
        WebSocket: { OPEN: 1 },
        showToast(message, type) {
            toasts.push({ message, type });
        },
        fetch: async (url, init = {}) => {
            fetchCalls.push({
                url,
                method: init.method || 'GET',
                body: init.body || null
            });
            if (typeof options.fetchImpl === 'function') {
                return options.fetchImpl(url, init);
            }
            return {
                async json() {
                    return {
                        status: 'success',
                        cpuAffinity: {
                            asr: { bigCoreCount: 1, littleCoreCount: 1 },
                            tts: { bigCoreCount: 1, littleCoreCount: 1 }
                        }
                    };
                }
            };
        },
        window: {},
        document: {
            getElementById(id) {
                return elements[id] || null;
            }
        }
    };

    sandbox.window = sandbox;
    sandbox.window.DeviceList = {
        getDisplays() {
            return [];
        }
    };
    sandbox.window.WebSocketManager = options.webSocketManager || {
        ws: null,
        sendTts() {}
    };
    sandbox.window.currentDisplayId = 'display-test';
    vm.runInNewContext(read(TTS_JS), sandbox, { filename: TTS_JS });
    return { sandbox, elements, fetchCalls, toasts };
}

function createWebSocketSandbox(cpuAffinityChangedCalls) {
    const sandbox = {
        console,
        WebSocket: { OPEN: 1 },
        setTimeout() {},
        clearTimeout() {},
        localStorage: {
            getItem() {
                return null;
            },
            setItem() {}
        },
        location: {
            reload() {}
        },
        showToast() {},
        document: {
            getElementById() {
                return null;
            }
        },
        window: {
            CpuAffinitySettings: {
                handleConfigChanged(config) {
                    cpuAffinityChangedCalls.push(config);
                }
            }
        }
    };

    vm.runInNewContext(read(WEBSOCKET_JS), sandbox, { filename: WEBSOCKET_JS });
    return sandbox.window.WebSocketManager;
}

test('控制页提供 ASR/TTS 大小核数量输入且默认值为 1', () => {
    const html = read(UPLOAD_HTML);

    assert.match(html, /id="asrBigCoreCountInput"[\s\S]*value="1"/);
    assert.match(html, /id="asrLittleCoreCountInput"[\s\S]*value="1"/);
    assert.match(html, /id="ttsBigCoreCountInput"[\s\S]*value="1"/);
    assert.match(html, /id="ttsLittleCoreCountInput"[\s\S]*value="1"/);
    assert.match(html, /id="cpuAffinityStatus"/);
});

test('显示端消费 cpuConfig 时只在新桥可用时调用 cpuConfigure，旧桥缺失时安全忽略', () => {
    const display = read(DISPLAY_HTML);

    assert.match(display, /data\.type === 'cpuConfig'/);
    assert.match(display, /typeof nativeBridge\.cpuConfigure !== 'function'/);
    assert.match(display, /nativeBridge\.cpuConfigure\(JSON\.stringify\(/);
});

test('CpuAffinitySettings 保存时会规范化非负整数，并保证每个引擎至少一个槽位', async () => {
    const { sandbox, elements, fetchCalls } = createCpuAffinitySandbox({
        fetchImpl: async () => ({
            async json() {
                return {
                    status: 'success',
                    cpuAffinity: {
                        asr: { bigCoreCount: 0, littleCoreCount: 1 },
                        tts: { bigCoreCount: 3, littleCoreCount: 0 }
                    }
                };
            }
        })
    });

    const settings = sandbox.CpuAffinitySettings;
    assert.ok(settings, '应导出 CpuAffinitySettings');

    elements.asrBigCoreCountInput.value = '-2';
    elements.asrLittleCoreCountInput.value = '';
    elements.ttsBigCoreCountInput.value = '3.8';
    elements.ttsLittleCoreCountInput.value = '-9';

    await settings.saveConfig();

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, '/api/config/cpuAffinity');
    assert.equal(fetchCalls[0].method, 'POST');
    assert.deepEqual(JSON.parse(fetchCalls[0].body), {
        asr: { bigCoreCount: 0, littleCoreCount: 1 },
        tts: { bigCoreCount: 3, littleCoreCount: 0 }
    });
});

test('CpuAffinitySettings 会读取服务器配置并在 websocket 广播后刷新控件', async () => {
    const { sandbox, elements } = createCpuAffinitySandbox({
        fetchImpl: async () => ({
            async json() {
                return {
                    status: 'success',
                    cpuAffinity: {
                        asr: { bigCoreCount: 2 },
                        tts: { littleCoreCount: 4 }
                    }
                };
            }
        })
    });

    const settings = sandbox.CpuAffinitySettings;
    await settings.loadConfig();

    assert.equal(elements.asrBigCoreCountInput.value, '2');
    assert.equal(elements.asrLittleCoreCountInput.value, '1');
    assert.equal(elements.ttsBigCoreCountInput.value, '1');
    assert.equal(elements.ttsLittleCoreCountInput.value, '4');

    settings.handleConfigChanged({
        asr: { bigCoreCount: 5, littleCoreCount: 0 },
        tts: { bigCoreCount: 0, littleCoreCount: 2 }
    });

    assert.equal(elements.asrBigCoreCountInput.value, '5');
    assert.equal(elements.asrLittleCoreCountInput.value, '0');
    assert.equal(elements.ttsBigCoreCountInput.value, '0');
    assert.equal(elements.ttsLittleCoreCountInput.value, '2');
});

test('Tts.init 只为保存按钮保留一个绑定，且每次点击只发一个 POST', async () => {
    const { sandbox, elements, fetchCalls } = createCpuAffinitySandbox({
        saveButtonOnclickCode: readSaveButtonOnclickCode(),
        fetchImpl: async () => ({
            async json() {
                return {
                    status: 'success',
                    cpuAffinity: {
                        asr: { bigCoreCount: 1, littleCoreCount: 1 },
                        tts: { bigCoreCount: 1, littleCoreCount: 1 }
                    }
                };
            }
        })
    });

    sandbox.Tts.init();
    await flushMicrotasks();

    assert.equal(elements.cpuAffinitySaveBtn.getClickListenerCount(), 1);
    assert.equal(fetchCalls.filter((call) => call.method === 'GET').length, 1);

    await elements.cpuAffinitySaveBtn.click(sandbox);
    await flushMicrotasks();

    assert.equal(fetchCalls.filter((call) => call.method === 'POST').length, 1);

    sandbox.Tts.init();
    await flushMicrotasks();

    assert.equal(elements.cpuAffinitySaveBtn.getClickListenerCount(), 1);

    await elements.cpuAffinitySaveBtn.click(sandbox);
    await flushMicrotasks();

    assert.equal(fetchCalls.filter((call) => call.method === 'POST').length, 2);
});

test('控制端 websocket 收到 cpuAffinityChanged 时转交给 CpuAffinitySettings', () => {
    const calls = [];
    const manager = createWebSocketSandbox(calls);
    const cpuAffinity = {
        asr: { bigCoreCount: 2, littleCoreCount: 1 },
        tts: { bigCoreCount: 1, littleCoreCount: 3 }
    };

    manager.handleMessage({
        type: 'cpuAffinityChanged',
        cpuAffinity
    });

    assert.deepEqual(calls, [cpuAffinity]);
});
