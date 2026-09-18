# Offline full APK v13 发布任务

## 任务描述

重新构建并发布包含 Chat2API 账号凭证导入导出、账号网页会话和 Android Cookie/LocalStorage 恢复实现的完整 Offline APK。发布前必须使用递增 versionCode，不能覆盖已有不同内容的版本文件。

## Design 需求

- 使用 `allserver` profile 构建完整 Offline APK。
- LAN 目标为 `/mnt/aasc-offline`，WAN SCP 目标为 `as@120.79.245.103:~/a/aasc-offline`。
- 发布器先校验大小和 SHA-256，再以版本文件名安装，保留服务 `manifest.json`。
- 外网验收使用 `120.79.245.103` 直连地址；域名 `c.aasc.us` 的 403 不作为发布失败依据。

## Spec 设计

- `docs/spec/android-offline-hot-update.md` 中的 full APK 版本和发布伪代码必须与本次结果同步。
- `release/apkbuild/allserver/app.json` 的 `versionCode` 必须大于已发布的 v12。
- 输出 `build-manifest.json` 必须记录 profile、versionName、版本码、文件名和 SHA-256。

## 受影响的功能模块和代码

- `release/apkbuild/allserver/app.json`
- `scripts/ops/build-apk.js`
- `scripts/ops/publish-offline-update.js`
- 完整 Offline Runtime、Android APK 和本次 Chat2API/Android 源码资源
- `docs/design/android-offline-hot-update.md`
- `docs/spec/android-offline-hot-update.md`
- `docs/todo.md`
- `changelog.md`

## 执行结果

- versionCode 从 12 递增为 13，versionName 为 `0.2.11-offline`。
- 完整 APK：`release/apkbuild/allserver/output/aasc-display-offline.apk`。
- 发布文件：`apk/aasc-display-offline-v13.apk`。
- 大小：`957338670` bytes。
- SHA-256：`326d30feada394860925d2f11320bd4fb60b84cae1a710135303b89be203429c`。
- LAN：`http://192.168.1.39/mnt/aasc-offline/apk/aasc-display-offline-v13.apk`。
- WAN：`http://120.79.245.103/mnt/aasc-offline/apk/aasc-display-offline-v13.apk`。
- 两端 Content-Length 和文件 hash 与本地一致，发布器清理无错误；服务更新 `manifest.json` 未替换。

## 自测用例

1. 使用固定 MNN revision 构建 `allserver` profile。
2. 检查 build manifest 为 `versionCode=13`、`versionName=0.2.11-offline`。
3. 检查本地 APK SHA-256 与 build manifest 一致。
4. 检查 LAN/WAN HTTP 返回 200、Content-Length 等于 `957338670`。
5. 检查 WAN 远端文件 SHA-256 与本地一致。
6. 检查旧 v12 不被覆盖，服务 `manifest.json` 保持原内容。

## 兼容性测试

- 构建参数：`AASC_MNN_ROOT=/mnt/AASC/build/third_party/MNN`、`AASC_MNN_REVISION=d407447ed56c4121a11ccbd266dc184ca1ead0c2`。
- 构建 profile：`allserver`、`embeddedNode=true`、`updateOnly=false`、`arm64-v8a`。
- 目标设备保持既有完整 Offline APK 的 applicationId、签名和数据目录兼容性。
- 默认域名 `c.aasc.us` 返回 403；使用 LAN 和 WAN 直连 IP 完成验收。

## 性能测试

- 完整 APK 构建和 Runtime 资源复制成功。
- 本地、远端包体积与传输后 Content-Length 一致。
- 发布器使用版本文件和临时文件原子落盘，未改写服务 manifest。

## 风险评估

- 完整 APK 约 913MiB，构建、hash 和 SCP 上传耗时较长。
- 同版本内容变化会被发布器拒绝；本次通过递增 v13 处理，未覆盖 v12。
- 域名入口存在 403，设备更新仍可使用 LAN 优先及 WAN IP 回退路径。
- 本轮只完成构建和双站点发布，未在真机上重新安装 v13 做现场业务回归。

## 预计工时

- 约 1 小时，包含重新构建、上传、双站点校验和文档同步。
