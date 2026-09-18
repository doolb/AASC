# Offline full APK v12 发布

## 任务描述

将当前 Offline full APK 与 min versionCode 12 对齐，构建新 full 包并发布到 LAN/WAN 双站点。

## Design 需求

- full APK 使用 `allserver` profile，版本为 `versionCode=12`、`versionName=0.2.10-offline`。
- 保持与已安装 min APK 相同的包名和签名，完整包不替换服务热更清单。
- 发布后保留旧 full 版本，并校验 LAN/WAN HTTP、远端 hash、APK 签名和 ZIP 完整性。

## Spec 设计

- 读取 `release/apkbuild/allserver/output/build-manifest.json` 中的 full 版本与 hash。
- 以 `apk/aasc-display-offline-v12.apk` 为版本化目标，先上传临时文件，再原子切换。
- 使用 LAN 与 WAN 直连 IP 验证文件；域名入口 403 时记录并不作为验收入口。

## 受影响的功能模块和代码

- `release/apkbuild/allserver/app.json`
- `scripts/ops/build-apk.js`
- `scripts/ops/publish-offline-update.js`
- `docs/design/android-offline-hot-update.md`
- `docs/spec/android-offline-hot-update.md`

## 自测用例

1. full APK versionCode/versionName 与 profile 配置一致。
2. APK v2 签名验证通过。
3. APK ZIP 完整性验证通过。
4. LAN/WAN 返回 HTTP 200 且 Content-Length 正确。
5. 本地、远端和 HTTP 下载文件 SHA-256 一致。

## 兼容性测试

- 包名与既有 Offline/min APK 保持 `com.aasc.display.offline`。
- 版本码不低于当前 min v12，旧 full v9 仍保留。
- 服务 code v4、dependencies v3 和 min v12 清单保持不变。

## 性能测试

- 构建完成后记录 APK 大小和上传结果；不改变运行时服务协议。

## 风险评估

- 完整 APK 体积约 913 MiB，构建和外网上传耗时较长。
- 默认域名当前返回 403，需使用直连 IP 验收。

## 预计工时

- 约 30 分钟。

## 执行结果

- full profile 已升级为 versionCode 12、versionName `0.2.10-offline`，构建成功。
- APK 大小 `957319386` bytes，SHA-256 `b107d7963bf4dd18068404427e12f4edc72ff8253e8914e3d1909ca66e6c8183`。
- 已发布为 `apk/aasc-display-offline-v12.apk` 到 LAN/WAN；直连 IP HTTP 200、Content-Length、远端 hash、APK v2 签名和 ZIP 完整性校验通过。
