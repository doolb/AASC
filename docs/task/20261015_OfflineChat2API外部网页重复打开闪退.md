# Offline Chat2API 外部网页重复打开闪退

## 任务描述

修复 Offline APK 中 Chat2API 已保存账号的“打开外部网页”流程：第一次打开后点击“取消”关闭，再次打开时应用进程崩溃。

## Design 需求

- 保留 Chat2ApiLoginActivity 独立进程及隔离 WebView 数据目录。
- WebView 数据目录后缀在独立登录进程内只设置一次。
- 取消/完成销毁当前 WebView，但不重置进程级初始化状态；后续 Activity 实例复用已设置的数据目录。
- API 28 以下不调用 `WebView.setDataDirectorySuffix`。
- 设置后缀失败时不得标记成功或吞掉异常。
- 不访问 Qwen 账号凭据，不发送聊天或凭据验证请求。

## Spec 设计

```text
Chat2ApiLoginActivity.onCreate:
    初始化器 = 本进程共享的 WebView 数据目录初始化器
    初始化器.initialize(Android API, WebView.setDataDirectorySuffix)
    只有首次且 API >= 28 时设置专用后缀
    初始化成功后才记录 initialized=true
    继续创建本 Activity 的隔离 WebView

Chat2ApiLoginActivity.onDestroy:
    清理并销毁本 Activity 的 WebView
    保留初始化器的进程级状态

单元测试:
    同一初始化器在 API >= 28 调用两次 -> setter调用一次
    API < 28 -> setter调用零次
    setter异常 -> 初始化状态仍未完成
```

## 受影响模块与文件

- Android 原生 Chat2API 登录 Activity 和 WebView 数据目录初始化器。
- Android JVM 单元测试。
- `docs/design/android-chat2api-login-control.md`、`docs/spec/android-chat2api-login-control.md`、`docs/spec/self-test.md`、`docs/todo.md`、`changelog.md`。
- 本任务文档。

## 自测用例

1. JVM：API 28 及以上重复初始化只设置一次固定后缀。
2. JVM：API 27 及以下不调用后缀设置器。
3. JVM：首次设置器抛错后，状态未成功；再次调用可以重试。
4. ADB Note8：选择 Qwen 已保存账号，打开外部网页，点取消关闭，再次打开；页面可重新显示，登录进程无崩溃。
5. 不输入账号信息、不点击网页中的登录/提交按钮、不发送聊天请求。

## 兼容性测试

- 目标设备 Samsung SM-N9500 / Android 9 (API 28)。
- API 27 以下通过 JVM 用例验证不调用新接口。
- 登录页仍运行于 `:chat2api_login`，与显示/控制 WebView 数据目录隔离。

## 性能测试

- 仅确认初始化器同步且只执行一次，不增加网络请求、轮询或常驻线程。
- 本次无可测性能退化路径。

## 风险评估

- 初始化器若不在进程级共享，Activity 重建仍可能重复设置并复现崩溃；需由同一进程的两次 JVM 调用及真机重开覆盖。
- 不应捕获并忽略 `setDataDirectorySuffix` 的异常，否则可能造成 WebView 数据隔离失效。

## 预计工时

- 0.5 小时，包含修复、单测、min APK 构建和 ADB 复现验收。

## 执行记录

- 状态：已完成。
- 需求等级：L6 Android 原生功能缺陷；主等级 L6，次等级 L4/L5（初始化状态契约与重开流程）。
- 实现：新增 `Chat2ApiWebViewDataDirectoryInitializer`，由 `Chat2ApiLoginActivity` companion object 在登录进程内共享；只有 Android API 28 及以上首次初始化成功后才记为完成。
- JVM 验证：`:app:testDebugUnitTest` 成功；新增三项覆盖单次设置、API 27 跳过、异常后重试。Chat2API 定向检查 254/254，`self-test.js` 语法检查通过。
- min APK：`npm run build:apk:offline:min` 成功，`allserver-min` / versionCode 56，APK 为 87 MiB，SHA-256 `ee8808ef70d7175e4c87d163942e361ad0597837a27a28693fd9e7c581a28a5b`。已覆盖安装到现有 Offline 包并保留应用数据，`minApk=false`；服务包保持原有 `servicePackage=true`，依赖包 `dependenciesPackage=false`。
- ADB SM-N9500/API 28：已配置 Qwen 账号显示“已登录”。首次打开出现“Qwen 外部网页”原生页并点“取消”；子进程 `com.aasc.display.offline:chat2api_login` 仍存活（PID 16300）。从同一账号再次打开后 `Chat2ApiLoginActivity` 成为前台 Activity，进程 PID 未变，最近 AndroidRuntime 日志无崩溃异常。未输入账号凭据、未点击网页登录或提交、未发送聊天请求。
- 限制：本次验收确认重复打开不再闪退；未验收 Qwen 站点的真实联网登录内容。
