# Offline APK 按分辨率动态缩放与快速热更新验证

## 任务描述

将 Offline APK 的 WebView 初始缩放从固定倍数改为按当前显示分辨率计算，并使用 `allserver-min` 快速包在已安装完整 Offline APK 的设备上做原位升级和服务热更新验证。

## Design 需求

- 长边 1280 像素对应 100%。
- Offline 比例为 `round(长边 / 1280 × 100)`，横屏/竖屏均取长边。
- 普通 APK 继续使用 100%；无效分辨率回退 100%。
- 只调整 WebView 页面初始比例，不修改系统 density、分辨率、媒体尺寸和输入坐标协议。
- 快速包使用 `npm run build:apk:offline:min`，同包名、同签名、更高 versionCode 原位更新，保留服务数据和模型缓存。

## Spec 设计

`WebViewScalePolicy.initialScalePercent(offlineMode, widthPixels, heightPixels)` 负责纯函数计算；`DisplayWebView` 从所属 Context 的 `displayMetrics` 读取像素宽高并调用该策略。测试覆盖 1280 基准、1920 横屏、720x1480 竖屏、普通 APK 和无效输入。

## 受影响模块与代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/WebViewScalePolicy.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`
- `src/apps/android-display/app/src/test/java/com/aasc/display/WebViewScalePolicyTest.kt`
- `release/apkbuild/allserver-min/output/` 快速 APK 工件
- `docs/design/android-display*.md`、`docs/spec/android-display*.md`、`docs/todo.md`、`changelog.md`

## 自测用例

- [x] 先运行新测试确认旧签名无法编译（RED）。
- [x] 实现动态策略后运行 `:app:testDebugUnitTest --tests com.aasc.display.WebViewScalePolicyTest`（GREEN）。
- [x] `npm run build:apk:offline:min` 构建快速包。
- [x] ZIP/APK 完整性、applicationId、signer digest、versionCode/versionName 静态检查。
- [x] ADB 原位安装快速包，确认应用数据目录、配置、任务/results、模型缓存仍在。
- [x] 启动后检查 `/api/status`、`/v1/models`、默认模型聊天和显示页连接。
- [x] 检查 NodeServerService 更新日志、active release 和 `pendingHealth`，确认服务热更新成功或失败时保留旧版本。

## 兼容性测试

- Android 9/API 28、arm64-v8a、现有 `com.aasc.display.offline` 签名安装。
- 设备覆盖分辨率 `720x1480` 应计算为 116%；系统 `wm size/density` 前后不变。
- 普通 APK 仍为 100%，旧设备无有效 metrics 时回退 100%。

## 性能测试

- 记录快速包构建耗时、APK 大小和安装耗时。
- 记录启动到本地服务 `/api/status` 可用的耗时；更新失败不应阻塞旧服务启动。

## 风险评估

- WebView `setInitialScale` 使用长边像素，极高分辨率会产生更大的百分比；通过四舍五入和最小值 1 保证输入稳定。
- min APK 只能原位更新已安装完整包；无完整安装标记时必须拒绝启动服务。
- 真机 PackageInstaller 可能需要人工确认；确认失败时不得删除现有数据或 active release。

## 预计工时

约 2 小时（代码、文档、快速构建和真机验证）。

## 执行记录

## 执行结果（2026-09-17）

- 旧接口测试先因 `initialScalePercent` 参数数量不匹配而失败；实现策略后 `WebViewScalePolicyTest` 4 项通过。
- 最终 Android JVM 全量回归 `:app:testDebugUnitTest` 共 166 项，0 failures/errors；更新相关 Node 定向测试 57 项通过。
- 首次 min v3 构建产物安装后发现 update-only 包未携带 `libaasc_node.so`，原位替换会让 Node launcher 报 `No such file or directory`。已在 `prepare-android-node-runtime.js` 增加 min JNI Node 库保留，并更新回归测试。
- 修复后重新执行 `npm run build:apk:offline:min`：APK 版本 `0.2.1-offline-min`、versionCode `3`、大小 `89,810,222` bytes，SHA-256 `07840b3be8b7605b31d0d558ac9f40034c7d460cc3bbf9e40382974b495e08c6`；`unzip -tq` 通过，包名 `com.aasc.display.offline`，APK 证书 SHA-256 `a57fd4c34c0c769246239a7d8c606b5edb62c215ecf9659448ea178eda3fb7df`（设备 PackageManager 短摘要 `b2cceec9`），包内包含 `lib/arm64-v8a/libaasc_node.so`。
- SM-N9500 Android 9 原位安装成功，`firstInstallTime` 保持 `2026-09-17 11:04:19`，`lastUpdateTime` 更新到 `12:22:33`；`wm size` 仍为物理 `1440x2960`、覆盖 `720x1480`，density 仍为 `420/280`。
- 安装前备份并在安装后恢复了 `updates/dependencies/dependencies-v3`，未删除配置、任务、日志或模型缓存；`active-release.json` 仍为 code/dependencies `3/3` 且 `pendingHealth=false`，Qwen 模型 `.manifest.json` 仍可读。
- 启动日志出现 `Offline Runtime 动态库增量更新完成`、`Offline 服务更新检查: 服务已是当前版本` 和 `Node launcher 已启动`，无启动失败；服务继续通过 WebSocket 广播显示端能力。
- ADB forward 后接口检查：`/api/status`、`/v1/models`、`/display`、`/control` 均 HTTP 200；默认模型 `qwen3.5-0.8b-claude-opus-distilled-mnn` Chat Completions HTTP 200。
- 当前 Activity 位于 Android 9 的虚拟显示屏，`screencap -d 2/4` 无法取得有效画面；设备覆盖分辨率仍为 `720x1480`，按长边 1480 计算 Offline 初始比例为 `116%`，不把不可用黑屏截图作为验收证据。
- 本次修复包用于本地构建和真机验证；正式发布通过递增 versionCode 生成 v4 后完成。

## 正式发布结果（2026-09-17）

- `release/apkbuild/allserver-min/app.json` 已将 versionCode 从 `3` 升为 `4`，versionName 为 `0.2.2-offline-min`；重新执行 `npm run build:apk:offline:min`，生成 APK 大小 `89205130` bytes，SHA-256 `be31e437ca17488fab20eefd1874be2a1b40689cac59f667873e761dd17b1027`。
- 使用 `npm run package:offline-apk:min -- --manifest-file=/tmp/aasc-manifest-lan.json` 生成 `manifest-apk-min-v4.json`，RSA 清单签名、APK 签名证书和组件大小/SHA-256 校验通过。
- 使用发布器将 `apk/aasc-display-offline-min-v4.apk` 与 `manifest.json` 发布到局域网 `/mnt/aasc-offline` 和外网 `as@120.79.245.103:~/a/aasc-offline`；两站点 HTTP manifest 字节一致且签名有效。
- LAN HTTP 下载整包 SHA-256、外网 SSH 远端文件 SHA-256 均与清单一致；外网 HTTP HEAD 返回 200、Content-Length `89205130`，Range `0-1023` 返回 206 且首 1024 字节匹配。由于外网整包 HTTP 回读速度很低，未重复等待完整 HTTP 下载，远端文件 hash 作为整包校验依据。
- v4 发布清单保留 code/dependencies `3/3`，只追加 `apkMin` v4；设备当前已安装 min v3 的真机运行时和服务热更状态未因发布动作改变。
