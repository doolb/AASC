# offline APK 首次解包提示界面

## 任务描述

新手机首次安装 offline APK 时，Node Runtime、服务器运行包和离线模型需要解包到应用私有目录。当前 MainActivity 立即加载本地 display 页面，首次解包未完成时 WebView 显示 `net::ERR_CONNECTION_REFUSED`，用户无法判断 APK 是否仍在准备中。

## Design 需求

- 在 offline APK 的 WebView 上方增加原生启动状态遮罩。
- 使用不确定进度条和阶段文案，不显示不可靠的百分比。
- 解包和 Node 启动期间遮罩持续显示；display 页面成功加载后自动隐藏。
- Node 启动失败或本地页面重试耗尽时，显示错误详情和“重试”按钮。
- 普通在线 APK 不显示遮罩，不改变主服务器连接流程。

## Spec 设计（伪代码）

```text
NodeServerService → 发送应用内 node.status 广播
    → preparing / installing / starting / failed

MainActivity offline
    → 显示 startupStatusPanel
    → 消费 node.status 并更新 ProgressBar、文案和失败按钮
    → 连接失败时保持遮罩并按间隔重试 /display
    → 页面成功加载时隐藏遮罩
    → 失败重试按钮重新发起本地服务连接
```

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/res/layout/activity_main.xml`
  - 增加首次启动状态遮罩、进度条、状态文本和重试按钮。
- `src/apps/android-display/app/src/main/res/values/strings.xml`
  - 增加启动状态文案。
- `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
  - 接收服务状态、管理遮罩生命周期并延长首次启动页面重试窗口。
- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt`
  - 广播 Runtime 准备、Node 启动和失败状态。
- `tests/android-offline-apk.test.js`
  - 增加布局和状态流静态契约回归测试。
- `docs/design/android-embedded-node-server.md`
- `docs/spec/android-embedded-node-server.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. 离线 APK 静态契约测试确认遮罩控件、状态广播和失败重试入口存在。
2. Gradle Android 单元测试通过。
3. 新安装/清除应用数据后打开 APK，解包阶段 display 2 显示状态遮罩和不确定进度条。
4. Runtime 解包完成后 Node 监听 8081，display 页面成功加载并自动隐藏遮罩。
5. 模拟 Node 启动失败，确认显示失败详情和重试按钮。
6. 在线 APK 启动不显示 offline 解包遮罩。

## 兼容性测试

- Android 9/API 28、arm64-v8a：兼容现有 SM-N9500 验收设备。
- Android 10 及以上：不影响 SAF 目录选择流程。
- 已安装且 Runtime 完整的 APK：快速复用路径只显示短暂准备状态。

## 性能测试

- 遮罩是原生轻量布局，不增加模型复制和校验工作。
- 页面重试仅在 offline 主页面失败时执行，不影响在线 APK 或子资源请求。

## 风险评估

- 风险：服务状态广播早于 Activity 注册；通过 offline 初始默认状态和 WebView 成功/失败回调兜底。
- 风险：失败状态文案过早隐藏真实错误；遮罩只在 display 主页面成功加载后隐藏。
- 风险：重试时间过长掩盖永久失败；达到上限后提供明确错误和手动重试。

## 预计工时

- UI 和状态流程：1 小时
- 测试与文档：0.5 小时
- APK 构建及新手机场景验证：1 小时

## 执行结果

- 已完成原生启动状态遮罩、Node 状态广播、失败重试入口和 offline display 页面延迟重试。
- `node --test tests/android-offline-apk.test.js`：10/10 通过。
- `:app:testDebugUnitTest`：136/136 通过。
- offline APK 构建成功，并更新安装到 Android 9/API 28 的 SM-N9500 测试设备；本地控制页返回 HTTP 200。
- 完整 `npm test`：736 项中 734 项通过；2 项失败为既有睡眠播放断言和已确认暂不处理的 Windows 输入模式声纹策略断言。
- 真实卸载重装测试已确认首次解包期间显示原生准备提示；Node 服务完成后本地 `/display` 成功加载，遮罩隐藏且不再出现错误页误隐藏问题。
- 新增回归保护：错误页完成回调不会隐藏遮罩，只有目标本地 display URL 成功加载才允许结束等待。
