# Android APK 显示端（跨域控制增强）设计文档

## 概述

新增一个 Android APK 版本的显示端：APK 内 WebView 加载现有服务器 /display 页面，通过原生桥（JavascriptInterface）为 display.html 提供两项它自身做不到的能力——**真实像素截图**（跨域 iframe 内容、外站图片均可截，无需授权弹窗）与**跨域输入注入**（点击/滚轮/键盘/文本全场景，包括跨域 iframe 内容）。

现有浏览器显示端保持不变，继续工作，并通过能力声明（不声明 `crossOriginControl`）标识自己不具备跨域控制能力。

## 2026-09-09 连接修复结果

- APK WebView 通过 Network Security Config 信任构建时绑定的主服务器公开证书，主服务器证书 SAN 覆盖 `192.168.1.39`、`localhost` 和 `127.0.0.1`；页面导航和同源 WSS 使用同一套信任链。
- APK arm64 Node Runtime 作为 `libaasc_node.so` 放入 native 库目录，并通过 Gradle `jniLibs.useLegacyPackaging=true` 解压到旧版 Android 设备的 `nativeLibraryDir`；Node 依赖过滤规则只排除目录，保留下划线命名的 JavaScript 文件。
- 未知证书或主机名不匹配时 WebView 取消连接，不再通过 `SslErrorHandler.proceed()` 放行；display.html 继续使用唯一重连定时器处理 error/close。
- SM-N9500（Android 9/API 28，`192.168.1.6`）真机验收通过：显示端已连接主服务器，内置 Node 子服务器已注册；主服务器重启后显示端和子服务器均自动重连。

## 2026-09-09 共享存储访问结果

- APK Manifest 增加 `READ_EXTERNAL_STORAGE` 和 `WRITE_EXTERNAL_STORAGE`，均限制 `maxSdkVersion=28`；MainActivity 启动时动态申请缺失权限。
- 权限流程与显示端连接解耦：授权后继续启动 Node 和 WebView，拒绝时只影响共享存储媒体库操作，不阻塞显示端连接。
- SM-N9500（Android 9/API 28）首次启动已弹出系统存储授权框；授权后 `/storage/emulated/0/Download` 可读、可写、可建目录和可删目录。
- 通过 APK Node 媒体库接口完成 Download 目录列出、临时目录创建、文件上传、文件删除和目录删除；测试媒体库与临时文件已清理。
- Android 10/API 29 及以上不申请 `MANAGE_EXTERNAL_STORAGE`；整个共享存储的跨版本支持需要另行设计。

## 需求背景

### 现状问题（浏览器显示端）

| 问题 | 根因 |
|------|------|
| 含外站图片的页面截图失败（如 mhtml 转 srcdoc 的内容） | html-to-image 嵌入跨域图片时 fetch 被 CORS 拦截 → toCanvas 整体抛错 |
| 跨域 URL 页面无法截图 | iframe 内容跨域不可读，html-to-image 直接 SecurityError；getDisplayMedia 需授权弹窗、无人值守场景不可用 |
| 跨域页面无法点击/滚轮/键盘 | 跨域 iframe 的 contentDocument 不可达，合成事件无法派发 |
| 合成事件缺浏览器默认行为 | 键盘 Tab/Enter 等默认行为不触发 |

### 目标

1. APK 显示端可执行跨域页面：点击、滚轮、键盘、中文文本注入全场景可用
2. 截图稳定回传：真实像素，无 CORS/授权问题
3. 浏览器显示端不受影响，能力声明区分

### 约束

- 显示端设备：Android 7+（无障碍 dispatchGesture 需要 API 24+）
- APK 定位：WebView 包装 + 原生增强（不重写显示端逻辑）
- 权限最小化：当前 Android 9/API 28 设备增加共享存储读写权限；不使用 MediaProjection，不申请 Android 10+ 的“所有文件访问”权限

## 核心架构

