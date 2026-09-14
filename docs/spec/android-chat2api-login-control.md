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
    原生控制按钮初始隐藏

NativeDisplay.setControlPageAccess(enabled):
    主线程设置 controlToggleButton.visible = enabled
    enabled == false -> 隐藏控制 WebView

MainActivity toggleControlPage():
    if 按钮未被服务端开放:
        return
    显示或隐藏 controlWebView
    首次显示 -> 加载同源 ServerConfig.controlPageUrl(serverUrl)
```

普通 APK 和离线 APK 共用上述流程；离线模式只改变 Node 主服务地址和本地模型配置，不改变控制端授权协议。

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
已实现：服务端 OAuth 捕获配置/Provider 验证、显示端控制端开放协议、控制端详情开关、Android 原生桥和独立登录 Activity/WebView
已验证：Node Chat2API/显示端定向测试、Android JVM 单元测试、普通 APK Debug 构建/安装/启动
未执行：Offline APK 构建；Provider 真实账号网页登录和接口验证
```
