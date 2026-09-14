# offline APK 控制端默认入口与解包提示修复

## 任务描述

offline APK 的本地 Node 服务和 `/control` 页面都打包在同一个 APK 内，控制端按钮应在启动后默认可用；同时修复首次解包期间 WebView 错误页回调误隐藏启动遮罩的问题。

## Design 需求

- offline APK 默认显示“控制端”按钮，不依赖服务端 `displayControlAccess=true`。
- 普通在线 APK 继续由服务端授权控制按钮，不改变默认隐藏行为。
- WebView 主页面连接失败后保持 offline 启动遮罩；只有真正成功加载本地 display 页面时隐藏遮罩。

## Spec 设计（伪代码）

```text
MainActivity offline 启动
    → effectiveControlAccess = offlineMode or serverControlAccess
    → offlineMode 为 true 时默认显示 controlToggleButton
    → WebView 主页面错误时记录 displayLoadFailed = true 并保持启动遮罩
    → onPageFinished 仅在 displayLoadFailed == false 且 URL 为本地 display 页面时隐藏遮罩
    → 重试 onPageStarted 时清除本次加载的 displayLoadFailed
```

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
  - 应用 offline 默认控制端权限；增加 display 页面失败回调保护。
- `tests/android-offline-apk.test.js`
  - 增加 offline 默认按钮和错误页回调保护契约测试。
- `src/apps/android-display/app/src/test/java/com/aasc/display/ServerConfigTest.kt`
  - 增加 offline 控制端入口默认可见的纯逻辑测试。
- `docs/design/android-chat2api-login-control.md`
- `docs/spec/android-chat2api-login-control.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. offline 模式启动后 `controlToggleButton` 默认显示。
2. 普通 APK 在服务端未授权时按钮仍隐藏。
3. offline display 连接失败并触发 `onPageFinished` 后，启动遮罩仍显示。
4. offline display 成功加载后，启动遮罩隐藏且控制端按钮可用。
5. Android 单元测试、offline 静态契约测试和 APK 构建通过。

## 兼容性测试

- Android 9/API 28、arm64-v8a display 2 测试设备。
- 已安装 Runtime 的快速启动路径和卸载重装的完整解包路径。
- 普通 APK 与 offline APK 的控制端按钮行为隔离。

## 性能测试

- 不增加 Node 解包、模型加载或 WebSocket 消息频率。
- 只增加 Activity 内布尔状态判断，不影响 WebView 渲染。

## 风险评估

- offline 默认入口绕过服务端默认关闭值，仅适用于本地同包控制端；普通 APK 不采用该路径。
- 错误页回调状态必须在下一次真正的页面加载开始时重置，避免永久阻止成功页隐藏遮罩。

## 预计工时

- 逻辑与测试：0.5 小时
- 文档、构建和真机验证：0.5 小时

## 执行结果

- 已完成 offline APK 控制端默认入口和首次解包遮罩回调修复。
- `MainActivity.kt` 在 offline 模式启动时默认开放同源 `/control`，并忽略服务端初始化阶段的 `enabled=false`；普通在线 APK 仍由服务端授权控制。
- WebView 主页面连接失败后记录失败状态，只有实际加载本地 `/display` 页面才隐藏启动遮罩；错误页的 `onPageFinished` 不再误判为成功。
- `node --test tests/android-offline-apk.test.js`：10/10 通过。
- `:app:testDebugUnitTest`：136/136 通过，Gradle `BUILD SUCCESSFUL`。
- `npm run build:apk:offline`：构建成功，包内模型 43 个、995405414 bytes。
- 已在 Android 9/API 28 的 SM-N9500 测试设备卸载重装；首次解包阶段显示原生准备提示，Node 完成后本地 HTTPS `/display` 返回 HTTP 200，聊天接口返回测试成功。
- 临时在可触控 display 验证控制端按钮有实际可点击区域，点击后进入同源 `/control` 页面并显示“隐藏控制端”；验证结束后 APK 活动已恢复 display 2。
