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
onAudioFocusChanged(change: int)                  # 原生 AudioManager 音频焦点变化通知 WebView
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

媒体播放状态检测:
    desiredPlaying = 控制端 play 命令/恢复状态/播放列表状态
    media = currentMediaType == audio ? mediaAudio : mediaVideo
    监听 media 的 play/pause/ended/error
    如果 media 非预期 pause 且 desiredPlaying 且未处于 sleep/playlistPause:
        短间隔调用 media.play()
        成功 -> playStateReport(isPlaying=true)
        失败 -> 保留 desiredPlaying=true，继续等待 native audio focus 恢复通知或低频 watchdog 重试
    控制端 play=false、睡眠、播放列表 pause:
        标记 pauseExpected，禁止自动恢复
    NativeDisplay.onAudioFocusChanged(LOSS/GAIN):
        LOSS -> 标记系统焦点中断，保留 desiredPlaying
        GAIN -> 若 desiredPlaying 且媒体已暂停，重新调用 media.play()
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
