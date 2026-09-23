# Offline MMD 内网源回退

## 任务描述

让 Offline APK 的 MMD 静态资源代理使用与热更新相同的家庭内网、公司内网、外网源顺序，减少局域网访问公网模型资源的流量和等待。

## Design 需求

- 静态 MMD 上游固定顺序为 `192.168.1.39`、`10.221.70.87`、`c.aasc.us`，路径保持 `/mnt/mmd/miya-v1/`。
- 每个被请求的资源按顺序尝试来源；某来源 DNS、网络、超时、状态码、Content-Length、完整字节数或 SHA-256 校验失败时继续下一来源。
- 外网域名解析为 IPv4 后替换 URL 主机；内网 IP 直接访问；所有源都不允许重定向。
- 只返回既有 14 个文件白名单；每个候选来源都独立执行状态、长度及 SHA-256 校验。
- 本地 MMD manifest 有效时继续优先返回本地 profile；只有本地 manifest 缺失才进入静态源代理；本地 manifest 无效时仍返回错误。
- Android WebView 仍只访问本机 `/api/mmd/static/...`，不直接访问 LAN/WAN。
- 不缓存或保存模型，不修改 APK profile/资源，也不构建或发布 APK。

## Spec 设计

更新 `docs/spec/mmd-pmx-vmd-local.md` 的 `resolveMmdProfile` 与 `GET /api/mmd/static/<relativePath>` 伪代码，按固定三源顺序解析域名、逐源校验和回退；本地清单优先和静态文件白名单保持不变。

## 受影响功能模块和文件

- `src/apps/server/modules/mmd/mmd-resource-service.js`
- `docs/design/mmd-pmx-vmd-local.md`
- `docs/spec/mmd-pmx-vmd-local.md`
- `docs/task/20260923_OfflineMMD内网源回退.md`
- `changelog.md`
- `release/offline-release-status.json`：确认 `servicePackage=true`；此标记在本任务开始前已为 true，无需再修改。

## 自测用例

1. 家庭内网资源返回正确状态、长度和 SHA-256 时直接成功，不访问后续源。
2. 家庭内网超时、404、错误 Content-Length、截断内容或 hash 错误时继续尝试公司内网，再尝试外网。
3. DNS 返回多个 IPv4 时按解析顺序尝试；DNS 失败时跳到下一配置源。
4. 所有来源不可用或内容校验失败时返回结构化 502，不返回部分内容。
5. 额外资源名、路径穿越和 query 仍在发出请求前拒绝。
6. 本地 MMD manifest 有效时不请求网络；manifest 仅缺失时使用三源代理；manifest 无效时不回退。

## 兼容性测试

- 家庭内网、公司内网、公网可达及逐源失效组合。
- 域名多 IPv4 解析；LAN IP 不触发 DNS；拒绝 HTTP 重定向。
- 显示端仍只向本地 HTTPS 同源 Node 服务请求 PMX、VMD 和纹理。

## 性能测试

- 首个可用来源成功时不连接后续来源。
- 只有前序来源不可用或内容无效时才触发后续请求；MMD 单文件大小限制和 300 秒单源超时保持不变。

## 风险评估

- 家庭、公司目录必须发布相同 `miya-v1` 文件；每个来源都按固定 SHA-256 校验，不匹配时会继续回退。
- 顺序尝试会让多个不可达内网源增加延迟；当前 MMD 代理的单源请求超时为 300 秒，连续超时可能叠加。
- WAN 固定域名当前 DNS 无可用 IPv4 时仍会失败，但前序 LAN 可用时不受影响。

## 预计工时

约 1 小时。

## 执行结果

- 已实现家庭内网、公司内网、外网三源顺序；每个文件的 DNS/请求/响应校验失败会继续下一候选源，全部失败后返回 502 汇总。
- 本地有效 manifest 优先、固定白名单、长度/hash 校验和同源浏览器代理规则保持不变。
- `node --check src/apps/server/modules/mmd/mmd-resource-service.js` 与 `git diff --check` 通过；未运行自动化测试、构建或发布任何 Offline 包。
