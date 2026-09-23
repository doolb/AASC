# Offline 同步 MMD 目录树

## 任务描述

扩展 `sync:offline-update`，使用远端与本地共同父目录参数，同步服务更新目录和 MMD 静态资源目录。

## Design 需求

- `--source-url` 指向外网 `/mnt/`；`--local-root` 指向本机 `mnt` 父目录。
- 服务更新从远端 `aasc-offline/` 同步到本地 `aasc-offline/`。
- 递归同步远端 `mmd/` 整棵目录树到本地同级 `mmd/`。
- 仅访问同源、位于 MMD 根路径内的目录索引和文件；拒绝路径穿越、符号链接和不安全文件名。
- 每个文件先读取远端元数据，再流式下载、核对内容长度、计算 SHA-256 并原子安装。
- 记录远端验证器与本地 SHA-256；远端元数据未变且本地文件仍匹配时复用文件。
- 本地额外文件保留，不清理 APK 或服务发布目录中的其他内容。
- 保留直接使用 `/aasc-offline/` 作为 `--source-url` 的旧 CLI 行为。

## Spec 设计

更新 `docs/spec/android-offline-hot-update.md` 中的 `syncOfflineUpdate` 伪代码：区分父目录模式和旧直接模式，并补充 MMD 目录索引递归、HEAD 元数据、SHA-256 状态缓存、原子安装与本地额外文件保留流程。

## 受影响的功能模块和文件

- `scripts/ops/sync-offline-update.js`
- `docs/design/android-offline-hot-update.md`
- `docs/spec/android-offline-hot-update.md`
- `docs/usage.md`
- `docs/task/20260923_Offline同步MMD目录树.md`
- `changelog.md`

## 自测用例

1. 以公网 `/mnt/` 和本机 `mnt` 为根同步时，服务更新落到 `aasc-offline/`，MMD 文件落到 `mmd/`。
2. 目录索引递归包含子目录；父目录、跨源、查询链接和路径穿越链接不作为文件下载。
3. 文件长度或远端响应校验失败时不安装不完整文件、不更新该文件的状态缓存。
4. 第二次同步时远端元数据未变且本地 hash 一致的文件不发起文件 GET；本地文件被修改后重新下载。
5. 本地额外文件保留；普通旧的 `--source-url .../aasc-offline/` 模式继续只同步服务更新。
6. 代码与文档更新不需要 Offline APK、服务包或依赖包。

## 兼容性测试

- Windows 带空格目录、Linux 目录和 UTF-8 文件名。
- Apache autoindex 的排序链接、父目录链接、文件链接和目录链接。
- 已有符号链接、路径穿越和非普通目标文件拒绝处理。

## 性能测试

- MMD 文件按流式方式处理，不将大模型文件整体载入内存。
- 已同步文件仅执行 HEAD 元数据读取及本地 SHA-256 检查，不重复下载文件内容。

## 风险评估

- 目录镜像依赖 Apache autoindex 可读取；若服务器关闭目录索引，需要提供清单接口后再改同步发现方式。
- HTTP ETag/Last-Modified 只用于判断远端是否变化，不代表远端身份认证；MMD 镜像仍通过 HTTP 提供。
- 进程中断会留下隐藏临时目录；未完整安装的当前文件会在下次运行时重新下载，已经原子安装并记录状态的文件会复用。

## 预计工时

约 1.5 小时。

## 执行结果

- 已实现父目录参数映射：`/mnt/` 下的 `aasc-offline/` 同步至本地 `aasc-offline/`，`mmd/` 递归同步至本地同级 `mmd/`；传统直接 `/aasc-offline/` 参数仍走旧的 Offline 单目录模式。
- MMD 文件限制在同源根路径，读取 HEAD 元数据，流式下载并按字节数校验后原子安装；状态文件记录 ETag、Last-Modified、大小和 SHA-256，匹配时显示 `[已复用]` 并跳过 GET；本地多余文件保留。
- 更新了 Offline 热更 design/spec、usage 和本任务文档；todo 无对应待处理条目，未新增完成项。
- `node --check scripts/ops/sync-offline-update.js` 与 `git diff --check` 通过；未运行自动化测试、资源同步或 Offline APK/服务包/依赖包构建。