```
┌─ APK（Android 7+）────────────────────────────────────┐
│  WebView 加载 https://<server>/display                  │
│   ├─ display.html（原样运行：播放列表/TTS/任务/旋转…）   │
│   │    ├─ 截图链：NativeDisplay.takeScreenshot() 优先   │
│   │    ├─ 输入链：NativeDisplay.inject*() 优先          │
│   │    └─ 能力声明：crossOriginControl: true            │
│   └─ JavascriptInterface（NativeBridge）                │
│        ├─ ScreenshotEngine：WebView 位图 → 720p JPEG    │
│        ├─ TouchInjector：无障碍 dispatchGesture 真实触摸│
│        └─ KeyInjector：WebView.dispatchKeyEvent 真实按键│
└─────────────────────────────────────────────────────────┘
         │ 同一 WS 协议
┌────────┴───────────────────────────────────────────────┐
│ 服务器（零改动：capabilities 已透传）                    │
└─────────────────────────────────────────────────────────┘
```

**关键机制**：

- **截图**：`WebView.drawToBitmap` 直接读渲染位图——浏览器引擎的绘制不受跨域限制（限制只在"读取 DOM"），跨域 iframe 内容、外站图片都能截出真实像素，无需 MediaProjection 授权
- **点击/滚轮**：无障碍服务 `dispatchGesture` 在屏幕坐标派发真实触摸——事件走系统输入管道，由浏览器引擎路由到 iframe 内容，绕过 DOM 跨域限制
- **键盘**：`WebView.dispatchKeyEvent` 派发真实 KeyEvent——Chromium 按键路由到 iframe 内已聚焦元素，跨域同样生效（先经真实触摸获得焦点）
- **中文文本**：剪贴板 + Ctrl+V 按键组合

## 桥接口定义（window.NativeDisplay）

| 方法 | 签名 | 说明 |
|------|------|------|
| isAvailable | `boolean` | 桥存在即 true（APK 环境探测） |
| takeScreenshot | `(cb: (dataUrl, width, height) => void)` | 异步截 WebView 位图，缩至 720p JPEG q0.7，dataUrl 回调；失败回调 null |
| injectTouch | `(x: int, y: int, action: string)` | 屏幕像素坐标真实触摸，action: `down`/`move`/`up`；成功返回 true，否则 false |
| injectWheel | `(x: int, y: int, deltaY: int)` | 滚轮 → 垂直滑动手势（按 deltaY 换算滑动像素） |
| injectKey | `(keyCode: int, meta: int)` | 真实按键事件（meta 为 ctrl/alt/shift/meta 位掩码） |
| injectText | `(text: string)` | ASCII 逐字符按键；中文剪贴板 + Ctrl+V |
| getScreenSize | `{width, height}` | 屏幕像素尺寸（坐标换算基准） |

JS 侧异步取值：`takeScreenshot` 用回调；其余同步返回。

## display.html 改动

### 1. 截图降级链（captureHtmlShot，display.html:1554）

桥存在时 `NativeDisplay.takeScreenshot()` 为第一优先级，成功即上报 `mode: 'native'`；失败（回调 null）再走现有 html-to-image → gdm → 兜底链。APK 环境不用 gdm（桥已覆盖）。

### 2. 输入派发（dispatchControlInput，display.html:1744）

桥存在时：

- 鼠标事件：iframe 可见区域内像素 + `getBoundingClientRect()` 屏幕偏移 → `injectTouch`
- 滚轮：同上坐标 → `injectWheel`（deltaY 原样）
- 键盘：`injectKey`（keyCode + 修饰键掩码）
- 文本：`injectText`（中文粘贴框内容）
- `injectTouch` 返回 false（无障碍未开启）→ 回退现有 JS 合成（同源可用）
- 旋转 90°/270° 场景：以 iframe 变换后的可视区域（getBoundingClientRect 已含变换）为坐标基准，不额外换算

无桥时：现有逻辑不变。

### 3. 能力声明（declareCapabilities）

桥存在 → `crossOriginControl: true`；浏览器显示端不声明。

### 4. 能力降级提示

无障碍服务未开启时，控制端显示"跨域控制降级（仅同源可用）"。

### 5. CPU 并发配置消费

显示端收到服务端 `cpuConfig` 消息时，不改变现有 ASR/TTS 路由选择，只把配置在 APK 原生桥存在且支持 `cpuConfigureAsync` 时异步透传给原生层。

约束：

