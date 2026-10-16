# Offline Node 子显示端独立 ZIP

## 需求

`voice-display-node` 是独立运行的 Node.js 子显示程序，当前却被完整复制进 Offline 服务 code ZIP，使服务包携带其 Windows 原生录音与语音识别依赖。需要从自动服务更新代码包移除该程序，同时为手工部署提供独立、可校验的版本 ZIP。

## 设计

- 普通服务 code ZIP 排除整个 `src/apps/voice-display-node/`，不会把子显示端接入服务自动更新组件或 `manifest.json`。
- 每次构建服务代码版本 `N` 时，同步生成 `voice-display-node/voice-display-node-vN.zip`，压缩包内保留 `src/apps/voice-display-node/` 原路径，并附带其使用的两个无业务状态共享模块 `src/framework/observability/{system-monitor,console-redirect}.js`，以便手工解压至项目根目录并由服务端按现有路径写入运行配置。
- 独立 ZIP 包含程序源码、应用级 `package.json`/lockfile、`README.md`、`config.example.json` 和当前平台已准备的应用依赖；排除机器运行配置 `config.json`、`run-task/`、根级 logs/models/results/temp/cache 数据目录以及 npm 命令软链接目录 `node_modules/.bin/`。不跟随或收录符号链接和特殊文件。
- ZIP 配套 `voice-display-node-vN.json` 使用 Offline RSA 密钥签署版本、相对路径、大小、SHA-256 和源码提交信息。该 sidecar 仅用于人工验包，不被服务更新客户端读取。
- 通过单独的 npm 发布命令将 ZIP 与签名 sidecar 发布到 LAN/WAN 服务根下的 `voice-display-node/`；先校验文件、签名和 HTTP 内容，再按严格数字版本名清理旧 ZIP/sidecar。发布不会替换服务 `manifest.json`。
- 新增 `voiceDisplayNodePackage` 待产物状态；服务包重打同时标记 `servicePackage` 与独立子显示端包，APK 和生产依赖状态依实际变化保持。
- 首个包使用与同次服务代码包一致的版本号，便于人工成对查验，但两个产物的发布/安装生命周期独立。

## 边界

该包是手工获取、手工解压的程序分发文件，不轮询、不下载、不自动安装。模型、日志、任务结果及本地配置不属于发布 ZIP。Windows 原生依赖平台范围以出包机内已存在的应用级 `node_modules` 为准。
