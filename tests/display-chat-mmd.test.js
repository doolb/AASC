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
    assert.match(html, /type="importmap"/u);
    assert.match(html, /@pixiv\/three-vrm/u);
    assert.match(html, /css\/display-chat\.css/u);
    assert.match(html, /css\/display-mmd\.css/u);
    assert.doesNotMatch(html, /display(?:Chat|Mmd)[^<]*<iframe/iu);
});

test('显示端模块通过现有 WebSocket 注入，不创建第二条连接', () => {
    const stage = readPublic('js/display-stage.js');
    const chat = readPublic('js/display-chat.js');
    const mmd = readPublic('js/display-mmd.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(stage, /setTransport/u);
    assert.match(stage, /requestInitialSnapshot/u);
    assert.doesNotMatch(stage, /new\s+WebSocket/iu);
    assert.doesNotMatch(chat, /new\s+WebSocket/iu);
    assert.doesNotMatch(mmd, /new\s+WebSocket/iu);
    assert.match(mmd, /display-vrm-runtime\.js/u);
    assert.match(vrm, /GLTFLoader/u);
    assert.match(vrm, /KTX2Loader/u);
    assert.match(vrm, /VRMLoaderPlugin/u);
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
    assert.match(mmd, /default-vroid\.vrm\.zst/u);
    assert.match(mmd, /\/api\/vrm\/model\/static/u);
    assert.match(chat, /display-chat-think/u);
    assert.match(chat, /<think>/u);
});

test('聊天打开时隐藏播报文字但不改变 TTS 播放链路', () => {
    const stage = readPublic('js/display-stage.js');
    const displayCss = readPublic('css/display.css');
    const displayHtml = readPublic('display.html');
    assert.match(stage, /classList\.toggle\('display-chat-open', state\.chatVisible\)/u);
    assert.match(stage, /dataset\.chatSuppressed = String\(state\.chatVisible\)/u);
    assert.match(displayCss, /body\.display-chat-open #voiceTextDisplay\s*\{[\s\S]*display:\s*none !important/u);
    assert.match(displayCss, /#voiceTextDisplay\[data-chat-suppressed="true"\][\s\S]*display:\s*none !important/u);
    assert.match(displayHtml, /function showTtsText\(text\)[\s\S]*voiceTextDisplay\.className = 'voice-text-visible'/u);
    assert.match(displayHtml, /ttsAudio\.play\(\)/u);
    assert.match(stage, /refreshVoiceTextVisibility/u);
    assert.match(displayHtml, /DisplayStage\?\.refreshVoiceTextVisibility/u);
});

test('天气详情位于 MMD 上方、聊天层下方，并在聊天关闭后按原计时恢复', () => {
    const html = readPublic('display.html');
    const mmdCss = readPublic('css/display-mmd.css');
    const displayCss = readPublic('css/display.css');
    assert.match(html, /id="displayMmdLayer"[\s\S]*id="displayBroadcastLayer"[\s\S]*id="displayChatLayer"/u);
    assert.match(mmdCss, /\.display-mmd-layer\s*\{[\s\S]*?z-index:\s*10/u);
    assert.match(mmdCss, /\.display-stage-broadcast-layer\s*\{[\s\S]*?z-index:\s*15/u);
    assert.match(readPublic('css/display-chat.css'), /\.display-chat-layer\s*\{[\s\S]*?z-index:\s*20/u);
    assert.match(displayCss, /body\.display-chat-open \.display-chat-suppressible\s*\{[\s\S]*display:\s*none !important/u);
    assert.match(html, /data\.action === 'weatherResult'[\s\S]*suppressWhenChatVisible:\s*true/u);
    assert.match(html, /setTimeout\(\(\) => \{[\s\S]*popup\.remove\(\)/u);
});

test('聊天层隐藏和重新显示时保留当前角色与会话选择', () => {
    const chat = readPublic('js/display-chat.js');
    assert.match(chat, /hiddenSelection/u);
    assert.match(chat, /state\.hiddenSelection = cloneSelection\(\)/u);
    assert.match(chat, /restoreHiddenSelection\(\)/u);
    assert.match(chat, /roleTarget: state\.session\.roleTarget/u);
});

test('聊天层打开时同步当前监听对象并暂停当前显示端服务器倒计时', () => {
    const stage = readPublic('js/display-stage.js');
    const chat = readPublic('js/display-chat.js');
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(chat, /getVoiceConversationContext/u);
    assert.match(chat, /state\.bus\.publish\('chat\.selection'/u);
    assert.match(stage, /type: 'displayChatVisibility'/u);
    assert.match(stage, /syncDisplayChatVoiceContext\(state\.chatVisible\)/u);
    assert.match(server, /displayTypes: \[[\s\S]*'displayChatVisibility'/u);
    assert.match(server, /function handleDisplayChatVisibility\(displayId, data\)/u);
    assert.match(server, /chatLayerPauseRemainingMs/u);
    assert.match(server, /preserveRemaining: true/u);
});

test('显示端接收语音聊天输入并按 requestId 渲染流式回复', () => {
    const stage = readPublic('js/display-stage.js');
    const chat = readPublic('js/display-chat.js');
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(stage, /'chatInput'/u);
    assert.match(chat, /message\.type === 'chatInput'/u);
    assert.match(chat, /state\.streaming\.has\(requestId\)/u);
    assert.match(server, /const sendVoiceChatUpdate =/u);
    assert.match(server, /sendToDisplay\(targetDisplayId, msg\)/u);
});

test('聊天层语音输入绕过普通确认并把聊天流回传来源显示端', () => {
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(server, /const isDisplayChatVoiceInput = isDisplayVoiceInput[\s\S]*chatLayerVisible === true/u);
    assert.match(server, /if \(isDisplayVoiceInput[\s\S]*!isDisplayChatVoiceInput[\s\S]*conversationConfirmationMode/u);
    assert.match(server, /result\.type === 'chat'[\s\S]*sendToControl: sendVoiceChatUpdate/u);
});

test('聊天输入区将发送和清空按钮竖向放在输入框右侧且发送在上', () => {
    const chat = readPublic('js/display-chat.js');
    const css = readPublic('css/display-chat.css');
    assert.match(chat, /<textarea data-role="input"[\s\S]*<div class="display-chat-compose-actions">[\s\S]*display-chat-send[\s\S]*data-action="clear"/u);
    assert.match(css, /\.display-chat-compose\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
    assert.match(css, /\.display-chat-compose-actions\s*\{[\s\S]*flex-direction:\s*column[\s\S]*min-width:\s*4\.5rem/u);
    assert.match(css, /\.display-chat-compose-actions button\s*\{[\s\S]*flex:\s*1 1 0/u);
});

test('控制端通过单按钮控制 MMD，显示端手动操作同步到服务端', () => {
    const controls = readPublic('js/controls.js');
    const websocket = readPublic('js/websocket.js');
    const stage = readPublic('js/display-stage.js');
    const display = readPublic('display.html');
    const upload = readPublic('upload.html');
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    const config = fs.readFileSync(path.join(ROOT, 'src/apps/server/modules/config/config-app-service.js'), 'utf8');
    assert.match(upload, /id="mmdVisibilityToggle"[\s\S]*MMD 状态同步中/u);
    assert.doesNotMatch(upload, /data-mmd-visibility=/u);
    assert.match(controls, /toggleMmdVisibility()/u);
    assert.match(controls, /sendControl\('mmdVisibility', visible\)/u);
    assert.match(controls, /button\.textContent = visible \? '隐藏 MMD' : '显示 MMD'/u);
    assert.match(websocket, /extraData\.mmdVisible/u);
    assert.match(websocket, /mmdVisibilityChanged/u);
    assert.match(stage, /mmdVisibilityRequest/u);
    assert.match(display, /case 'mmdVisibility'/u);
    assert.match(display, /ackExtra = \{ mmdVisible: data\.value === true \}/u);
    assert.match(server, /mmdVisibilityRequest/u);
    assert.match(server, /mmdVisible: true/u);
    assert.match(server, /persistDisplayState\(displayData, \{ mmdVisible: normalizedVisible \}\)/u);
    assert.match(config, /mmdVisible: true/u);
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
    assert.match(mmdCss, /\.display-stage-layers\s*\{[\s\S]*z-index:\s*3000/u);
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

test('聊天对象下拉只显示群聊或助手名称并保留内部目标路由', () => {
    const chat = readPublic('js/display-chat.js');
    assert.match(chat, /const targets = \[\{ value: 'group', title: '群聊', kind: 'group' \}\]/u);
    assert.match(chat, /for \(const assistantName of state\.assistantNames\)/u);
    assert.match(chat, /value: `private:\$\{assistantName\}`,\s*title: assistantName,\s*kind: 'assistant'/u);
    assert.match(chat, /targets\.push\(\{ value: `role:\$\{name\}`, title: name, kind: 'assistant' \}\)/u);
    assert.match(chat, /label: target\.title,\s*kind: target\.kind/u);
    assert.match(chat, /option\.dataset\.targetKind = item\.kind/u);
    assert.doesNotMatch(chat, /target\.title\} · \$\{target\.hint\}/u);
    assert.doesNotMatch(chat, /hint: '(?:所有角色|私聊|角色)'/u);
});

test('显示端多助手和群聊历史通过服务器范围接口切换', () => {
    const chat = readPublic('js/display-chat.js');
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    const llm = fs.readFileSync(path.join(ROOT, 'src/external/llm/llm-service.js'), 'utf8');
    assert.match(chat, /config\.defaultName[\s\S]*\.\.\.configuredNames/u);
    assert.match(chat, /type: 'chatHistory',[\s\S]*source: 'displayChat',[\s\S]*mode: state\.session\.mode/u);
    assert.match(chat, /if \(isRole\)[\s\S]*type: 'roleHistory'/u);
    assert.match(chat, /message\.type === 'roleHistory'/u);
    assert.match(readPublic('js/display-stage.js'), /'roleHistory'/u);
    assert.match(chat, /state\.history = filterHistoryForCurrentSession\(message\.history\)/u);
    assert.match(chat, /state\.history = \[\];[\s\S]*renderHistory\(\);[\s\S]*type: 'setChatSession'/u);
    assert.match(server, /const historyOptions = isDisplayChatSource[\s\S]*mode: data\.mode \|\| 'group'/u);
    assert.match(server, /chat\.getHistory\(historyOptions\)/u);
    assert.match(llm, /function filterHistoryByScope\(messages, options = \{\}\)/u);
    assert.match(llm, /messageMode === 'private'[\s\S]*message\.target/u);
});

test('控制端收到会话广播后重新渲染当前历史', () => {
    const chat = readPublic('js/chat.js');
    assert.match(chat, /handleSession\(data\)[\s\S]*this\.renderSessionSelector\(\);[\s\S]*this\.renderHistory\(\);/u);
});

test('HTML 下拉菜单区分未选中、悬停和已选中颜色', () => {
    const chat = readPublic('js/display-chat.js');
    const css = readPublic('css/display-chat.css');
    const activity = fs.readFileSync(
        path.join(ROOT, 'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'),
        'utf8'
    );
    assert.match(chat, /const isSelected = item\.value === selected\?\.value/u);
    assert.match(chat, /option\.dataset\.selected = String\(isSelected\)/u);
    assert.match(chat, /display-chat-dropdown-option.*is-selected/u);
    assert.match(chat, /function renderTargetOptions\(\)[\s\S]*renderDropdown/u);
    assert.match(chat, /function renderSessionOptions\(\)[\s\S]*renderDropdown/u);
    assert.match(css, /\.display-chat-dropdown-option:hover,[\s\S]*color-mix\(in srgb, var\(--accent-color\) 14%/u);
    assert.match(css, /\.display-chat-dropdown-option\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--bg-surface-strong\) 82%, var\(--bg-primary\)\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[aria-selected="true"\],[\s\S]*\.display-chat-dropdown-option\.is-selected\s*\{[\s\S]*background:\s*var\(--dropdown-option-selected-background\)[\s\S]*border-left-color:\s*var\(--accent-secondary\)[\s\S]*color:\s*var\(--text-primary\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[aria-selected="true"\]::after,[\s\S]*content:\s*'✓'/u);
    assert.match(css, /\.display-chat-dropdown-option\.is-selected:hover,[\s\S]*background:\s*var\(--dropdown-option-selected-hover-background\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[data-target-kind="group"\][\s\S]*--dropdown-option-selected-background/u);
    assert.match(css, /\.display-chat-dropdown-option\[data-target-kind="assistant"\][\s\S]*--dropdown-option-selected-background/u);
    assert.match(css, /--dropdown-option-background:\s*color-mix\(in srgb, var\(--accent-color\) 12%, var\(--bg-surface-strong\)\)/u);
    assert.match(activity, /layoutParams\.leftMargin = if \(collapsed\) -dp\(21\) else dp\(12\)/u);
    assert.match(activity, /layoutParams\.topMargin = if \(collapsed\) 0 else dp\(12\)/u);
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
    assert.match(llm, /filterHistoryByScope/u);
});

test('服务端提供 VRoid profile 和同源 VRM 代理', () => {
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    const service = fs.readFileSync(path.join(ROOT, 'src/apps/server/modules/vrm/vroid-model-service.js'), 'utf8');
    assert.match(server, /app\.get\('\/api\/vrm\/model'/u);
    assert.match(server, /app\.get\('\/api\/vrm\/model\/file'/u);
    assert.match(server, /app\.get\('\/api\/vrm\/model\/static'/u);
    assert.match(server, /createStaticMmdModelProfile/u);
    assert.match(service, /X-Api-Version/u);
    assert.match(service, /cloudfront\.net/u);
    assert.match(service, /http:\/\/c\.aasc\.us\/mnt\/mmd\//u);
    assert.match(service, /resolveStaticMmdAssetUrl/u);
    assert.match(service, /MAX_MODEL_BYTES/u);
});