- `window.NativeDisplay` 不存在时直接忽略，保证浏览器显示端和旧 APK 无报错。
- 旧 APK 只有部分桥方法、缺少 `cpuConfigureAsync` 时也直接忽略，不能影响 `asrConfig`、`ttsConfig`、`voiceprintConfig`、TTS 生成和 ASR 回调。
- 新 APK 调用 `NativeDisplay.cpuConfigureAsync(JSON.stringify({ asr, tts }))`；调用只入队并立即返回，返回 `{ error }` 只记录日志，不中断页面消息流。
- 页面按规范化配置 key 去重；原生侧后台队列只保留最新待处理配置。同步 `cpuConfigure` 仅保留原生兼容接口，不由 WebSocket 消息处理路径调用。
- `cpuConfig` 既会在显示端首连初始化时到达，也会在控制端修改后再次广播到显示端。
- 控制端在 ASR、TTS 行分别提供“优先大核”开关；开关状态随对应引擎配置广播到 APK，两个引擎互不影响。
- 开关开启时保留该引擎配置的并发槽位总数（大核数 + 小核数），先填充可用大核，不足部分再用小核补齐；关闭时继续按大核数/小核数精确分配。

### 6. ASR/TTS 独立优先大核开关

CPU affinity 控制项除了大核/小核数量，还保存两个独立的布尔字段：`asr.preferBigCores` 和 `tts.preferBigCores`。默认值为 `false`，兼容没有该字段的旧配置；当前设备配置可分别开启。

开关只改变槽位到 CPU 集群的分配顺序，不改变并发总数，也不改变 ASR/TTS 的设备路由。服务器规范化、控制端输入、WebSocket 广播和 APK 原生 `CpuTopology.policy()` 全链路透传同一字段。

## APK 实现

### 工程结构（Gradle + Kotlin，`src/apps/android-display/`）

```
android-display/
├── settings.gradle.kts / build.gradle.kts / app/
└── app/src/main/
    ├── AndroidManifest.xml        # INTERNET + API 28及以下共享存储 + 无障碍服务声明
    ├── java/com/aasc/display/
    │   ├── MainActivity.kt        # 全屏：服务器地址配置 + WebView 容器
    │   ├── DisplayWebView.kt      # WebView 子类：加载 /display + 桥绑定
    │   ├── NativeBridge.kt        # JavascriptInterface 实现
    │   ├── ScreenshotEngine.kt    # drawToBitmap → 720p JPEG
    │   ├── KeyInjector.kt         # dispatchKeyEvent 按键/文本
    │   └── DisplayAccessibilityService.kt  # dispatchGesture 触摸
    └── res/                       # 配置页布局、图标
```

### 关键实现点

| 桥方法 | 实现 |
|--------|------|
| takeScreenshot | `WebView.drawToBitmap(Bitmap)`（像素读渲染表面，跨域内容同样可读）→ `fitSizeTo720p` 等比缩放 → JPEG q0.7 → base64 dataUrl |
| injectTouch | 无障碍服务 `dispatchGesture`：down = 单点按住，move = 轨迹，up = 抬起 |
| injectWheel | 垂直滑动手势（deltaY 像素换算），可多次累计 |
| injectKey | `WebView.dispatchKeyEvent(KeyEvent(ACTION_DOWN/UP, keyCode, metaState))`；保证 WebView 已 requestFocus |
| injectText | ASCII 逐字符 KeyEvent；中文：`ClipboardManager` 设剪贴板 → dispatchKeyEvent(Ctrl+V) |
| getScreenSize | `resources.displayMetrics` |

### 共享存储访问

- 当前目标设备为 Android 9/API 28，APK 需要让内置 Node 子服务器直接读写 `/storage/emulated/0/` 及其子目录，以支持设备本地媒体库。
- Manifest 只声明 `READ_EXTERNAL_STORAGE` 和 `WRITE_EXTERNAL_STORAGE`，并设置 `maxSdkVersion=28`；MainActivity 启动时动态申请尚未授予的权限。
- 存储权限授权流程独立于显示端连接；用户拒绝时 WebView 和 AASC 子服务器仍可启动，但访问共享存储的媒体库请求由 Android 文件系统返回权限错误。
- Android 10/API 29 及以上不在本功能范围内申请 `MANAGE_EXTERNAL_STORAGE`；这些系统不能据此承诺直接读写整个共享存储根目录。
- 媒体库仍使用现有 `LocalProvider`，例如配置 `path=/storage/emulated/0/Download`；相对路径越界校验和 `readonly` 写保护保持不变。

