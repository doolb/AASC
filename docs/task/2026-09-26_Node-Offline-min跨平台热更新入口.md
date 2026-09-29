# Node Offline min 跨平台热更新入口

## 任务描述

新增单文件启动入口 `release/allserver-min.js`：目标机只需复制该文件并准备 Node/npm，即可在 Windows/Linux 直接运行。启动器从现有 Offline 签名清单下载独立的 `nodeMinSeeds` ZIP，首次启动补齐本地缺失文件；再下载通用 code ZIP，并按 ZIP 内 manifest 在目标机安装依赖。不要求仓库源码、初装 `node_modules` 或 Android 依赖包、APK、模型。

## Design 需求

- 以现有 `manifest.json` 的 `components.code` 和 `components.nodeMinSeeds` 作为更新源，单文件本身不依赖项目生产包或内嵌初始数据。
- 更新器本身保持在版本化代码目录之外；配置与运行数据位于稳定项目根目录。
- `npm run build:offline-update` 从 release 配置、用户配置和任务目录生成独立种子 ZIP，并将它的大小和 SHA-256 写入同一签名 manifest；发布器将 ZIP 上传到 Offline 更新服务器。
- 服务以 release 模式运行，实际读取 `release/config`、`release/userconfig`、`release/task`。
- 使用 Node 内置 ZIP 解压能力完成清单验签、种子/code 下载、哈希检查、安全解压和 npm 安装后才切换活动版本。
- 启动失败能回滚到上一版本；Windows 与 Linux 共用 JS 入口。

## Spec 设计

详细伪代码见 `docs/spec/offline-node-min-runtime.md`。启动入口检查 Node 版本并从清单引导首个代码包；首次运行和锁文件变化时都使用 code ZIP 内的 package manifest 在目标机安装依赖。

## 受影响文件与模块

- `release/allserver-min.js`：单文件跨平台引导、内置 ZIP 读取、依赖安装、服务监督和回滚。
- `docs/design.md`、`docs/spec.md`、对应 design/spec 文件：索引与实现约束。
- `docs/usage.md`：Windows/Linux 安装和启动说明。
- `docs/todo.md`、`changelog.md`：现场验收事项和变更记录。
- `release/offline-release-status.json`：服务代码包状态继续按既有规则维护；不触碰 Android min APK 状态。

## 手动自测用例（本轮不执行）

1. Windows/Linux 只放置 `allserver-min.js` 并安装 Node/npm 后运行；确认从服务器下载签名种子 ZIP、初始化 release 配置与任务，随后从 code ZIP 安装依赖。
2. 已有 release 配置、用户配置和任务结果不被种子覆盖；种子指纹相同时不重复写入。
3. 签名错误、hash 错误、ZIP 路径穿越和错误 lock 指纹都不得切换活动代码。
4. 同 lock 指纹更新复用依赖；新 lock 指纹由目标机 npm 安装对应平台依赖。
5. 新版本就绪后切换成功；故意启动失败后回滚旧代码。
6. 更新期间检查 config、logs、res/models、任务和上传文件均保留。

## 兼容性与性能检查

- 兼容性：Windows x64、Linux x64；Linux ARM64 需后续现场确认。
- 性能：相同 lock 文件时跳过 npm ci；代码下载使用流式写入和 SHA-256，更新检查不影响模型与媒体数据。

## 风险评估

- 首次运行必须能访问 Offline code 源和 npm registry；已运行后 registry 不可用且锁指纹变化时保留旧版本。
- 进程被强制终止时可能留下 staging 目录；下次运行只允许安全地重用或报告该目录，不覆盖已发布版本。
- 更新器入口自身不在 code ZIP 内，后续修复更新器时需单独替换该 JS 文件。
- 启动器和 `noserver`、`withserver` APK 作为配套下载资源发布在外网 `/mnt/node-min/`，不放入 `/mnt/aasc-offline/`；修改启动器或重新构建 APK 后上传对应文件，并核对公网 HTTP 状态、大小和 SHA-256。

## 预计工时

- 实现与文档：约 3–5 小时。
- Windows/Linux 真机部署验收：依目标机器和网络条件另计。

## 执行记录

- 根据 `release/1.txt` 修正 Windows 根目录部署：可将脚本放在数据根目录或 `release/` 子目录运行；路径边界校验使用 `path.relative`。
- 单文件部署的 release 初始数据改由服务器独立 ZIP 提供；新增 `nodeMinSeeds` 签名清单组件、构建/发布/同步流程和启动器下载校验逻辑。启动时只补缺失文件，并以 release profile 启动服务。
- 已向内网和公网更新源发布 `nodeMinSeeds v39`，服务代码维持 v39；清单签名、种子 ZIP SHA-256/大小与全部组件 HTTP 大小校验通过。公司更新源连接超时；Windows/Linux 目标机下载、启动及任务恢复仍待现场验收，未运行自动化测试。
- [2026-09-28] 启动器与 `noserver`、`withserver` APK 已发布到 `http://120.79.245.103/mnt/node-min/`，并从原 `aasc-offline` 目录移除启动器。两个 APK 均从当前源码重建，profile 为 `noserver`/`withserver`，versionCode `1`、versionName `0.1.0`；外网 HTTP 状态和大小正确，服务器 SHA-256 与本地一致。
