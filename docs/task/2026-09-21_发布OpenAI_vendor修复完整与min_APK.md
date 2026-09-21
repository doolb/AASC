# 发布 OpenAI `_vendor` 修复完整与 min APK

## 任务描述

将已修复 APK 原生 OpenAI `_vendor` 路径的完整 Offline APK 与 min APK 一起重新构建，并发布到局域网和外网。

## 发布计划

- 完整 Offline APK 版本提升为 v23，避免覆盖已发布的 v22 同名文件。
- Offline min APK 版本提升为 v32，避免低于当前已发布的 v31。
- 使用现有签名、公钥和服务 code/dependencies 清单。
- 发布前校验 APK SHA-256、签名、ZIP 完整性和 OpenAI marker；发布后校验 LAN/WAN HTTP 资源。

## 受影响文件

- `release/apkbuild/allserver/app.json`
- `release/apkbuild/allserver-min/app.json`
- `release/apkbuild/allserver/output/aasc-display-offline.apk`
- `release/apkbuild/allserver-min/output/aasc-display-offline-min.apk`
- `release/offline-update/output/` 版本化发布资源

## 自测与兼容性

- 完整 APK 保留 `aasc-openai-vendor` marker，安装器恢复为 `_vendor`。
- min APK 不携带服务器依赖，仅更新原生 Runtime。
- LAN/WAN 清单、APK、code/dependencies 版本和 SHA-256 保持一致。

## 风险

- 完整 APK 约 1GB，构建和上传耗时较长。
- 发布清理只删除规则允许的旧版本文件，不触碰日志、模型、配置和任务结果。

## 完成结果

- ✅ 完整 Offline APK v23（`0.2.21-offline`）构建并发布。
  - 大小 `1,012,056,819` bytes。
  - SHA-256 `16232db682a1c52f7aa7492f61850ff4cfff34c1869be370a3cc27f95cfc9ff4`。
- ✅ Offline min APK v32（`0.2.30-offline-min`）构建并发布。
  - 大小 `89,273,298` bytes。
  - SHA-256 `d68679c7d93c0550e909ab36fae0a59ee1c2e8cb278fd74bc9451f96cf81933a`。
- ✅ code v19、dependencies v4 和 min v32 清单已同步到 LAN/WAN；两端 HTTP 200、
  Content-Length、SHA-256 和签名校验通过。
- ✅ 旧完整/min 版本按精确规则清理，仅保留完整 v23 与 min v32；未触碰日志、模型、配置和任务结果。
