# Android APK 显示端（跨域控制增强）设计文档

## 概述

新增一个 Android APK 版本的显示端：APK 内 WebView 加载现有服务器 /display 页面，通过原生桥（JavascriptInterface）为 display.html 提供两项它自身做不到的能力——**真实像素截图**（跨域 iframe 内容、外站图片均可截，无需授权弹窗）与**跨域输入注入**（点击/滚轮/键盘/文本全场景，包括跨域 iframe 内容）。

现有浏览器显示端保持不变，继续工作，并通过能力声明（不声明 `crossOriginControl`）标识自己不具备跨域控制能力。

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
- 权限最小化：仅 INTERNET + 无障碍服务，不用 MediaProjection

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

## APK 实现

### 工程结构（Gradle + Kotlin，`src/apps/android-display/`）

```
android-display/
├── settings.gradle.kts / build.gradle.kts / app/
└── app/src/main/
    ├── AndroidManifest.xml        # INTERNET + 无障碍服务声明
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

### 权限

- `android.permission.INTERNET`
- 无障碍服务（`BIND_ACCESSIBILITY_SERVICE`）：系统设置开启一次；未开启时触摸注入返回 false，其余能力可用

### 配置

- MainActivity 启动时提供服务器地址输入（默认读取持久化值），WebView 加载 `https://<server>/display`（自签名证书处理：WebViewClient 信任一次并提示）
- APK 部署脚本默认通过启动 Intent 注入 `https://192.168.1.39:8081`；MainActivity 接收后覆盖输入框、保存 `server_url` 并立即连接，解决卸载重装后配置丢失问题
- 部署脚本可通过 `AASC_DISPLAY_SERVER_URL` 环境变量覆盖默认服务器地址；未注入地址时沿用手动输入和已保存地址逻辑
- displayId 持久化复用 display.html 的 localStorage 机制

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
| WS 断开/重连、页面刷新 | display.html 现有逻辑不变；桥无状态随 WebView 存活；displayId 走 localStorage |

## 状态与生命周期

| 场景 | 处理 |
|------|------|
| 控制模式开关 | 现有定时器/恢复逻辑不变，仅截图与输入源换成桥 |
| 无障碍服务中途被关 | 桥触摸方法返回 false → display.html 探测回退并上报能力降级 |
| WebView 页面刷新 | localStorage 持久化 displayId（现有机制），桥重新注入 |

## 外部系统媒体抢占与播放状态一致性

- Android 系统媒体播放器抢占音频焦点时，WebView 内的 video/audio 可能触发 `pause`，但控制端原有 `isPlaying` 仍为播放状态，形成状态断裂。
- 显示端维护控制端期望播放状态和媒体元素实际播放状态；仅控制端明确暂停、睡眠或播放列表暂停时允许保持暂停。
- 非预期暂停时显示端短间隔重试播放，并向服务器保持或恢复 `playStateReport(isPlaying=true)`；重试失败时仍保留控制端期望播放状态，等待原生音频焦点恢复回调或 watchdog 再次尝试，避免系统抢占被误记为控制端手动暂停。
- APK 原生层监听 `AudioManager` 音频焦点变化，通过 `NativeDisplay.onAudioFocusChanged(...)` 通知显示端；失去焦点期间不覆盖控制端手动暂停，焦点恢复后按期望状态恢复。

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

## 文档与任务

- 本设计文档（docs/design/android-display.md）
- docs/spec/ 增补对应实现文档（伪代码）
- docs/todo.md 增加 APK 显示端任务
- changelog.md 记录完成项
