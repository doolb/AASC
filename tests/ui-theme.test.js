'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const publicRoot = path.join(__dirname, '../src/apps/web-mediacenter/ui/public');
const themeScriptPath = path.join(publicRoot, 'js/ui-theme.js');
const uploadHtmlPath = path.join(publicRoot, 'upload.html');
const themeCssPath = path.join(publicRoot, 'css/theme.css');
const uploadCssPath = path.join(publicRoot, 'css/upload.css');
const ttsScriptPath = path.join(publicRoot, 'js/tts.js');
const controlsScriptPath = path.join(publicRoot, 'js/controls.js');
const floatingControlScriptPath = path.join(publicRoot, 'js/floating-control.js');
const mediaLibraryScriptPath = path.join(publicRoot, 'js/media-library.js');

function createElement(tagName, type = '', classNames = []) {
    return {
        tagName: tagName.toUpperCase(),
        type,
        dataset: {},
        matches() {
            return true;
        },
        querySelectorAll() {
            return [];
        },
        classList: {
            contains(name) {
                return classNames.includes(name);
            }
        }
    };
}

function loadThemeManager(elements = [], options = {}) {
    assert.ok(fs.existsSync(themeScriptPath), '主题管理脚本必须存在');

    const selector = {
        value: '',
        dataset: {},
        listeners: {},
        addEventListener(type, listener) {
            this.listeners[type] = listener;
        }
    };
    const storage = new Map();
    const document = {
        documentElement: { dataset: {} },
        getElementById(id) {
            return id === 'themeSelect' ? selector : null;
        },
        querySelectorAll() {
            return elements;
        }
    };
    const window = { localStorage: {
        getItem(key) {
            return storage.has(key) ? storage.get(key) : null;
        },
        setItem(key, value) {
            storage.set(key, String(value));
        }
    } };
    if (options.fetch) window.fetch = options.fetch;
    const sandbox = { window, document, console };
    vm.runInNewContext(fs.readFileSync(themeScriptPath, 'utf8'), sandbox, { filename: themeScriptPath });
    return { manager: sandbox.window.UiTheme, document, selector, storage };
}

test('主题管理器应保存主题并同步根元素和选择框', () => {
    const { manager, document, selector, storage } = loadThemeManager();

    manager.init();
    manager.apply('light');

    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(selector.value, 'light');
    assert.equal(storage.get('controlTheme'), 'light');
});

test('主题管理器应优先读取服务端全局主题，并在切换后保存到服务端', async () => {
    const requests = [];
    const { manager, document, selector, storage } = loadThemeManager([], {
        fetch: async (url, options = {}) => {
            requests.push({ url, options });
            if (!options.method) {
                return { ok: true, json: async () => ({ status: 'success', theme: 'ocean' }) };
            }
            return { ok: true, json: async () => ({ status: 'success', theme: 'girl-pink' }) };
        }
    });

    storage.set('controlTheme', 'warm');
    await manager.init();

    assert.equal(document.documentElement.dataset.theme, 'ocean');
    assert.equal(selector.value, 'ocean');
    assert.equal(storage.get('controlTheme'), 'ocean');

    manager.apply('girl-pink');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.documentElement.dataset.theme, 'girl-pink');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, '/api/config/controlTheme');
    assert.equal(requests[1].options.method, 'POST');
    assert.match(requests[1].options.body, /girl-pink/u);
});

test('主题管理器应支持显示端应用远程主题而不再次保存服务端', () => {
    const { manager, document, storage } = loadThemeManager();

    manager.applyRemoteTheme('mint');

    assert.equal(document.documentElement.dataset.theme, 'mint');
    assert.equal(storage.get('controlTheme'), 'mint');
});

test('服务端主题读取失败时应保留本地主题', async () => {
    const { manager, document, storage } = loadThemeManager([], {
        fetch: async () => {
            throw new Error('server unavailable');
        }
    });

    storage.set('controlTheme', 'warm');
    manager.init();
    await manager.ready;

    assert.equal(document.documentElement.dataset.theme, 'warm');
});

test('非法主题配置应回退为深色主题', () => {
    const { manager, document, storage } = loadThemeManager();
    storage.set('controlTheme', 'unknown');

    manager.init();

    assert.equal(document.documentElement.dataset.theme, 'dark');
});

