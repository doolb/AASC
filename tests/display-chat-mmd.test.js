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

test('显示端提供右上角灯光按钮和详细设置面板', () => {
    const html = readPublic('display.html');
    const css = readPublic('css/display-mmd.css');
    const lighting = readPublic('js/display-mmd-lighting.js');
    assert.match(html, /id="displayMmdLightingToggle"/u);
    assert.match(html, /id="displayMmdLightingPanel"/u);
    assert.match(html, /id="displayMmdAmbientIntensity"/u);
    assert.match(html, /id="displayMmdKeyPositionX"/u);
    assert.match(html, /js\/display-mmd-lighting\.js/u);
    assert.match(css, /\.display-stage-lighting-control\s*\{[\s\S]*top:/u);
    assert.match(css, /\.display-stage-lighting-control\s*\{[\s\S]*right:/u);
    assert.match(css, /\.display-mmd-lighting-panel\s*\{/u);
    assert.match(lighting, /localStorage/u);
    assert.match(html, /id="displayMmdLightingReset"[\s\S]*恢复默认/u);
});

test('灯光按钮位于时间区域下方并提供默认开启的阴影开关', () => {
    const html = readPublic('display.html');
    const css = readPublic('css/display-mmd.css');
    const lighting = readPublic('js/display-mmd-lighting.js');
    assert.match(html, /id="displayMmdShadowEnabled"[^>]*checked/u);
    assert.match(css, /\.display-stage-lighting-control\s*\{[\s\S]*top:\s*calc\(/u);
    assert.match(css, /clamp\(64px, 12vh, 104px\)/u);
    assert.match(lighting, /shadowEnabled/u);
});

test('显示端定位入口位于右上角灯光按钮正下方，不新增 AI 模式按钮', () => {
    const html = readPublic('display.html');
    const css = readPublic('css/display-mmd.css');
    const ar = readPublic('js/display-mmd-ar.js');
    assert.match(html, /id="displayMmdLightingToggle"[\s\S]*id="displayArTargetToggle"[\s\S]*id="displayMmdLightingPanel"/u);
    assert.match(html, /id="displayArTargetPanel"[\s\S]*id="displayArCalibration"/u);
    assert.match(html, /js\/display-mmd-ar\.js/u);
    assert.match(css, /\.display-stage-lighting-control\s*\{[\s\S]*flex-direction:\s*column/u);
    assert.match(css, /\.display-mmd-ar-panel\s*\{/u);
    assert.doesNotMatch(html, /displayAiModeToggle/u);
    assert.match(ar, /aasc-mmd-ar/u);
    assert.match(ar, /displayArTargetToggle/u);
});

test('AR 第一阶段只在显示端本地管理目标并释放摄像头', () => {
    const ar = readPublic('js/display-mmd-ar.js');
    assert.match(ar, /indexedDB\.open/u);
    assert.match(ar, /getUserMedia/u);
    assert.match(ar, /selectedQuad/u);
    assert.match(ar, /requestVideoFrameCallback/u);
    assert.match(ar, /DisplayMmdImageTargetTracker/u);
    assert.match(ar, /pagehide/u);
    assert.match(ar, /track\.stop\(\)/u);
    assert.doesNotMatch(ar, /new\s+WebSocket/u);
    assert.doesNotMatch(ar, /fetch\(/u);
});

test('AR 体感观察只控制虚拟相机，不覆盖屏幕拖动的角色旋转', () => {
    const html = readPublic('display.html');
    const ar = readPublic('js/display-mmd-ar.js');
    const mmd = readPublic('js/display-mmd.js');
    const pmx = readPublic('js/display-pmx-runtime.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(html, /id="displayArMotionEnabled"[\s\S]*体感观察（只移动视角）/u);
    assert.match(html, /id="displayArMotionSensitivity"/u);
    assert.match(html, /id="displayArMotionRecenter"/u);
    assert.match(ar, /deviceorientation/u);
    assert.match(ar, /DisplayMmd\?\.setCameraViewRotation/u);
    assert.match(ar, /不调用 rotateModelBy/u);
    assert.match(ar, /resetCameraViewRotation/u);
    assert.match(mmd, /setCameraViewRotation/u);
    assert.match(mmd, /resetCameraViewRotation/u);
    assert.match(pmx, /setCameraViewRotation/u);
    assert.match(pmx, /updateCameraView/u);
    assert.match(vrm, /setCameraViewRotation/u);
    assert.match(vrm, /updateCameraView/u);
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

test('MMD 显示模块保存规范化灯光并在 runtime 创建后应用', () => {
    const mmd = readPublic('js/display-mmd.js');
    const pmx = readPublic('js/display-pmx-runtime.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(mmd, /DEFAULT_MMD_LIGHTING/u);
    assert.match(mmd, /setLighting/u);
    assert.match(mmd, /state\.runtime\.setLighting/u);
    assert.match(pmx, /new THREE\.AmbientLight\(0xffffff, 1\.8\)/u);
    assert.match(pmx, /new THREE\.DirectionalLight\(0xffffff, 2\.3\)/u);
    assert.match(pmx, /setLighting/u);
    assert.match(vrm, /setLighting/u);
});

test('PMX 和 VRM runtime 提供默认开启的实时阴影', () => {
    const pmx = readPublic('js/display-pmx-runtime.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(pmx, /renderer\.shadowMap\.enabled/u);
    assert.match(pmx, /THREE\.PCFSoftShadowMap/u);
    assert.match(pmx, /new THREE\.ShadowMaterial/u);
    assert.match(pmx, /castShadow\s*=\s*shadowEnabled/u);
    assert.match(pmx, /receiveShadow\s*=\s*shadowEnabled/u);
    assert.match(pmx, /shadowEnabled/u);
    assert.match(vrm, /renderer\.shadowMap\.enabled/u);
    assert.match(vrm, /THREE\.PCFSoftShadowMap/u);
    assert.match(vrm, /new THREE\.ShadowMaterial/u);
    assert.match(vrm, /castShadow\s*=\s*shadowEnabled/u);
    assert.match(vrm, /receiveShadow\s*=\s*shadowEnabled/u);
    assert.match(vrm, /shadowEnabled/u);
});

test('PMX 和 VRM runtime 按模型范围定位高质量阴影相机', () => {
    const pmx = readPublic('js/display-pmx-runtime.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(pmx, /SHADOW_MAP_SIZE\s*=\s*1024/u);
    assert.match(pmx, /shadow\.mapSize\.set\(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE\)/u);
    assert.match(pmx, /fitShadowCamera/u);
    assert.match(pmx, /keyLight\.target\.position\.copy/u);
    assert.match(pmx, /shadowCamera\.updateProjectionMatrix/u);
    assert.match(vrm, /SHADOW_MAP_SIZE\s*=\s*1024/u);
    assert.match(vrm, /shadow\.mapSize\.set\(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE\)/u);
    assert.match(vrm, /fitShadowCamera/u);
    assert.match(vrm, /keyLight\.target\.position\.copy/u);
    assert.match(vrm, /shadowCamera\.updateProjectionMatrix/u);
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

test('MMD 空白区域拖动只旋转本地角色并保留命中角色的点击互动', () => {
    const mmd = readPublic('js/display-mmd.js');
    const pmx = readPublic('js/display-pmx-runtime.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(mmd, /POINTER_DRAG_THRESHOLD/u);
    assert.match(mmd, /function handlePointerDown\(event\)[\s\S]*const hitPart = raycast\(point\)[\s\S]*if \(hitPart\)/u);
    assert.match(mmd, /function handlePointerMove\(event\)[\s\S]*state\.blankDrag[\s\S]*rotateModelBy/u);
    assert.match(mmd, /function finishBlankDrag\(pointerId\)[\s\S]*releasePointerCapture[\s\S]*finishModelRotation/u);
    assert.match(mmd, /function handlePointerUp\(event\)[\s\S]*finishBlankDrag\(event\.pointerId\)[\s\S]*triggerInteraction/u);
    assert.match(pmx, /const rotateModelBy = \(yawRadians, pitchRadians = 0\)[\s\S]*rotationState\.targetYaw \+= yawDelta/u);
    assert.match(pmx, /const finishModelRotation = \(\)[\s\S]*fitShadowWhenSettled/u);
    assert.match(vrm, /function rotateModelBy\(yawRadians, pitchRadians = 0\)[\s\S]*rotationState\.targetYaw \+= yawDelta/u);
    assert.match(vrm, /function finishModelRotation\(\)[\s\S]*fitShadowWhenSettled/u);
});

test('MMD 空白区域上下拖动以受限俯仰角旋转 PMX 和 VRM 角色', () => {
    const mmd = readPublic('js/display-mmd.js');
    const pmx = readPublic('js/display-pmx-runtime.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(mmd, /const deltaY = point\.y - drag\.lastPoint\.y/u);
    assert.match(mmd, /rotateModelBy\?\.\(deltaX \* ROTATION_RADIANS_PER_PIXEL, deltaY \* ROTATION_RADIANS_PER_PIXEL\)/u);
    assert.match(pmx, /MAX_MODEL_PITCH_RADIANS\s*=\s*Math\.PI \/ 4/u);
    assert.match(pmx, /rotationState\.targetPitch\s*=\s*Math\.max\(\s*-MAX_MODEL_PITCH_RADIANS,[\s\S]*rotationState\.targetPitch \+ pitchDelta/u);
    assert.match(vrm, /MAX_MODEL_PITCH_RADIANS\s*=\s*Math\.PI \/ 4/u);
    assert.match(vrm, /rotationState\.targetPitch\s*=\s*Math\.max\(\s*-MAX_MODEL_PITCH_RADIANS,[\s\S]*rotationState\.targetPitch \+ pitchDelta/u);
});

test('PMX 和 VRM 以模型中心枢轴缓动旋转，并在静止后更新阴影范围', () => {
    const pmx = readPublic('js/display-pmx-runtime.js');
    const vrm = readPublic('js/display-vrm-runtime.js');
    assert.match(pmx, /function createModelRotationPivot\(model\)[\s\S]*bounds\.getCenter[\s\S]*pivot\.attach\(model\)/u);
    assert.match(pmx, /ROTATION_EASING_PER_SECOND/u);
    assert.match(pmx, /function updateModelRotation\(delta\)[\s\S]*Math\.exp\(-ROTATION_EASING_PER_SECOND \* delta\)/u);
    assert.match(pmx, /currentRotationPivot\.rotation\.x/u);
    assert.match(pmx, /finishModelRotation[\s\S]*fitShadowWhenSettled/u);
    assert.match(vrm, /function createModelRotationPivot\(model\)[\s\S]*bounds\.getCenter[\s\S]*pivot\.attach\(model\)/u);
    assert.match(vrm, /ROTATION_EASING_PER_SECOND/u);
    assert.match(vrm, /function updateModelRotation\(delta\)[\s\S]*Math\.exp\(-ROTATION_EASING_PER_SECOND \* delta\)/u);
    assert.match(vrm, /currentRotationPivot\.rotation\.x/u);
    assert.match(vrm, /finishModelRotation[\s\S]*fitShadowWhenSettled/u);
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

test('HTML 下拉菜单在浅色主题通用按钮皮肤下仍保留状态底色', () => {
    const chat = readPublic('js/display-chat.js');
    const css = readPublic('css/display-chat.css');
    const theme = readPublic('css/theme.css');
    assert.match(chat, /const isSelected = item\.value === selected\?\.value/u);
    assert.match(chat, /option\.dataset\.selected = String\(isSelected\)/u);
    assert.match(chat, /display-chat-dropdown-option.*is-selected/u);
    assert.match(chat, /function renderTargetOptions\(\)[\s\S]*renderDropdown/u);
    assert.match(chat, /function renderSessionOptions\(\)[\s\S]*renderDropdown/u);
    assert.match(css, /\.display-chat-dropdown-option:hover,[\s\S]*color-mix\(in srgb, var\(--card-background\) 78%, var\(--accent-color\)\)/u);
    assert.match(css, /\.display-chat-dropdown-option\s*\{[\s\S]*background:\s*var\(--card-background\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[aria-selected="true"\],[\s\S]*\.display-chat-dropdown-option\.is-selected\s*\{[\s\S]*background:\s*var\(--dropdown-option-selected-background\)[\s\S]*border-left-color:\s*var\(--accent-secondary\)[\s\S]*color:\s*var\(--text-primary\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[aria-selected="true"\]::after,[\s\S]*content:\s*'✓'/u);
    assert.match(css, /\.display-chat-dropdown-option\.is-selected:hover,[\s\S]*background:\s*var\(--dropdown-option-selected-hover-background\)/u);
    assert.match(css, /\.display-chat-dropdown-option\[data-target-kind="group"\][\s\S]*--dropdown-option-selected-background/u);
    assert.match(css, /\.display-chat-dropdown-option\[data-target-kind="assistant"\][\s\S]*--dropdown-option-selected-background/u);
    assert.match(css, /--dropdown-option-background:\s*var\(--card-background\)/u);
    assert.doesNotMatch(css, /\.display-chat-dropdown-option\[data-target-kind="(?:group|assistant)"\][\s\S]*--dropdown-option-background/u);
    assert.match(theme, /:root\[data-theme-mode="light"\]\s+button:not\(\.file-label\)[\s\S]*background:\s*linear-gradient\([^;]+\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\]\s+button\.display-chat-dropdown-option\s*\{[\s\S]*background:\s*var\(--card-background\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\]\s+button\.display-chat-dropdown-option:hover,[\s\S]*background:\s*var\(--dropdown-option-hover-background\)\s*!important/u);
    assert.match(css, /:root\[data-theme-mode="light"\]\s+button\.display-chat-dropdown-option\.is-selected\s*\{[\s\S]*background:\s*var\(--dropdown-option-selected-background\)\s*!important/u);
});

test('Android 控制端收起入口保持边缘吸附', () => {
    const activity = fs.readFileSync(
        path.join(ROOT, 'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt'),
        'utf8'
    );
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

test('显示端默认请求本地 PMX/VMD 清单且不把资源加入 Offline APK', () => {
    const mmd = readPublic('js/display-mmd.js');
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(mmd, /\/api\/mmd\/resources/u);
    assert.match(mmd, /\/models\/mmd\//u);
    assert.match(server, /modelRoot:\s*path\.join\(PROJECT_ROOT, 'res', 'models'\)/u);
    assert.doesNotMatch(mmd, /release\/apkbuild|build:apk/u);
});

test('服务端为 Offline MMD 注册固定同源静态路径代理且保留 VRM 静态路由', () => {
    const server = fs.readFileSync(path.join(ROOT, 'src/apps/server/boot/server-app.js'), 'utf8');
    assert.match(server, /loadPreferredMmdResources/u);
    assert.match(server, /requestStaticMmdAsset/u);
    assert.ok(server.includes('app.get(/^\\/api\\/mmd\\/static\\/'));
    assert.match(server, /MMD 静态资源不接受查询参数/u);
    assert.match(server, /app\.get\('\/api\/vrm\/model\/static'/u);
});