### 权限

- `android.permission.INTERNET`
- `android.permission.READ_EXTERNAL_STORAGE`（仅 `maxSdkVersion=28`）
- `android.permission.WRITE_EXTERNAL_STORAGE`（仅 `maxSdkVersion=28`）
- 无障碍服务（`BIND_ACCESSIBILITY_SERVICE`）：系统设置开启一次；未开启时触摸注入返回 false，其余能力可用

### 配置

- MainActivity 启动时提供服务器地址输入（默认读取持久化值），WebView 加载 `https://<server>/display`
- APK 将当前主服务器的公开证书作为 Network Security Config 的额外信任锚点，同时保留系统证书和用户证书；页面导航与同源 WSS 使用同一套信任链，避免只放行页面导航而导致 WebSocket 重连失败
- 主服务器开发证书必须包含 `192.168.1.39`、`localhost` 和 `127.0.0.1` 的 SAN；证书不匹配或主机名不匹配时 WebView 取消连接，不再对任意自签名证书调用 `SslErrorHandler.proceed()`
- APK 部署脚本默认通过启动 Intent 注入 `https://192.168.1.39:8081`；MainActivity 接收后覆盖输入框、保存 `server_url` 并立即连接，解决卸载重装后配置丢失问题
- 部署脚本可通过 `AASC_DISPLAY_SERVER_URL` 环境变量覆盖默认服务器地址；未注入地址时沿用手动输入和已保存地址逻辑
- displayId 持久化复用 display.html 的 localStorage 机制
- Samsung DeX 启动时通过 `com.samsung.android.dex.launchwidth=0` 和 `com.samsung.android.dex.launchheight=0` 请求全屏窗口；Android 原生系统栏隐藏仍由 MainActivity 的沉浸式标志负责

### 全屏启动边界

`minSdk` 仅决定 APK 的最低 Android 安装/运行版本；TTS 接入将其从 24 提升到 26，但 SM-N9500 的 Android 9/API 28 不受此限制。DeX 的 `freeform` 窗口尺寸由 Samsung 启动器决定，不能只依赖 `SYSTEM_UI_FLAG_FULLSCREEN` 隐藏系统栏，因此需要额外声明 DeX 启动窗口元数据。

## 固定 Release 签名

- Release APK 使用固定 keystore：`~/.android/aasc-release.keystore`，其内容复制自原 `~/.android/debug.keystore`，因此与现有设备安装包保持同一签名。
- keystore 的别名和密码只从被 Git 忽略的 `local.properties` 或环境变量读取，不进入仓库；keystore 文件本身也不进入仓库。
- 执行 Release 构建时，如果 keystore、别名或密码缺失，Gradle 直接失败，禁止静默生成新签名。
- debug 构建继续使用 Android 默认 debug 签名，现有 debug 流程不受 Release 签名配置影响。
- 固定 keystore 必须单独备份；如果丢失，已安装的 Release APK 只能卸载后重新安装，不能通过包名或版本号替换。
- 该固定 Release keystore 来源于 Debug keystore，适用于内网/测试部署；正式公开发布仍应改用独立且受保护的生产 Release keystore。

## 服务器改动

零改动：display 消息处理、capabilities 透传、displayTypes 白名单均已支持。

## 控制端改动（crop.js）

- 显示端列表/控制模式开关旁显示能力标识："跨域控制"可用/不可用
- 不可用显示端控制模式下遇跨域页面：提示"此显示端不支持跨域控制"（替代误导性的"跨域未授权，操作仍生效"）
- 能力降级（APK 无障碍未开）：提示"跨域控制降级，仅同源页面可操作"

## 边界与降级

