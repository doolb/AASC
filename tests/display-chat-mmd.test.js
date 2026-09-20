const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'src/apps/web-mediacenter/ui/public');

function readPublic(relativePath) {
    return fs.readFileSync(path.join(PUBLIC_DIR, relativePath), 'utf8');
}

test('display.html 使用同页舞台模块，不为聊天或 MMD 创建 iframe', () => {
    const html = readPublic('display.html');
    assert.match(html, /id="displayStageLayers"/u);
    assert.match(html, /id="displayChatLayer"/u);
    assert.match(html, /id="displayMmdCanvas"/u);
    assert.match(html, /js\/display-stage\.js/u);
    assert.match(html, /js\/display-chat\.js/u);
    assert.match(html, /js\/display-mmd\.js/u);
    assert.match(html, /js\/display-mmd-command-adapter\.js/u);
    assert.match(html, /css\/display-chat\.css/u);
    assert.match(html, /css\/display-mmd\.css/u);
    assert.doesNotMatch(html, /display(?:Chat|Mmd)[^<]*<iframe/iu);
});

test('显示端模块通过现有 WebSocket 注入，不创建第二条连接', () => {
    const stage = readPublic('js/display-stage.js');
    const chat = readPublic('js/display-chat.js');
    const mmd = readPublic('js/display-mmd.js');
    assert.match(stage, /setTransport/u);
    assert.match(stage, /requestInitialSnapshot/u);
    assert.doesNotMatch(stage, /new\s+WebSocket/iu);
    assert.doesNotMatch(chat, /new\s+WebSocket/iu);
    assert.doesNotMatch(mmd, /new\s+WebSocket/iu);
    assert.match(chat, /source:\s*'displayChat'/u);
});

test('舞台等待 DOMContentLoaded 后初始化，避免 defer 模块尚未注册', () => {
    const stage = readPublic('js/display-stage.js');
    assert.match(stage, /readyState === 'loading' \|\| document\.readyState === 'interactive'/u);
    assert.match(stage, /addEventListener\('DOMContentLoaded', initialize/u);
    assert.match(stage, /DisplayChat\/DisplayMmd 已经暴露 init 方法/u);
});

test('聊天隐藏后才允许 MMD Canvas 接收点击，并展示 think 内容', () => {
    const stage = readPublic('js/display-stage.js');
    const chat = readPublic('js/display-chat.js');
    const mmd = readPublic('js/display-mmd.js');
    assert.match(stage, /setPointerEnabled\(state\.mmdVisible && !state\.chatVisible\)/u);
    assert.match(mmd, /mmd\.interaction/u);
    assert.match(mmd, /fallbackHitTest/u);
    assert.match(chat, /display-chat-think/u);
    assert.match(chat, /<think>/u);
});

test('聊天打开时隐藏播报文字但不改变 TTS 播放链路', () => {
    const stage = readPublic('js/display-stage.js');
    const displayCss = readPublic('css/display.css');
    const displayHtml = readPublic('display.html');
    assert.match(stage, /classList\.toggle\('display-chat-open', state\.chatVisible\)/u);
    assert.match(displayCss, /body\.display-chat-open #voiceTextDisplay\s*\{[\s\S]*display:\s*none !important/u);
    assert.match(displayHtml, /function showTtsText\(text\)[\s\S]*voiceTextDisplay\.className = 'voice-text-visible'/u);
    assert.match(displayHtml, /ttsAudio\.play\(\)/u);
});

test('显示端聊天和 MMD 开关固定在左下角并避让安全区', () => {
    const css = readPublic('css/display-mmd.css');
    assert.match(css, /\.display-interaction-layer\s*\{[\s\S]*align-items:\s*flex-end/u);
    assert.match(css, /safe-area-inset-bottom/u);
    assert.match(css, /--display-keyboard-inset/u);
});

test('render-display 只位于媒体层之上，聊天舞台位于 render-display 之上', () => {
    const displayCss = readPublic('css/display.css');
    const mmdCss = readPublic('css/display-mmd.css');
    assert.match(displayCss, /\.render-task-overlay\s*\{[\s\S]*z-index:\s*100/u);
    assert.match(mmdCss, /\.display-stage-layers\s*\{[\s\S]*z-index:\s*200/u);
});

test('显示端聊天对象和会话使用 HTML 下拉菜单并复用主题变量', () => {
    const chat = readPublic('js/display-chat.js');
    const css = readPublic('css/display-chat.css');
    assert.doesNotMatch(chat, /<select[\s>]/u);
    assert.match(chat, /display-chat-dropdown-menu/u);
    assert.match(css, /var\(--bg-secondary\)/u);
    assert.match(css, /var\(--text-primary\)/u);
    assert.match(css, /var\(--accent-color\)/u);
});

test('HTML 下拉菜单区分未选中、悬停和已选中颜色', () => {
    const css = readPublic('css/display-chat.css');
    assert.match(css, /\.display-chat-dropdown-option:hover,[\s\S]*color-mix\(in srgb, var\(--accent-color\) 14%/u);
    assert.match(css, /\.display-chat-dropdown-option\[aria-selected="true"\]\s*\{[\s\S]*background:\s*var\(--accent-color\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[aria-selected="true"\]:hover,[\s\S]*background:\s*var\(--accent-secondary\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[aria-selected="true"\]\s*\{[\s\S]*color:\s*var\(--bg-primary\)/u);
});

test('显示端聊天全屏同位，外层背景透明而聊天控件使用实色主题背景', () => {
    const css = readPublic('css/display-chat.css');
    assert.match(css, /\.display-chat-layer\s*\{[\s\S]*padding:\s*0/u);
    assert.match(css, /\.display-chat-window\s*\{[\s\S]*width:\s*100%[\s\S]*height:\s*100%[\s\S]*background:\s*transparent/u);
    assert.match(css, /\.display-chat-header\s*\{[\s\S]*background:\s*var\(--bg-secondary\)/u);
    assert.match(css, /\.display-chat-status\s*\{[\s\S]*background:\s*var\(--bg-secondary\)/u);
    assert.match(css, /\.display-chat-compose\s*\{[\s\S]*background:\s*var\(--bg-secondary\)/u);
    assert.match(css, /\.display-chat-messages\s*\{[\s\S]*background:\s*transparent/u);
});

test('MMD 动作适配器只允许固定低级命令并限制计划步数', () => {
    const adapter = readPublic('js/display-mmd-command-adapter.js');
    assert.match(adapter, /MOTION_ADD/u);
    assert.match(adapter, /MOTION_DELETE/u);
    assert.match(adapter, /MODEL_BINDFACE/u);
    assert.match(adapter, /MODEL_BINDBONE/u);
    assert.match(adapter, /MAX_PLAN_STEPS = 32/u);
    assert.match(adapter, /不支持的 MMD 命令/u);
});

test('服务端区分显示端聊天同步和控制端 think 历史', () => {
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    const llm = fs.readFileSync(path.join(ROOT, 'src/external/llm/llm-service.js'), 'utf8');
    assert.match(server, /isDisplayChatSource/u);
    assert.match(server, /broadcastToControls\(\{[\s\S]{0,180}displayId/u);
    assert.match(server, /preserveThink:\s*data\.source === 'displayChat'/u);
    assert.match(server, /if \(data\.source === 'displayChat'\)/u);
    assert.match(llm, /function getHistory\(\)/u);
    assert.match(llm, /preserveThink/u);
});
