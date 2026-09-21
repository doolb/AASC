# Android Chat2API 登录与显示端控制端开放实现规范

本文使用伪代码描述 Android APK 专用 Chat2API 登录和显示端控制端开放流程，和实际 Kotlin/JavaScript/Node 实现保持同步。

## 显示端状态与能力

```text
createDisplayState():
    state.androidControlPageOpen = false
    state.capabilities = null
    return state

display.html declareCapabilities():
    capabilities = detectExistingCapabilities()
    capabilities.androidControlPage = NativeDisplay 存在且提供 setControlPageAccess
    displayWebSocket.send({ type: "capabilities", capabilities })

server onDisplayConnect(displayId):
    savedState = config.getDisplayStateById(displayId, clientIP)
    displayState = merge(createDisplayState(), savedState)
    displayState.androidControlPageOpen = savedState.androidControlPageOpen == true
    displayClients.set(displayId, displayState)
    displayWebSocket.send({
        type: "displayControlAccess",
        enabled: displayState.androidControlPageOpen and displayState.capabilities.androidControlPage == true
    })

server getDisplayList():
    for each display:
        return {
            id,
            capabilities,
            androidControlPageSupported = capabilities.androidControlPage == true,
            androidControlPageOpen = capabilities.androidControlPage == true
                and state.androidControlPageOpen == true
        }
```

## 控制端开关

```text
control DisplayList.renderFeaturePanel(display):
    if display.androidControlPageSupported == true:
        显示“开放 Android 控制端”复选框
        复选框初始值 = display.androidControlPageOpen

control onAndroidControlPageChanged(displayId, enabled):
    websocket.send({
        type: "setAndroidControlPage",
        displayId,
        enabled
    })

server onControlMessage(message):
    if message.type != "setAndroidControlPage":
        交给其他控制端处理器
    target = displayClients.get(message.displayId)
    if target 不存在:
        返回 displayControlAccessUpdateError
    if target.state.capabilities.androidControlPage != true:
        返回 displayControlAccessUpdateError
    enabled = message.enabled == true
    target.state.androidControlPageOpen = enabled
    config.updateDisplayStateById(target.displayId, target.ip, { androidControlPageOpen: enabled })
    sendToDisplay(target.displayId, { type: "displayControlAccess", enabled })
    broadcastToControls({ type: "displayControlAccessUpdated", displayId: target.displayId, enabled })

display.html onMessage(message):
    if message.type == "displayControlAccess":
        NativeDisplay.setControlPageAccess(message.enabled == true)
```

## Android 原生控制端入口

```text
MainActivity onCreate:
    创建显示 WebView 和控制 WebView
    display WebView 注入 NativeDisplay
    control WebView 注入 NativeControl
    offlineMode == true -> 原生控制按钮初始显示，controlPageAllowed = true
    offlineMode == false -> 原生控制按钮初始隐藏，等待服务端授权

NativeDisplay.setControlPageAccess(enabled):
    effectiveAllowed = offlineMode == true or enabled == true
    主线程设置 controlPageAllowed = effectiveAllowed
    controlButtonState = COLLAPSED
    controlToggleButton.visible = effectiveAllowed and controlWebView 未显示
    effectiveAllowed == false -> 隐藏控制 WebView

MainActivity onControlButtonClick():
    if controlPageAllowed == false:
        return
    if controlWebView 未显示 and controlButtonState == COLLAPSED:
        controlButtonState = EXPANDED
        更新为完整“控制端”按钮
        return
    显示或隐藏 controlWebView
    controlWebView 显示 -> 加载同源 ServerConfig.controlPageUrl(serverUrl)
    controlWebView 隐藏 -> controlButtonState = COLLAPSED

MainActivity onDisplayLayoutChanged():
    保持收缩入口贴合左侧边缘
    保持按钮位于 controlWebView 上方且不改变 WebView 层级
```

```text
Android FrameLayout 图层约束
    → displayWebView 位于底层
    → controlWebView 显示时必须位于 displayWebView 之上
    → controlToggleButton 位于可见 controlWebView 之上，保持可关闭入口
    → offlineStartupPanel 仅在启动等待期间位于最上层
    → 控制端按钮点击后检查 controlWebView 的真实可见层级和 /control 加载结果
```

