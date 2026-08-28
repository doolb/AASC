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

function loadThemeManager(elements = []) {
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

test('控制端应提供完整的 12 种主题配色', () => {
    const html = fs.readFileSync(uploadHtmlPath, 'utf8');
    const css = fs.readFileSync(themeCssPath, 'utf8');
    const { manager } = loadThemeManager();
    const expectedThemes = [
        'dark', 'light', 'warm', 'pink', 'lavender-yellow', 'red-blue', 'gold',
        'mint', 'ocean', 'forest', 'slate', 'algae-salt'
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
