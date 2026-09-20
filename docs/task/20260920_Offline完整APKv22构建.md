# Offline 完整 APK v22 构建

## 任务描述

构建当前代码对应的完整 Offline APK，使用 `release/apkbuild/allserver` 配置，内置 Node 服务、生产依赖、显示端默认 MNN 模型和 Offline 原生 ASR/TTS 资源。完整包与当前 min APK 使用相同 versionCode 22，并在 ADB 真机安装验证后发布到 LAN/WAN。

## design 需求

- 使用完整包 profile `allserver`，不能使用 `allserver-min` 的 update-only 配置。
- 完整包版本与当前 min 包 versionCode 对齐，服务组件使用已发布的 code v13、dependencies v4。
- APK 内置显示端、llm、render-display、ASR、TTS、声纹和默认 MNN 模型。
- 构建完成后校验 build manifest、SHA-256、ZIP 完整性和关键模型资源。

## spec 设计

```text
读取 release/apkbuild/allserver/app.json
    读取 versionCode、versionName、serviceVersions

执行 npm run build:apk:offline
    传入 profile=allserver
    传入 offline=true、embeddedNode=true、updateOnly=false
    生成 output/aasc-display-offline.apk 和 output/build-manifest.json

校验 build-manifest
    profile == allserver
    updateOnly == false
    manifest.sha256 == sha256(APK)

校验 APK
    unzip -tq 成功
    apk-profile.features 包含 display、asr、tts、llm、render-display
    默认 MNN 模型目录和权重存在
    server/res/models 下的 Offline ASR/TTS/声纹资源存在

发布边界
    本次不调用 publish:offline-apk:full
    不替换 LAN/WAN manifest.json
    不上传或提交 APK、模型和构建中间文件
```

## 受影响的功能模块和代码

- `release/apkbuild/allserver/app.json`
- `release/apkbuild/allserver/output/aasc-display-offline.apk`
- `release/apkbuild/allserver/output/build-manifest.json`
- Android Offline APK 构建和完整包校验文档

## 自测用例

1. `npm run build:apk:offline` 成功生成完整 APK。
2. build manifest 为 `allserver`、versionCode `22`、`updateOnly=false`。
3. APK SHA-256 与 build manifest 一致。
4. `unzip -tq` 通过。
5. APK 内包含默认 MNN 模型权重、ASR/TTS/声纹模型和 Offline Node 服务资源。

## 兼容性测试

- 完整 APK 保持 `com.aasc.display.offline` 包和原有签名配置。
- 完整包不修改热更新服务 manifest，已安装设备的服务更新链路不受影响。
- 已在 ADB 真机 `192.168.1.6:5555` 原位安装并启动；Activity、Node 前台服务、HTTPS 状态接口、模型列表和聊天回复均完成验证。

## 性能测试

- 记录完整 APK 文件大小和 SHA-256。
- 构建过程使用固定 MNN checkout，未重新编译 MNN 源码。

## 风险评估

- 完整 APK 约 965 MiB，安装和首次解包需要较多存储空间。
- 构建尾部 Kotlin 编译守护进程清理提示失败，但 APK 已成功生成且 ZIP 校验通过；后续构建可重新创建守护进程。
- 已发布完整 APK 到 LAN/WAN；外网使用直连 IP 校验，域名入口仍受既有 HTTP 403 限制。

## 预计工时

- 完整包构建和校验：约 30 分钟。

## 执行结果

- 构建成功：`release/apkbuild/allserver/output/aasc-display-offline.apk`。
- 版本：`0.2.20-offline`，versionCode `22`，profile `allserver`，服务版本 `code=13/dependencies=4`。
- 文件大小：`1,011,571,032` bytes；SHA-256：`176548ec7a8768068160141d6a21bf0a76967f718ebafde6ee8364aff4411ad0`。
- `unzip -tq`、build manifest SHA 校验和关键模型资源检查通过。
- ADB 安装成功：包名 `com.aasc.display.offline`，versionCode `22`，versionName `0.2.20-offline`。
- 设备验证：`https://127.0.0.1:8081/api/status` 返回 HTTP 200；`/v1/models` 返回默认模型 `readyDisplayIds=["offline-display"]`；聊天接口返回非空 `chat.completion`。
- LAN/WAN 发布成功：两端 full APK 大小均为 `1011571032` bytes，SHA-256 均为 `176548ec7a8768068160141d6a21bf0a76967f718ebafde6ee8364aff4411ad0`，外网 HTTP 200/Content-Length 校验通过；服务 `manifest.json` 未修改。
- APK 和模型二进制仍未提交到 Git。
