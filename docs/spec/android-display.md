# Android APK 显示端（跨域控制增强）实现文档

## 桥接口（window.NativeDisplay）

APK 通过 `addJavascriptInterface(NativeBridge, "NativeDisplay")` 注入，display.html 启动时探测 `window.NativeDisplay`（`nativeBridge` 常量）。

```
isAvailable() -> boolean                          # 桥存在即 true
takeScreenshot() -> String JSON                   # 同步返回 {dataUrl,width,height}；失败 "null"
                                                  # 内部 CountDownLatch 等主线程 WebView.draw → 720p JPEG q0.7
injectTouch(x, y, action) -> boolean              # 无障碍 dispatchGesture；down/up/click/contextmenu
injectWheel(x, y, deltaY) -> boolean              # 垂直滑动，deltaY>0 手指上滑
injectKey(keyCode, meta) -> boolean               # WebView.dispatchKeyEvent
injectText(text) -> boolean                       # ASCII 按键；中文剪贴板 + Ctrl+V
getScreenSize() -> String JSON                    # {width, height} 屏幕像素
getSystemStats() -> String JSON                   # 同步返回 APK 自身资源：{hostname, cpuPercent, memPercent, memTotal, memUsed}
                                                  # hostname=Build.MODEL；内存读 ActivityManager.getMemoryInfo()，GB 1 位小数
                                                  # CPU 回退链：优先 /proc/stat 整体 CPU 两次采样差值；
                                                  #   SELinux 拒读时（部分 Android 14+ ROM）回退 /proc/self/stat 进程自身 CPU
                                                  #   （utime+stime，按 10ms/jiffy 与真实时间间隔换算百分比）
requestAudioFocus() -> boolean                     # Git 基线原生媒体音频焦点接口，当前网页不主动调用
abandonAudioFocus() -> void                        # Git 基线释放原生媒体音频焦点接口，当前网页不主动调用
onAudioFocusChanged(change: int)                  # Git 基线原生焦点变化通知 WebView
```

> 截图回调机制：JS 函数传 @JavascriptInterface String 参数在 WebView 不可靠
> （回调函数 toString 后无法保留闭包，且部分版本转出 "undefined" 导致
> `(undefined)(...)` 报错）。改用同步返回 JSON，经 CountDownLatch 等待主线程完成。

## display.html 集成

```
启动:
    nativeBridge = window.NativeDisplay || null

截图链(captureHtmlShot):
    if mediaHtml 隐藏 -> mode='none'
    if nativeBridge 可用:
        shot = await shotWithNativeBridge()       # 同步 takeScreenshot() 解析 JSON, mode='native'
        if shot: return
    # 否则走现有 html-to-image → gdm → 兜底

输入链(dispatchControlInput):
    if nativeBridge 可用 and dispatchControlInputNative(data) 成功: return
    # 否则走现有 JS 合成

dispatchControlInputNative:
    text                -> nativeBridge.injectText
    鼠标                -> rect 偏移 + 百分比 → 屏幕像素 -> injectTouch(down/up/click/contextmenu)
    wheel               -> injectWheel
    keydown/keyup       -> DOM_KEY_TO_ANDROID[keyCode] -> injectKey(keyCode, meta)
    未映射键            -> false（回退 JS 合成）

能力声明(capabilities):
    crossOriginControl          = nativeBridge 存在且 injectTouch 可用
    crossOriginControlDegraded  = 桥存在但触摸不可用

CPU 配置消费(applyCpuConfig):
    config = { asr: data.asr || {}, tts: data.tts || {} }
    # 每个引擎额外透传 preferBigCores；缺失时由服务端/APK按 false 兼容处理
    key = 稳定序列化(config)
    key == lastAppliedCpuConfigKey 或 key == pendingCpuConfigKey -> return
    nativeBridge 不存在 -> return
    nativeBridge.cpuConfigureAsync 不是函数 -> return
    pendingCpuConfigKey = key
    result = JSON.parse(nativeBridge.cpuConfigureAsync(JSON.stringify(config)))
    result.accepted == true -> lastAppliedCpuConfigKey = key; pendingCpuConfigKey = ''
    result.error 或调用异常 -> pendingCpuConfigKey = ''; 仅 console.warn
    # 不调用同步 cpuConfigure，不阻塞 WebSocket/UI 主线程

NativeBridge.cpuConfigureAsync(configJson):
    只在 cpuConfigLock 中覆盖 pending 配置并唤醒单线程后台 worker
    立即返回 accepted JSON
    worker 后台调用原 cpuConfigure 的配置应用主体

NativeBridge.voiceprintConfigure:
    模型回调 event -> mainHandler.post -> WebView.evaluateJavascript

display websocket onmessage:
    data.type == 'cpuConfig' -> applyCpuConfig({ asr: data.asr, tts: data.tts })
    # asr.preferBigCores 与 tts.preferBigCores 独立生效，不改变槽位总数
    继续保留 asrConfig / ttsConfig / voiceprintConfig / ttsGenerate 原有顺序与 fallback

媒体播放状态检测:
    desiredPlaying = 控制端 play 命令/恢复状态/播放列表状态
    media = currentMediaType == audio ? mediaAudio : mediaVideo
    监听 media 的 play/pause/ended/error
    如果 media 非预期 pause 且 desiredPlaying 且未处于 sleep/playlistPause:
        短间隔调用 media.play()
        成功 -> playStateReport(isPlaying=true)
        失败 -> 保留 desiredPlaying=true，由网页 watchdog 重试
    控制端 play=false、睡眠、播放列表 pause:
        标记 pauseExpected，禁止自动恢复
    media 触发 play 且当前处于 sleep/deep:
        立即 pause media
        清理媒体恢复定时器
    watchdog:
        sleep/deep 且 media 正在播放 -> pause media
网页 TTS 播放:
    playNextTts 直接设置 ttsAudio.src 并调用 ttsAudio.play
    ttsAudio.ended -> 清理当前 item，推进 ttsQueue
    tts stop/页面销毁 -> 清空队列并停止网页音频
    TextMediaPlayer 当前句播放:
        直接使用网页音频元素播放
        仅在 ended/错误/显式 stop 后推进 sentenceIndex 或清理当前句

TTS 与视频音轨协调:
    TTS 开始且视频正在播放:
        ttsVideoState = { active: true, wasPlaying: true }
        不修改 mediaVideo.muted、mediaVideo.volume 或视频播放状态，允许视频音轨与 TTS 同时播放
    普通/远程/文本媒体逐句 TTS 播放:
        ttsAudio.volume = 1
        直接使用网页音频元素播放，不调用 NativeDisplay 音频焦点接口
    TTS 活跃期间视频 pause/error/watchdog:
        保留视频播放意图，不调用 playVideoAuto，不申请媒体焦点
    TTS 的 waiting/stalled:
        视为网页媒体自身的缓冲状态，不调用原生焦点接口
    TTS 队列结束/显式 stop/页面销毁:
        ttsVideoState = null
        wasPlaying == true 且控制端仍期望播放且视频已暂停 -> 直接恢复 mediaVideo.play()
```