| 场景 | 处理 |
|------|------|
| takeScreenshot 失败（视频/WebGL 内容位图空白） | 回退现有 html-to-image 链，不影响功能 |
| 无障碍服务未开启 | 桥可用（截图/键盘），触摸返回 false → display.html 回退 JS 合成（同源可用，跨域点击受限），控制端提示降级 |
| 截图频率 | 沿用 1 秒 1 帧、busy 跳过防堆积（display.html 现有定时器） |
| WS 断开/重连、页面刷新 | display.html 保持单定时器、过期连接隔离和 error/close 重连；APK Network Security Config 保证 HTTPS/WSS 证书校验一致；桥无状态随 WebView 存活；displayId 走 localStorage |
| 主服务器证书不是 APK 信任证书 | WebView 取消页面或 WSS 连接并记录证书错误；用户需要重新构建包含对应公开证书的 APK |

## 状态与生命周期

| 场景 | 处理 |
|------|------|
| 控制模式开关 | 现有定时器/恢复逻辑不变，仅截图与输入源换成桥 |
| 无障碍服务中途被关 | 桥触摸方法返回 false → display.html 探测回退并上报能力降级 |
| WebView 页面刷新 | localStorage 持久化 displayId（现有机制），桥重新注入 |

## 外部系统媒体抢占与播放状态一致性

- Android 系统媒体播放器抢占音频焦点时，WebView 内的 video/audio 可能触发 `pause`，但控制端原有 `isPlaying` 仍为播放状态，形成状态断裂。
- 显示端维护控制端期望播放状态和媒体元素实际播放状态；仅控制端明确暂停、睡眠或播放列表暂停时允许保持暂停。
- 非预期暂停时显示端短间隔重试播放，并向服务器保持或恢复 `playStateReport(isPlaying=true)`；重试失败时仍保留控制端期望播放状态，由网页自身的播放状态监听和 watchdog 再次尝试，避免系统抢占被误记为控制端手动暂停。
- APK 启动时创建并申请一个全局 `AudioFocusController`；所有 WebView/网页媒体共用该焦点，`NativeBridge` 只引用这个共享控制器，不为每类媒体创建独立焦点。
- display.html 不重复申请或释放原生焦点；网页通过媒体 `pause`/`stalled`/`waiting`、watchdog 和原生焦点变化通知自动恢复期望播放状态。
- 网页恢复采用单飞短定时器并限制连续重试次数，避免焦点持续丢失或媒体模拟失败时形成无限 `play()` 循环。
- WebView/Chromium 仍可能为网页媒体建立内部 `AudioFocusDelegate` 请求；该请求无法直接复用 APK 的 `AudioFocusRequest`，因此系统层面不保证只有一个 focus entry。
- 睡眠/深度睡眠期间即使 WebView 或原生层延迟触发 `play`，显示端也必须立即暂停媒体并清理恢复定时器；低频 watchdog 继续兜底，防止媒体重新播放。

### 外部应用焦点切换时的视频画面保护

- 外部应用开始或结束播放时，`MainActivity.onWindowFocusChanged(true)` 只负责重新隐藏系统栏和请求 WebView 非破坏性重绘。
- 不在窗口焦点回归时把 WebView 设置为 `INVISIBLE` 再切回 `VISIBLE`；该操作可能重建视频 Surface/SurfaceTexture，造成视频画面冻结而音频继续播放。
- WebView 保持现有可见性和媒体元素状态；网页已有的媒体暂停恢复逻辑只处理真实的 `media.paused`，不通过 `play()` 处理纯渲染面冻结。
- 旧设备 GPU 黑屏兜底不再绑定每次窗口焦点回归，后续应以明确的画面异常检测或用户重新加载作为重建渲染面的入口。

### 网页 TTS 与视频播放

- TTS 继续使用网页隐藏的 `<audio id="ttsAudio">` 播放，不改为原生 `AudioTrack`。
- TTS 继续使用网页隐藏的 `<audio id="ttsAudio">` 播放，不改为原生 `AudioTrack`；APK 启动时的全局焦点已覆盖 TTS，网页不再重复申请或释放焦点。
- TTS 音频和视频的播放、暂停、缓冲、音量及系统焦点行为由 WebView 网页媒体实现负责；网页保留当前队列和正常 `ended` 推进逻辑。
- TTS 使用网页音频元素的 100% 音量；TTS 开始和结束不写回视频的 `muted` 或 `volume`。

### TTS 与视频焦点协调

