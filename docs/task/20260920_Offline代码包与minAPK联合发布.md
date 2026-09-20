# Offline 代码包与 min APK 联合发布

## 任务描述

将显示端聊天播报文字隐藏和 Offline 分辨率诊断浮层自动隐藏两个修改一起发布；只发布服务代码包与 update-only min APK，不重新发布完整 Offline APK 或新的生产依赖包。

## Design 需求

- code-only 复用 dependencies v3。
- min APK 版本递增到 v21，并与 code v12 写入同一份最终签名清单。
- 发布到 LAN `/mnt/aasc-offline` 和 WAN `as@120.79.245.103:~/a/aasc-offline`。
- 域名 `c.aasc.us` 的 HTTP 403 不作为本次 WAN 验收入口，使用 WAN 直连 IP。

## Spec 设计

```text
publish code v12 with old min v20 retained
verify code v12
publish min v21 with code v12 and dependencies v3
verify signed manifest and all artifact hashes
cleanup exact versioned files only
```

## 受影响的功能模块和代码

- `src/apps/web-mediacenter/ui/public/js/display-stage.js`
- `src/apps/web-mediacenter/ui/public/css/display.css`
- `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- `release/apkbuild/allserver-min/app.json`
- `release/offline-update/output/code/code-v12.zip`
- `release/offline-update/output/apk/aasc-display-offline-min-v21.apk`

## 自测用例

- code v12 ZIP 包含 `display-chat-open` 状态类和播报文字隐藏规则。
- min APK `unzip -tq` 通过，包名为 `com.aasc.display.offline`，versionCode 为 21。
- min APK v2 签名证书摘要与现有 Offline 包一致。
- 最终 LAN/WAN manifest 签名有效，code/dependencies/min 的 Content-Length 和 SHA-256 一致。
- `tests/display-chat-mmd.test.js`、Offline 更新包/发布器测试共 43 项通过。

## 兼容性测试

- 保留 dependencies v3，不触碰日志、模型、配置、任务、results 和既有 full APK。
- code v12 先发布并保留 min v20，再发布 min v21，避免中间清单引用缺失资源。
- LAN `192.168.1.39` 和 WAN-IP `120.79.245.103` 的 HTTP manifest 与资源 HEAD 均返回 200。

## 性能测试

- 未上传 104867634 bytes 的 dependencies v3，避免重复传输生产依赖。
- min APK 大小 `89262778` bytes；code ZIP 大小 `15165248` bytes。

## 风险评估

- `c.aasc.us` 当前返回 403，域名入口需代理侧放行后再单独验收；直连 WAN IP 已验证。
- 本次只更新原生 min APK 与服务代码，未更新模型、`.mmap` 或完整 APK。

## 执行结果

- code v12：SHA-256 `d4ba44a7ac644133c95f8a688687cc6ac6535e4ec28c1b4bd47ede2b789ee062`。
- min v21：SHA-256 `0d85da66dee31bfe4fcc2f8326df30507288d5edaf3a6e08258fdf60ca45591d`。
- LAN/WAN 发布成功，`cleanupErrors=[]`；最终清单为 code v12、dependencies v3、apkMin v21。
- 状态：已完成。