## APK 实现（Kotlin, src/apps/android-display/）

```
MainActivity           配置页(服务器地址) + WebView 容器 + 自签名证书信任
DisplayWebView         WebView 子类：JS/DOM 存储/混合内容
NativeBridge           @JavascriptInterface 桥实现
ScreenshotEngine       WebView.draw 位图 → 720p JPEG q0.7（真实像素，跨域可读）
KeyInjector            dispatchKeyEvent 真实按键；ASCII 逐字符；中文剪贴板+Ctrl+V
DisplayAccessibilityService   dispatchGesture 真实触摸/滚轮
TouchInjector          触摸注入入口，服务未开启返回 false
```

## Samsung DeX 全屏启动

```
APK Manifest.application:
    声明 com.samsung.android.dex.launchwidth = 0
    声明 com.samsung.android.dex.launchheight = 0

MainActivity.onCreate:
    继续设置 KEEP_SCREEN_ON
    继续调用 hideSystemUi() 隐藏状态栏和导航栏

窗口启动:
    普通 Android 窗口 → 由沉浸式系统栏标志铺满内容区域
    Samsung DeX freeform 窗口 → 由 launchwidth/launchheight=0 请求启动即全屏
```

`minSdk=26` 只限制最低运行系统，不参与 DeX 窗口尺寸决策；`targetSdk=34` 在 TTS 接入前后保持不变。

权限：仅 INTERNET + 无障碍服务（BIND_ACCESSIBILITY_SERVICE）。不用 MediaProjection。

## 部署命令自动恢复服务器地址

```
部署脚本启动:
    serverUrl = 环境变量 AASC_DISPLAY_SERVER_URL 非空 ? 该值 : "https://192.168.1.39:8081"
    对每个 adb 设备:
        安装 app-debug.apk（保留已有应用数据）
        启动 MainActivity，并传入 Intent extra server_url=serverUrl

MainActivity 启动:
    intentServerUrl = Intent extra server_url
    savedServerUrl = SharedPreferences("aasc_display").server_url
    serverInput.text = intentServerUrl 非空 ? intentServerUrl : savedServerUrl
    如果 intentServerUrl 非空 或 savedServerUrl 非空:
        调用 connect()

MainActivity 接收 singleTask 新 Intent:
    如果 Intent extra server_url 非空:
        更新输入框
        调用 connect()

connect():
    将输入地址保存到 SharedPreferences("aasc_display").server_url
    将地址补全为 /display
    WebView 加载显示页面
```

约束：部署脚本不直接写 APK 私有目录 XML，避免依赖 debug `run-as` 权限和 Android SharedPreferences 文件格式；服务器地址通过 Intent 显式传递，脚本使用参数数组调用 adb，避免 shell 字符串注入。

## 控制端提示（crop.js）

```
mode='none' 占位文本按能力区分:
    crossOriginControl           -> "原生截图失败，无画面（操作仍生效）"
    crossOriginControlDegraded   -> "跨域控制降级：仅同源页面可操作"
    其他                         -> "此显示端不支持跨域控制，无画面（操作仍生效）"
控制开关旁能力标识(_updateControlCapabilityHint):
    跨域控制(绿) / 跨域控制降级(橙) / 不支持跨域控制(灰)
```

## 测试

- tests/display-native-bridge.test.js：puppeteer mock 桥，验证 native 截图优先 + 输入走桥；
  `NO_BRIDGE=1` 回归浏览器显示端（走 JS 合成、无 native 截图）