- TTS 开始时记录当前视频的播放状态；视频元素继续播放画面和音轨，不由网页主动修改 `muted` 或 `volume`，允许系统按音频焦点策略自动 duck。
- TTS 活跃期间，视频 `pause`、`error` 和 watchdog 仍按网页普通媒体状态监听处理；恢复动作只调用网页媒体的 `play()`，不重新申请 Android 原生音频焦点。
- TTS 队列完全结束或显式停止后，不写回视频音频属性；只有原来正在播放且未被用户暂停的视频才尝试恢复播放。
- 网页不调用 `requestAudioFocus()` 或 `abandonAudioFocus()`；原生焦点变化只作为恢复触发，不在网页中再次申请焦点，避免 APK 与 Chromium 重复争抢。
- 视频、普通音频和 TTS 仍属于同一个 WebView 网页媒体环境；是否混音、duck 或暂停由系统和 WebView 的原生策略决定。

## 测试计划

1. 真机/模拟器（Android 7+）：APK 打开服务器显示页 → 显示端列表出现且能力标识"跨域控制"
2. 同源 html 控制模式：截图 mode=native、点击/滚轮/键盘/中文文本全通过（回归现有功能）
3. 跨域 html（公网网页）：截图正常回传、点击/滚轮/键盘/文本注入全部生效（核心目标）
4. 外站图片页面（mhtml 场景）：截图正常（原生位图无 CORS 问题）
5. 无障碍服务关闭：同源仍可控、跨域降级提示正确
6. 浏览器显示端回归：行为与现在完全一致，能力声明为不可用
7. 旋转 90°/270° 场景：截图方向与点击坐标正确
8. `npm run upload:apk` 安装后以 Intent 注入默认服务器地址，APK 自动保存并加载 `/display`
9. 卸载重装后重新执行部署命令，服务器地址仍由部署命令恢复；自定义 `AASC_DISPLAY_SERVER_URL` 地址生效
10. 系统媒体播放/停止期间，APK 显示端 video/audio 按控制端期望状态自动恢复，服务器播放状态与实际恢复结果一致；控制端手动暂停不被拉起
11. 主服务器重启后，HTTPS 页面和 WSS 均能重新建立连接，主服务器日志重新出现设备 IP 的显示端连接
12. APK 启动后原生 Node 使用 `libaasc_node.so`，主服务器出现 `node.register`，不再出现应用私有目录 `Permission denied`
13. 证书指纹或 SAN 不匹配时连接被取消，不允许通过任意自签名证书
14. Android 9/API 28 首次启动时申请共享存储读写权限，授权后 Node 媒体库可以列出、创建、上传和删除测试目录/文件
15. Android 9/API 28 拒绝共享存储权限时，显示端仍可连接，访问 `/storage/emulated/0/` 的媒体库请求返回权限错误且不越界
16. Android 10/API 29 及以上不声明或申请 `MANAGE_EXTERNAL_STORAGE`

## 文档与任务

- 本设计文档（docs/design/android-display.md）
- docs/spec/ 增补对应实现文档（伪代码）
- docs/todo.md 增加 APK 显示端任务
- changelog.md 记录完成项

## 2026-08-26 CPU 配置导致 TTS 页面卡顿修复

### 现象与处理

ADB 未观察到 ANR/崩溃，但显示端在 TTS 请求期间反复接收 `cpuConfig`，进程中出现累积的 TTS slot 线程和较高 RSS。原因为 WebView WebSocket 消息处理同步进入 `NativeBridge.cpuConfigure()`，而该方法会执行 CPU 拓扑探测、ASR/TTS pool 换代；相同配置重复下发还会重复构造 native synthesizer。

显示端 `applyCpuConfig()` 改为只调用 `NativeDisplay.cpuConfigureAsync()`，按 `{asr,tts}` 配置 key 去重，缺少异步桥时直接忽略。原生桥异步方法只负责将最新配置放入单线程后台队列并立即返回，后台串行应用配置；ASR/TTS policy 未改变时复用当前 pool。同步 `cpuConfigure()` 保留用于兼容已有原生调用，但不再由页面 WebSocket 路径调用。

声纹模型回调也必须经 `mainHandler.post` 执行 `WebView.evaluateJavascript()`，消除 JavaBridge 线程调用 WebView 的警告。
