# Offline min v14 签名读取兼容修复

## 任务描述

SM-N9500（Android 9/API 28）无法把已发布的 min v14 APK 更新到系统安装流程。外部验证确认 APK 文件、SHA-256、v2 签名和发布清单一致，但应用在 `OfflineUpdateManager.kt:930` 的归档签名比较处拒绝更新。

## Design 需求

- 兼容 Android API 28 读取仅含 v2 签名的 APK 归档。
- 继续校验 applicationId、versionCode、versionName、发布清单证书摘要和当前安装包证书摘要。
- 不修改 v14 文件的签名，不通过降低签名校验放行未知 APK。

## Spec 设计

- 归档读取先请求 `GET_SIGNING_CERTIFICATES | GET_SIGNATURES`。
- API 28 归档 signer 为空或不匹配时，单独请求 `GET_SIGNATURES` 并合并结果。
- signer 摘要同时覆盖 `apkContentsSigners`、证书历史和 `PackageInfo.signatures`。

## 受影响模块和代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/OfflineUpdateManager.kt`
- `src/apps/android-display/app/src/test/java/com/aasc/display/OfflineUpdateManagerTest.kt`
- `docs/design/android-offline-hot-update.md`
- `docs/spec/android-offline-hot-update.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. JVM 测试覆盖签名集合合并和 API 28 兼容读取分支。
2. Android 构建后使用 `apksigner verify --verbose --print-certs` 检查新 min APK。
3. 真机确认 min 更新校验不再在 signer 分支失败，并进入系统安装确认页。

## 兼容性测试

- API 28：SM-N9500，先覆盖安装 full v14，再从 full v14 更新到 min v15。
- 现代 Android：继续使用 `SigningInfo.apkContentsSigners` 校验。
- 新鲜安装 update-only min APK：仍拒绝启动服务，保持现有行为。

## 性能测试

- 仅在 min APK 更新校验时最多增加一次轻量 `PackageManager` 归档读取。
- 不增加服务启动和聊天请求路径的开销。

## 风险评估

- API 28 的两个读取结果可能都缺少签名，此时仍拒绝更新并记录明确错误。
- 证书摘要仍必须命中发布清单和当前安装包，不扩大到未授权签名。
- 旧 full v13 使用旧校验器，不能直接验证 min v15；发布顺序必须是 full v14 后 min v15。

## 预计工时

约 1 小时，包括代码修改、单测、构建和真机更新验证。

## 执行结果

- 已在 `OfflineUpdateManager.kt` 合并 `SigningInfo` 当前证书、证书历史和 `PackageInfo.signatures`，并对 API 28 归档执行现代/旧版双路径读取。
- full v14 已覆盖安装到 SM-N9500；点击 min 更新后，应用成功完成 v15 下载、SHA-256/签名校验并进入系统安装确认页，确认后 versionCode=15。
- min v15 安装后 Node launcher、`offline-display` 连接和原有服务数据继续保留；发布目录 LAN/WAN 直连 IP 校验通过。默认域名 `c.aasc.us` 的 403 仍不作为发布验收入口。