MainActivity.setupWebView():
    → webContainer.addView(displayWebView, 0)
    → webContainer.addView(controlWebView, displayWebView 之上且按钮/启动遮罩之下)
    → 保持 controlToggleButton 位于 controlWebView 之上
    → 保持 offlineStartupPanel 位于所有 WebView 之上

实际实现使用 `webContainer.addView(control, 1)`：display WebView 为索引 0，控制端 WebView 位于其上方，XML 中的按钮和启动遮罩继续位于控制端 WebView 上方。

普通 APK 和离线 APK 共用上述流程；离线模式只改变 Node 主服务地址和本地模型配置，不改变控制端授权协议。
离线模式的原生入口默认可用，不因服务端初始化阶段补发的 `enabled=false` 而隐藏；普通 APK 仍完全遵循服务端授权。

当前实现补充：`controlButtonState` 使用 `COLLAPSED/EXPANDED` 两态；左侧中部收缩标签第一次点击只切换到 `EXPANDED`，只有展开态再次点击才切换控制 WebView。页面关闭、返回显示页或撤销授权时回到 `COLLAPSED`。

## Offline 本机账号导入伪代码

```text
source = read host Chat2API accounts.json
payload = {
    version: 1,
    format: "aasc-chat2api-config",
    providers: [],
    accounts: source.accounts,
    modelMappings: []
}

preview = POST /api/chat2api-gateway/{instanceId}/api/chat2api/import/preview(payload)
require preview.counts.accounts > 0
merge = POST /api/chat2api-gateway/{instanceId}/api/chat2api/import/merge({ data: payload, confirmed: true })
require merge.counts.accounts == preview.counts.accounts

accounts = GET /api/chat2api-gateway/{instanceId}/api/chat2api/accounts
models = GET /api/chat2api-gateway/{instanceId}/v1/models
request = POST /api/chat2api-gateway/{instanceId}/v1/chat/completions
验证账号列表脱敏、模型列表非空、最小请求返回成功
```

导入只写入 Offline Chat2API 数据目录；不打印凭据、不覆盖已有 Provider/代理配置/模型映射，导入失败时保留原账号集合。

## Chat2API 登录会话

```text
server oauth.start(providerId):
    provider = providerRegistry.getProvider(providerId)
    profile = androidLoginProfiles[providerId]
    session = dataStore.createOAuthSession({
        providerId,
        loginUrl: provider.loginUrl
    })
    return {
        state: session.state,
        providerId,
        loginUrl: provider.loginUrl,
        expiresAt: session.expiresAt,
        androidWebView: profile != null,
        captureProfile: profile 的公开字段
    }

control Chat2APIControl.startLogin(providerId):
    loginSession = POST /api/chat2api/oauth/start
    if NativeControl.openChat2ApiLogin 存在 and loginSession.androidWebView == true:
        NativeControl.openChat2ApiLogin(loginSession)
        显示“请在登录窗口完成登录”
    else:
        打开登录地址并显示手工凭据表单

MainActivity openChat2ApiLogin(loginSession):
    启动 Chat2ApiLoginActivity 独立进程
    传入 state、providerId、loginUrl、captureProfile
    只允许一个活动登录窗口

control onNativeLoginResult(result):
    if result.success != true:
        显示取消、超时或捕获失败原因
    else:
        POST /api/chat2api/oauth/complete {
            state: loginSession.state,
            providerId: loginSession.providerId,
            credentials: result.credentials
        }
```

## Android 隔离 WebView

