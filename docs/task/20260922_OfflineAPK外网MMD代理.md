# 2026-09-22 Offline APK 外网 MMD 同源代理

## 任务描述

使既有 Offline APK 在不内置 PMX、纹理或 VMD 的前提下，按静态 VRM 的安全规则从已发布的 `miya-v1` 公网目录加载当前 MMD 角色。实际模型请求由 APK 内嵌 Node 服务同源代理，显示端不直接访问外网。任务只修改服务端与显示端源码；不构建、签名、发布完整 APK、min APK 或服务更新包。

## Design 需求

- 固定上游为 `http://c.aasc.us/mnt/mmd/miya-v1/`，域名解析为 IPv4 后访问，不能由请求、动作计划或控制端替换。
- 固定声明米娅 PMX、12 张 PNG 纹理及 VMD 的路径、大小和 SHA-256；禁止额外文件、目录枚举和路径穿越。
- PMX profile 使用路径型 `/api/mmd/static/mmd/...` 代理，以保持 `tex/` 相对纹理请求可解析。
- 本地模型 manifest 有效时继续优先本地资源；只有本地 manifest 缺失时使用公网 profile；本地 manifest 损坏不能回退掩盖错误。
- 上游失败时 MMD 显示端维持占位，聊天、媒体、灯光和阴影不回归。
- 不持久缓存模型，不复制模型至 `res/models`、APK assets 或 Git。

## Spec 设计

- `mmd-resource-service` 定义不可变 `StaticMmdRelease`，生成静态 profile 并校验受限相对路径。
- 服务端注册 `GET /api/mmd/static/*`，只代理声明文件，限制 DNS、上游状态、超时、文件大小和 SHA-256。
- `/api/mmd/resources` 从本地 manifest 解析失败且原因是不存在时，返回 static profile；其他 manifest 错误继续返回 503。
- `display-mmd.js`、`display-pmx-runtime.js` 接受同源 `/api/mmd/static/mmd/...` 作为已验证 PMX/VMD 地址，拒绝外网 URL。
- Offline 服务代码更新包包含上述 JavaScript；`allserver`、`allserver-min`、Android Kotlin/Gradle 和模型 assets 不变。

## 受影响功能模块和代码

- `src/apps/server/modules/mmd/mmd-resource-service.js`
- `src/apps/server/modules/mmd/mmd-resource-service.test.js`
- `src/apps/server/boot/server-app.js`
- `src/apps/web-mediacenter/ui/public/js/display-mmd.js`
- `src/apps/web-mediacenter/ui/public/js/display-pmx-runtime.js`
- `tests/display-mmd-runtime.test.js`
- `tests/display-chat-mmd.test.js`
- `tests/android-node-runtime-package.test.js`
- `docs/design/mmd-pmx-vmd-local.md`
- `docs/spec/mmd-pmx-vmd-local.md`

## 自测用例

1. 固定 static profile 为 PMX、VMD 生成 `/api/mmd/static/mmd/...` 同源 URL。
2. 上游 URL 只能是解析后的 IPv4 与 `miya-v1` 固定根，任意 host、查询、路径穿越和未声明纹理均拒绝。
3. 上游响应的 HTTP 状态、Content-Length 和 SHA-256 必须匹配固定声明；错误返回 502，不能输出部分模型。
4. 本地 manifest 存在且有效时仍返回 `/models/mmd/...`；仅缺失时才返回静态 profile；格式或 hash 错误返回 503。
5. 显示端接受两类同源路径，仍拒绝 `http(s)`、`//` 和非 MMD API 前缀。
6. Offline Runtime/服务包构建输入不包含 `server/res/models/mmd/`、`display-models/miya`、PMX、VMD 或 PNG 纹理。

## 兼容性测试

- 桌面本地资源存在时保持当前 PMX/VMD 加载和灯光/阴影行为。
- 模拟 Offline 资源目录没有 `mmd/manifest.json` 时返回静态 profile。
- Android WebView 只请求 `https://127.0.0.1:8081/api/mmd/static/...`，不产生混合内容或 CORS 请求。
- VRM 静态代理、聊天、媒体、显示开关和动作循环不变。

## 性能测试

- 单一上游请求最大为固定声明文件大小，PMX/VMD/纹理不重复写入磁盘。
- 加载失败不保留部分缓冲或创建持久缓存；隐藏 MMD 仍暂停渲染循环。

## 风险评估

- 首次显示需联网下载约 13.4 MB 资源；网络不可用时角色只显示占位。
- 上游使用 HTTP，但仅由 Node 访问固定域名解析后的 IPv4；浏览器始终访问本地 HTTPS 同源代理。
- 资源版本变更必须先增加新的固定 release 定义和测试，再切换默认；不得让运行时信任未经固定的远端 manifest。

## 预计工时

约 2～3 小时，包括测试先行、服务端代理、显示端路径兼容和文档同步；不含 APK/服务包构建或发布。

## 执行结果

- 已完成固定 `miya-v1` release 的 14 文件白名单、IPv4 同源路径代理、完整响应长度/SHA-256 校验，以及本地清单优先、仅缺失清单回退的 profile 解析。
- 显示端 PMX/VMD 校验现在同时接受本地 `/models/mmd/` 与固定 `/api/mmd/static/mmd/` 前缀，其他 URL 和路径语法仍拒绝；未改动已有灯光、阴影或空白区旋转实现。
- Android Runtime 文件收集无条件排除 `res/models/mmd`，定向测试确认 PMX、VMD 与纹理不进入 `runtime-manifest.json` 或 `modelAssets`。
- 验证：MMD 服务测试 11/11；显示端契约测试 42/42；新 MMD Runtime 边界用例 1/1。合并定向集为 74/79，5 项既有 Windows 软链接权限、文件执行位与旧 Runtime 断言失败。完整 `npm test` 为 876/931；其余 55 项为证书 SAN、Windows/Unix 路径与软链接、缺少 `zip`/Chromium/构建输入、外部模型/工具依赖等环境基线失败。
- 明确未执行 `build:apk:offline`、`build:apk:offline:min`、`build:offline-update`、任何发布命令或 Git 暂存/提交；未写入 APK 或 Git 模型二进制。
