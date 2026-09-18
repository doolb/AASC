# Offline min v14 签名校验诊断

## 任务描述

SM-N9500 在下载 Offline min v14 时提示“拒绝更新，SHA-256/签名不一致”。需要区分 APK 文件哈希、证书签名和 Android 应用内校验失败的位置，并提供可用的完整包更新路径。

## design 需求

- 校验本地、LAN、WAN 和设备缓存的 min v14 文件 SHA-256。
- 使用 `apksigner` 校验 v14 的 v2 签名和证书摘要。
- 对比签名清单中的 `signerSha256`。
- 用 full v13 直接安装验证同证书整包更新路径。

## spec 设计

`OfflineUpdateManager.validateMinApkArchive` 使用 `PackageManager.getPackageArchiveInfo` 解析下载 APK，再比对包名、版本、证书摘要；本次记录该函数在 API 28 真机上的实际失败位置，暂不修改已发布 APK。

## 受影响模块

- `src/apps/android-display/app/src/main/java/com/aasc/display/OfflineUpdateManager.kt:929-932`
- `scripts/ops/offline-min-apk-package.js`
- `/mnt/aasc-offline/manifest.json`
- `docs/design/android-offline-hot-update.md`
- `docs/spec/android-offline-hot-update.md`

## 验证结果

- 本机、LAN、WAN、设备缓存的 v14 文件均为 `062aee3158d5534c18b57bf8dcf28dccdffe9b27ebd33cbaa00b35fc0143382f`。
- `apksigner`：v2 `true`；证书 SHA-256 为 `a57fd4c34c0c769246239a7d8c606b5edb62c215ecf9659448ea178eda3fb7df`，与清单一致。
- full v13 证书摘要相同；通过 `adb install -r` 覆盖安装到 SM-N9500 成功，版本为 `0.2.11-offline` / versionCode 13。
- 安装后停止冲突的普通 `com.aasc.display` 进程，Offline Node 服务正常启动，`code=5, dependencies=3`，Chat2API 脚本含账号凭证导入/导出按钮。

## 结论与风险

v14 APK 文件和签名材料没有发现不一致；当前失败点是 Android API 28 的应用内归档签名读取/比对路径。继续修复 min 热更新需要修改校验实现并重新发布更高 versionCode；当前可使用外网 full v13 整包更新。