test('主题管理器应按原生控件类型添加 UI 语义标记', () => {
    const elements = [
        createElement('button'),
        createElement('input', 'checkbox'),
        createElement('input', 'range'),
        createElement('select'),
        createElement('textarea'),
        createElement('h2')
    ];
    const { manager, document } = loadThemeManager(elements);

    manager.classify(document);

    assert.deepEqual(elements.map(element => element.dataset.uiType), [
        'button', 'checkbox', 'slider', 'select', 'textarea', 'title'
    ]);
});

test('动态插入的单个控件自身也应获得 UI 语义标记', () => {
    const button = createElement('button');
    const { manager } = loadThemeManager();

    manager.classify(button);

    assert.equal(button.dataset.uiType, 'button');
});

test('动态弹窗自身应获得 modal 语义标记', () => {
    const modal = createElement('div', '', ['modal-mask']);
    const { manager } = loadThemeManager();

    manager.classify(modal);

    assert.equal(modal.dataset.uiType, 'modal');
});

test('控制端页面应提供主题选择、主题脚本和主题变量', () => {
    const html = fs.readFileSync(uploadHtmlPath, 'utf8');
    const css = fs.readFileSync(themeCssPath, 'utf8');

    assert.match(html, /id="themeSelect"/u);
    assert.match(html, /js\/ui-theme\.js/u);
    assert.match(css, /--bg-primary/u);
    assert.match(css, /\[data-theme=["']light["']\]/u);
    assert.match(css, /\.modal-mask/u);
    assert.match(css, /\.playlist-settings-dialog/u);
});

test('控制端应提供完整的 15 种主题配色', () => {
    const html = fs.readFileSync(uploadHtmlPath, 'utf8');
    const css = fs.readFileSync(themeCssPath, 'utf8');
    const { manager } = loadThemeManager();
    const expectedThemes = [
        'dark', 'light', 'warm', 'pink', 'lavender-yellow', 'red-blue', 'gold',
        'mint', 'ocean', 'forest', 'slate', 'algae-salt', 'girl-pink',
        'rose-gold', 'new-year-red'
    ];

    assert.deepEqual(Array.from(manager.themes), expectedThemes);
    expectedThemes.slice(2).forEach((theme) => {
        assert.match(html, new RegExp(`value=["']${theme}["']`, 'u'));
        assert.match(css, new RegExp(`data-theme=["']${theme}["']`, 'u'));
    });
});

test('非深色主题应用时应启用浅色组件样式模式', () => {
    const { manager, document, selector } = loadThemeManager();

    manager.init();
    manager.apply('gold');

    assert.equal(document.documentElement.dataset.theme, 'gold');
    assert.equal(document.documentElement.dataset.themeMode, 'light');
    assert.equal(selector.value, 'gold');
});

test('浅色主题应覆盖弹窗中的遗留白色文字，并处理动态内联白字', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');

    assert.match(css, /\.task-confirm-title[\s\S]*color:\s*var\(--text-primary\)\s*!important/u);
    assert.match(css, /\.library-modal-header h3[\s\S]*color:\s*var\(--text-primary\)\s*!important/u);
    assert.match(css, /\.chat-modal-header h3[\s\S]*color:\s*var\(--text-primary\)\s*!important/u);
    assert.match(css, /\[style\*=["']color:\s*#fff["']\][^\{]*\{[\s\S]*color:\s*var\(--text-primary\)\s*!important/u);
});

test('浅色主题的卡片应使用独立的浅蓝色背景，不改变弹窗白色表面', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');

    assert.match(css, /:root\[data-theme="light"\][\s\S]*--card-background:\s*#eaf4ff/u);
    assert.match(css, /:root\[data-theme="light"\][\s\S]*--bg-surface-strong:\s*#eaf4ff/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.task-card[\s\S]*background:\s*var\(--card-background\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.media-library-item[\s\S]*background:\s*var\(--card-background\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.modal-content[\s\S]*background:\s*var\(--bg-surface-strong\)/u);
});

test('浅色主题应适配显示设备名、聊天消息和日志文字', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');

    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.display-item-id[\s\S]*color:\s*var\(--text-primary\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.chat-message\.assistant \.chat-message-content[\s\S]*color:\s*var\(--text-primary\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.chat-message\.assistant \.chat-message-content[\s\S]*background:\s*var\(--card-background\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.log-entries[\s\S]*background:\s*var\(--content-background\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.log-message[\s\S]*color:\s*var\(--text-primary\)\s*!important/u);
});

test('显示端信息和树状视图应消费基础主题色并让上层文字继承', () => {
    const css = fs.readFileSync(uploadCssPath, 'utf8');

    assert.match(css, /\.modal-content\s*\{[\s\S]*color:\s*var\(--text-primary(?:,\s*[^)]+)?\)/u);
    assert.match(css, /\.feature-name span:first-child\s*\{[\s\S]*color:\s*inherit/u);
    assert.match(css, /\.browser-detail-value\s*\{[\s\S]*color:\s*inherit/u);
    assert.match(css, /\.tree-label\s*\{[\s\S]*color:\s*inherit/u);
    assert.match(css, /\.tree-info-item\s*\{[\s\S]*color:\s*var\(--text-secondary(?:,\s*[^)]+)?\)/u);
    assert.match(css, /\.tree-setting-select\s*\{[\s\S]*background:\s*var\(--input-background(?:,\s*[^)]+)?\)[\s\S]*color:\s*inherit/u);
    assert.match(css, /\.tree-event-input\s*\{[\s\S]*background:\s*var\(--input-background(?:,\s*[^)]+)?\)[\s\S]*color:\s*inherit/u);
});

test('浅色主题的自定义 toggle 应明确区分未选中和选中状态', () => {
    const css = fs.readFileSync(themeCssPath, 'utf8');

    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.crop-debug-slider[\s\S]*background:\s*var\(--bg-secondary\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.crop-debug-slider[\s\S]*border:\s*1px\s+solid\s+var\(--border-color\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.crop-debug-slider::after[\s\S]*background:\s*var\(--text-muted\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.crop-debug-toggle input:checked \+ \.crop-debug-slider[\s\S]*background:\s*var\(--accent-color\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.crop-debug-toggle input:checked \+ \.crop-debug-slider::after[\s\S]*background:\s*#fff/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*input\[type="checkbox"\][\s\S]*accent-color:\s*var\(--accent-color\)/u);
});

test('设置页 LLM/系统路由按钮应通过 active 状态区分浅色主题选中项', () => {
    const html = fs.readFileSync(uploadHtmlPath, 'utf8');
    const css = fs.readFileSync(themeCssPath, 'utf8');

    assert.match(html, /id="routingWeatherLlm"[^>]*data-routing="weather"[^>]*data-value="llm"/u);
    assert.match(html, /id="routingWeatherSystem"[^>]*data-routing="weather"[^>]*data-value="system"/u);
    assert.match(html, /id="routingSearchLlm"[^>]*data-routing="search"[^>]*data-value="llm"/u);
    assert.match(html, /id="routingSearchSystem"[^>]*data-routing="search"[^>]*data-value="system"/u);
    assert.match(html, /classList\.toggle\('active', value === 'llm'\)/u);
    assert.match(html, /classList\.toggle\('active', value === 'system'\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.routing-grid \.control-btn:not\(\.active\)[\s\S]*background:\s*var\(--bg-secondary\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\][\s\S]*\.routing-grid \.control-btn\.active[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--accent-secondary\),\s*var\(--accent-color\)\)\s*!important/u);
});

test('显示控制的填充、旋转、中心缩放和播放状态应区分浅色选中态', () => {
    const html = fs.readFileSync(uploadHtmlPath, 'utf8');
    const css = fs.readFileSync(themeCssPath, 'utf8');

    assert.match(html, /id="panel-display"[\s\S]*data-fit="contain"/u);
    assert.match(html, /id="panel-display"[\s\S]*data-rotation="0"/u);
    assert.match(html, /id="centerResizeBtn"/u);
    assert.match(html, /id="playPauseBtn"/u);
    assert.match(html, /id="floatingControlPanel"[\s\S]*data-fit="contain"/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display \.control-btn\[data-fit\]:not\(\.active\)[\s\S]*background:\s*var\(--bg-secondary\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display \.control-btn\[data-fit\]\.active[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--accent-secondary\),\s*var\(--accent-color\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display \.control-btn\[data-rotation\]:not\(\.active\)[\s\S]*background:\s*var\(--bg-secondary\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display #playPauseBtn\.playing[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--success-color\),\s*var\(--accent-color\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display #playPauseBtn\.paused[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--danger-color\),\s*var\(--accent-secondary\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] \.floating-control-panel \.floating-btn\[data-fit\]:not\(\.active\)[\s\S]*background:\s*var\(--bg-secondary\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] \.floating-control-panel \.floating-btn\.active[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--accent-secondary\),\s*var\(--accent-color\)\)\s*!important/u);
});

test('显示控制设备和其他状态按钮应同步语义状态并适配浅色主题', () => {
    const html = fs.readFileSync(uploadHtmlPath, 'utf8');
    const css = fs.readFileSync(themeCssPath, 'utf8');
    const tts = fs.readFileSync(ttsScriptPath, 'utf8');
    const controls = fs.readFileSync(controlsScriptPath, 'utf8');
    const floatingControl = fs.readFileSync(floatingControlScriptPath, 'utf8');
    const mediaLibrary = fs.readFileSync(mediaLibraryScriptPath, 'utf8');

    const voiceprintPanelStart = html.indexOf('<section class="panel" id="panel-voiceprint"');
    const voiceprintPanelEnd = html.indexOf('</section>', voiceprintPanelStart);
    const voiceprintPanel = html.slice(voiceprintPanelStart, voiceprintPanelEnd);
    const beforeVoiceprintPanel = html.slice(0, voiceprintPanelStart);
    assert.match(voiceprintPanel, /id="asrDeviceServerBtn"[^>]*data-asr="server"/u);
    assert.match(voiceprintPanel, /id="asrDeviceDisplayBtn"[^>]*data-asr="display"/u);
    assert.match(voiceprintPanel, /id="ttsDeviceServerBtn"[^>]*data-tts="server"/u);
    assert.match(voiceprintPanel, /id="ttsDeviceDisplayBtn"[^>]*data-tts="display"/u);
    assert.doesNotMatch(beforeVoiceprintPanel, /id="asrDeviceServerBtn"|id="ttsDeviceServerBtn"/u);
    assert.match(tts, /serverBtn\.classList\.toggle\('active', this\.currentDevice === 'server'\)/u);
    const asrDeviceSource = tts.slice(tts.indexOf('const AsrDevice'), tts.indexOf('const TtsDevice'));
    assert.match(asrDeviceSource, /displayBtn\.classList\.toggle\('active', this\.currentDevice === 'display'\)/u);
    assert.match(tts, /btn\.classList\.toggle\('active', this\.autoTtsEnabled\)/u);
    assert.match(controls, /textPlaybackToggleBtn[\s\S]*classList\.toggle\('playing', isPlaying\)/u);
    assert.match(floatingControl, /floatingTextPlaybackToggleBtn[\s\S]*classList\.toggle\('playing', isPlaying\)/u);
    assert.match(mediaLibrary, /toggleBtn\.classList\.toggle\('playing', info\.state === 'playing'\)/u);
    assert.match(mediaLibrary, /toggleBtn\.classList\.toggle\('paused', info\.state === 'paused'\)/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display \[data-asr\]:not\(\.active\)[\s\S]*background:\s*var\(--bg-secondary\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display \[data-asr\]\.active[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--accent-secondary\),\s*var\(--accent-color\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display #autoTtsBtn\.active[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--accent-secondary\),\s*var\(--accent-color\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display #textPlaybackToggleBtn\.playing[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--success-color\),\s*var\(--accent-color\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] #panel-display #textPlaybackToggleBtn\.paused[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--danger-color\),\s*var\(--accent-secondary\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] \.selection-mode-btn\.active[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--accent-secondary\),\s*var\(--accent-color\)\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\] \.task-btn-option:not\(\.active\)[\s\S]*background:\s*var\(--bg-secondary\)\s*!important/u);
});
