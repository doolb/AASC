# Offline min APK v14 发布

## 任务描述

为已发布的 full Offline APK v13 配套发布新的 min 热更新 APK，使包含当前 Android 显示端代码的设备可以通过现有更新清单手动确认下载。域名仅用于 DNS 解析，发布验收和设备实际 HTTP 请求使用解析后的 IP。

## Design 需求

- min 包的 `versionCode` 必须高于 full v13 的 `13`，避免 Android 原位安装降级。
- 更新清单继续复用现有签名、LAN/WAN 发布和旧版本清理流程。
- 更新日志随 `apkMin.releaseNotes` 写入签名清单，并在更新卡片中保留手动下载确认。

## Spec 设计

- `allserver-min/app.json` 使用 `versionCode=14`、`versionName=0.2.12-offline-min`。
- 构建输出 `release/apkbuild/allserver-min/output/aasc-display-offline-min.apk`。
- `package:offline-apk:min` 基于当前清单生成 `manifest-apk-min-v14.json`；发布器只替换 `apkMin` 和 `manifest.json`，保留 code/dependencies。
- 发布目标为 `/mnt/aasc-offline` 和 `as@120.79.245.103:~/a/aasc-offline`，HTTP 验收使用 `192.168.1.39` 与 `120.79.245.103`。

## 受影响模块和代码

- `release/apkbuild/allserver-min/app.json`
- `tests/apk-build-profile.test.js`
- `scripts/ops/build-apk.js`
- `scripts/ops/offline-min-apk-package.js`
- `scripts/ops/publish-offline-update.js`
- `docs/design/android-offline-hot-update.md`
- `docs/spec/android-offline-hot-update.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

- 构建 min APK，检查 build manifest 的版本、文件名和 SHA-256。
- 使用 apksigner 校验 APK 签名和 v2/v3 签名结构。
- 生成并验证 RSA 签名清单，确认 `apkMin.versionCode=14`、更新日志和文件 hash 一致。
- 通过 LAN/WAN 直连 IP 读取清单，检查 APK HTTP 200、Content-Length 和完整 hash。
- 在 SM-N9500 Android 9/API 28 Display 2 重启应用，确认更新卡片显示 v14 且仍需点击“下载更新”。

## 兼容性测试

- 已安装 min v10 的设备可发现 v14 更新。
- full v13 的 versionCode 为 13，v14 高于当前包，可执行原位更新。
- 域名 403 不作为失败条件；设备通过 DNS 解析后访问 `120.79.245.103`。

## 性能测试

- 构建、签名和清单发布完成；未自动下载或安装 85 MB 更新包，保持用户手动确认策略。
- 发布器远端校验完整读取 v14 APK，未发现 hash 或 Content-Length 不匹配。

## 风险评估

- Android 系统安装最终仍需用户确认；本次不绕过系统安装确认。
- v14 仅是 min 更新包，full v13 仍需独立安装；服务 code/dependencies 版本沿用清单中的权威版本。
- 默认域名返回备案拦截 403，因此发布脚本验收使用直连 IP。

## 预计工时

约 30 分钟，实际完成构建、签名、双站点发布与真机提示验证。