```text
Chat2ApiLoginActivity onCreate:
    在独立进程首次创建 WebView 前设置专用数据目录
    顶部操作栏按顺序创建“完成”按钮和“取消”按钮
    创建 Chat2ApiAuthWebView
    设置 JavaScript、DOM storage 和安全导航策略
    加载 loginUrl

Chat2ApiAuthWebView onRequest(request):
    if request.url 不匹配 captureProfile.allowedOrigins:
        不捕获请求头
    authorization = request.headers.Authorization
    if authorization 匹配 captureProfile.authorization:
        credentials = merge(credentials, mapAuthorization(authorization))
        tryEmitCandidate()

Chat2ApiAuthWebView onPageFinished(url):
    if url 匹配 allowedOrigins:
        localStorageValues = evaluateJavascript(captureProfile.localStorage)
        cookieValues = CookieManager.getCookie(url)
        credentials = merge(credentials, mapStorageAndCookies(localStorageValues, cookieValues))
        tryEmitCandidate()

Chat2ApiAuthWebView polling:
    每 1000ms 对当前允许域名读取 localStorage 和 Cookie
    必填字段齐全 -> 通过 Activity Result 返回一次 credentials

Chat2ApiLoginActivity onCompleteClick:
    请求 Chat2ApiAuthWebView 立即读取当前允许域名的 localStorage 和 Cookie
    将即时结果合并到已捕获的 Authorization/localStorage/Cookie
    如果必填字段齐全：停止轮询并返回 success credentials
    否则：保留登录页面，提示用户完成网页登录后再次点击“完成”

Chat2ApiLoginActivity finish:
    停止轮询
    删除页面回调
    清理 WebView、Cookie、WebStorage、缓存和历史记录
    返回 success、state、providerId、credentials 或安全错误码
```

## Provider 验证

```text
oauth.complete(input):
    校验 state、providerId 和 credentials 对象
    session = dataStore.getOAuthSession(state, providerId)
    session 不存在或已过期 -> 拒绝
    state 已在 completeLocks 中 -> 拒绝重复提交
    completeLocks.add(state)
    try:
        validator = credentialValidators[providerId]
        validated = validator.validate(credentials, provider)
        validated.valid != true -> 返回 Provider 验证错误，保留 state 直到过期
        account = dataStore.saveAccount(normalizeValidatedAccount(validated))
        dataStore.consumeOAuthSession(state, providerId)
        return { account: 脱敏(account) }
    finally:
        completeLocks.delete(state)
```

Provider 验证器按 `/mnt/Chat2API/src/main/oauth/adapters` 的现有校验逻辑迁移到 AASC 适配层；请求由注入的 `httpClient` 执行，测试使用假 HTTP 客户端，不访问真实账号。

## 实现状态与验证边界

```text
manual control chat verification:
    inspect active LLM profile and its mode/protocol
    if mode == agent:
        route to Pi/Codex runtime; do not treat as Chat2API request
    if mode == llm and protocol == openai-completions:
        POST current Chat2API proxy /v1/chat/completions with selected model
    verify chatResponse.success and returned text
    restore the original profile after temporary verification

offline Pi runtime prerequisite:
    package @earendil-works/pi-ai/dist/providers/data/.manifest.json
    preserve the hidden manifest name or restore it before Pi SDK import
    verify agent/pi profile on a real Offline APK before publishing
```

```text
已实现：服务端 OAuth 捕获配置/Provider 验证、显示端控制端开放协议、控制端详情开关、Android 原生桥和独立登录 Activity/WebView；登录 Activity 顶部“完成”按钮会触发即时捕获，位于“取消”之前
已验证：Node Chat2API/显示端定向测试、Android JVM 单元测试、普通 APK Debug 构建/安装/启动、offline APK 构建/卸载重装启动、同源控制端页面和本地聊天回复、本机 Qwen 账号导入、空模型映射下的最小 Chat Completions 请求、控制端使用 Qwen3.6 Chat Completions 的真实 WebSocket 请求
已定位并修复：现有 `qwen3.5` 配置为 `agent/pi` 时，旧 Offline APK 因 Pi Provider manifest 缺失而失败；新 Runtime 通过 `aasc-bundled-manifest.json` 安装恢复 `.manifest.json`，并在快速复用时校验该文件。该配置没有进入 Chat2API 请求链路
未执行：Provider 真实账号网页登录捕获链路
```

```text
offline APK 重打包契约
    → AASC_ANDROID_NODE_PACKAGE_DIR 必须包含当前 Chat2API 源码和生产 node_modules
    → APK assets/server 必须包含 chat2api-manual-account-service.js、chat2api.js 和 express 运行依赖
    → 安装后 /api/chat2api 路由与 /v1/chat/completions、/v1/responses 共用当前本地 server-app
    → 仅验证本地协议和包内容，不在自动验收中写入真实 Provider 凭据
```
