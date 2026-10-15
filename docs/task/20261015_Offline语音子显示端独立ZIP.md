# Offline 语音子显示端独立 ZIP

## 任务描述

将独立程序 `src/apps/voice-display-node` 从服务自动更新 code ZIP 中移除，新增同版本号的自包含程序 ZIP 与独立签名校验元数据，并分别发布到 LAN/WAN；不接入自动更新，不构建 APK。

## 需求等级评审

- 结论：可开发；主等级 L6（独立构建/发布组件契约），次等级 L5（双站点发布流程）与 L4（声明级伪代码），层级相邻混合；直接开发风险低。
- 证据：用户明确“node子显示端是个单独的程序”（L6，强）；用户明确“不用自动更新，单独zip”（L6，强）；现有 Offline 规则要求服务包清单原子切换、版本化上传与两端校验（L5，中）。主等级证据权重 6/8 × 邻层一致系数 0.90，置信度 0.675（中）。
- 评分：层级清晰度 25/25，证据充分度 18/20，实现完备度 19/20，风险暴露度 18/20，L4 可落地性 15/15，总分 95/100。
- 断点：独立包运行时还需要两个 `src/framework/observability` 文件；通过静态依赖检查补入并用 ZIP 内容回归验证。发布没有 `manifest.json` 指针；通过 detached RSA sidecar + 固定下载路径和明确手工安装边界解决。
- 下放：必须下放到 L4。现有声明为 `createOfflineUpdateArtifacts`、Offline 发布状态文件和服务代码发布命令；新增 `voiceDisplayNodePackage { version, source, relativeUrl, size, sha256, signature }`。流程：服务版本 → Node 程序快照 → 签名 ZIP → 校验并分别上传 LAN/WAN → HTTP 核验 → 精确清理。

## Design 需求

- 普通 service code ZIP 不含整个 Node 子显示端目录。
- 独立 ZIP 保持原项目相对路径，含应用源码、应用 README/config 示例、package/lock、现有依赖，以及程序引用的两个纯共享观测模块。
- 排除本机 `config.json`、`run-task`、日志/模型/结果/临时数据和 `.bin` 软链接，不允许其他链接/特殊文件。
- Detached metadata 使用 Offline RSA 签名并绑定版本、相对路径、大小、SHA-256 和来源提交。
- LAN/WAN 独立发布和校验，不改服务 `manifest.json`，只按严格数字版本名清理当前发布目录的旧普通文件。
- 新增 `voiceDisplayNodePackage` 状态，服务 ZIP 与 Node ZIP 成功构建后分别清除对应待构建状态。

## Spec 设计

见 [offline-voice-display-node-package 伪代码](../spec/offline-voice-display-node-package.md)：服务快照过滤、应用级 Node 快照与签名 sidecar、双站点独立发布、HTTP 完整性复核和精确清理。

## 受影响模块与文件

- `scripts/ops/offline-update-package.js`、`scripts/ops/voice-display-node-package.js`、`scripts/ops/publish-voice-display-node.js`、`package.json`。
- `tests/offline-update-package.test.js`、新增 Node ZIP/发布测试及 npm 定向测试入口。
- `release/offline-release-status.json`、`docs/rules.md`、Offline hot update 设计/伪代码、独立设计/伪代码索引、`docs/todo.md`、`changelog.md`。
- `src/apps/voice-display-node/README.md`：人工解压、配置和启动方式。

## 自测用例

| 场景 | 验收要求 |
|---|---|
| 服务 ZIP 排除 | ZIP 没有 `src/apps/voice-display-node/`，其余服务端/UI及 package 文件保留 |
| 独立 Node ZIP | 原路径、入口、应用 package/lock、应用依赖完整 |
| 可变文件隔离 | `config.json`、`run-task/`、`node_modules/.bin/` 不在 ZIP |
| 路径安全 | 符号链接、特殊文件、缺少入口或依赖时失败，不产出有效 sidecar |
| 内容绑定 | sidecar RSA 验签成功，版本、size、SHA-256 对应 ZIP |
| 发布隔离 | Node-only 发布只上传 ZIP/sidecar，不变更 `manifest.json` |
| 清理安全 | 仅删除指定目录严格数字版本的普通旧文件，链接和非版本文件保留 |
| LAN/WAN 验证 | 两站点 HTTP 状态、文件大小与完整 SHA-256 对应本地 |

## 兼容性、性能与风险

- 老服务更新客户端不认识也不请求 Node sidecar；既有程序需通过手工下载/解压获取新版本。
- 解压保留原路径，服务启动配置同步仍可使用原目录；打包排除运行配置，避免发布本机地址。
- ZIP 构建额外读取/压缩现有 Node 依赖，耗时与独立目录大小线性相关；不会安装或升级依赖。
- 风险：本机依赖含平台原生二进制；发布元数据和README必须说明实际构建平台与启动前提。

## 预计工时

实现与定向验证约 2 小时，双站点传输/HTTP核验和精确清理约 30 分钟；不含设备手工安装验收。

## 执行记录

- [x] 用户确认“不用自动更新，单独 ZIP”。
- [x] 文档与待产物状态已先行更新。
- [ ] 实现成对构建、独立发布及定向测试。
- [ ] 构建 code-vN 与 voice-display-node-vN，确认服务清单不包含 Node 组件。
- [ ] 发布 LAN/WAN，核对签名、HTTP、大小、SHA-256 和清理结果。
- [ ] Git 提交并推送代码和状态。
