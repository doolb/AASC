# Offline 声纹修复 full v17 发布任务

## 任务描述

发布包含 Offline 声纹模型启动预热、注册等待和断线回收修复的完整 Offline APK，不改写服务更新 `manifest.json`。

## Design 需求

- 使用 `allserver` profile 构建完整 Offline APK。
- 使用递增 `versionCode=17`，兼容已发布 full v15 和 min v16。
- full APK 以 `apk/aasc-display-offline-v17.apk` 发布到 LAN/WAN，不进入服务更新清单。
- 发布前校验 profile、版本、文件大小、SHA-256、APK v2 签名和声纹模型资源。

## Spec 设计

- `build-manifest.json` 必须声明 `profile=allserver`、`offline=true`、`embeddedNode=true`、`updateOnly=false`。
- APK 必须内置 3D-Speaker embedding 与 pyannote segmentation 模型。
- 发布器先上传版本化文件，再执行 HTTP/远端校验和精确 full APK 清理。
- LAN/WAN 的服务 `manifest.json` 不得因完整 APK 发布发生变化。

## 受影响的功能模块和代码

- `release/apkbuild/allserver/app.json`：full v17 打包版本输入。
- `src/apps/web-mediacenter/ui/public/display.html`：声纹启动预热和注册等待逻辑。
- `src/apps/server/boot/server-app.js`：服务端注册等待与断线回收逻辑。
- `docs/design/android-offline-hot-update.md`、`docs/spec/android-offline-hot-update.md`：发布记录。
- LAN `/mnt/aasc-offline` 和 WAN `as@120.79.245.103:~/a/aasc-offline`：版本化 APK 发布目标。

## 自测用例

- build manifest 版本为 17，版本名为 `0.2.15-offline`。
- APK 包含两个声纹模型和最新 `display.html`/`server-app.js`。
- APK v2 签名、签名证书、大小和 SHA-256 校验通过。
- LAN/WAN HTTP 返回 200 和正确 Content-Length，远端文件 hash 与本地一致。
- full v15 被精确清理，min v16 保留，服务 `manifest.json` 保持不变。

## 兼容性测试

- full APK 保持 `com.aasc.display.offline`、既有签名证书和 arm64-v8a profile。
- 已安装 full v15 或 min v16 的设备可作为覆盖安装目标；本次尚未进行 SM-N9500 现场安装。
- min APK 的 update-only 发布清单和既有模型缓存不受本次 full 发布影响。

## 性能测试

- 记录本次 full APK 构建约 30 分钟，主要耗时来自 Runtime、Node 依赖和模型资源 asset merge。
- 记录最终 APK 大小和双站点 Content-Length 一致性。

## 风险评估

- APK 约 949 MiB，设备下载和首次 Runtime 解包耗时较长。
- 尚未进行真机注册回归，发布后需重点验证声纹模型预热及“模型未就绪”问题。
- 服务更新 `manifest.json` 未变化，已安装设备不会通过 min 更新卡片自动发现 full v17。

## 执行结果

- full v17 构建成功：`release/apkbuild/allserver/output/aasc-display-offline.apk`。
- build manifest：`versionCode=17`、`versionName=0.2.15-offline`、`runtimeVersion=content-66a58ac3db666f77814db692`。
- APK：`995442031` bytes，SHA-256 `355826ce69a6b35de08717263fd94672739492d640dd284bc24cdfb9017ea0e5`。
- v2 签名通过，证书 SHA-256 `a57fd4c34c0c769246239a7d8c606b5edb62c215ecf9659448ea178eda3fb7df`。
- LAN/WAN 发布与验收通过，清理无错误；服务 `manifest.json` 未替换。
