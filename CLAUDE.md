# 项目规则

## 文档规范

| 文件 | 说明 |
|------|------|
| docs/design.md | 项目设计文档索引 |
| docs/design/*.md | 每个功能模块的设计文档 |
| docs/spec.md | 项目实现文档索引 |
| docs/spec/*.md | 每个功能模块的实现文档，使用伪代码描述，和实际代码同步更新 |
| docs/todo.md | 项目未完成任务列表 |
| docs/usage.md | 项目使用说明 |
| docs/rules.md | 代码规范、文件结构、命名约定 |
| docs/ref.md | 外部资源参考（API文档、库文档等） |
| changelog.md | 项目变更日志 （新需求、修复问题、优化性能等） |
| readme.md | 项目介绍、安装说明、使用说明 |
| docs/task/*.md | 任务执行文档, 名字为“时间_简要需求描述.md”  |

## 代码规范

1. 使用 `const/let`，不使用 `var`
2. 异步操作使用 `async/await`
3. 错误处理使用 `try-catch`
4. 避免全局变量污染
5. DOM 操作尽量批量处理
6. 注释要中文，要详细

## 注意事项

1. 修改代码前必须先将改动方案告知用户（涉及哪些文件、改什么、怎么改），等待用户确认后才能开始写代码
2. 每次对话完成后一定要更新 `todo.md` 和对应的 `design` 文档 以及 `spec` 文档 以及 `changelog.md` 文档
   - 例外：纯构建、发布或资源同步操作，且不包含代码、功能逻辑或配置规则变更时，只更新 `changelog.md`；不新增或更新 `design`、`spec`、`task`，也不修改 `todo.md`。
3. 已完成的功能从 `todo.md` 删除，记录到 `changelog.md`，不需要记录到 `todo.md` 里
4. 更新代码前，先更新 `docs/spec/*.md` 中的伪代码描述，如果没有对应的文件，就创建一个
5. spec里面一定使用伪代码描述，和实际代码同步更新
6. 更多详细规则在 `docs/rules.md` 中
7. 开发一定要遵守 `AASC` 规则， 不要产生一大段if-else-else if 语句

## AI 执行边界

1. AI 修改代码后如果需要重启或重载服务器，只能通过控制端提供的重启/重载接口或控制端操作完成。
2. AI 不得直接控制服务器进程，包括执行 `kill`、`pkill`、`killall`、发送终止信号、查找并操作服务器 PID，或直接启动、停止、重启 `server-app.js` 等命令。
3. 服务器当前由用户手动启动时，AI 不得擅自终止、替换或接管该进程；如控制端接口不可用，应向用户报告并等待处理。
4. 该限制适用于工作 AI、workgroup 子 agent 和控制端 AI 角色；普通代码修改、测试和静态检查仍按任务需要执行。

## Offline APK 打包与发布规则

1. `build:apk:offline` 使用 `release/apkbuild/allserver` 打包完整 Offline APK；`build:apk:offline:min` 使用 `release/apkbuild/allserver-min` 打包 update-only min APK。`release/config`、`release/userconfig`、`release/task` 是打包输入种子，首次启动恢复预先定义的任务和 results，不在 `app.json` 额外硬编码 tasks。
2. 常规修改默认只生成并发布服务 code/dependencies 与 update-only min APK；只有用户明确要求完整包时，才执行 full APK 构建和发布。
3. Offline 发布资源分为完整 APK、min APK、代码包和生产依赖包。完整 APK 使用 `apk/aasc-display-offline-v<versionCode>.apk`，不写入服务更新 `manifest.json`；min APK 使用 `apk/aasc-display-offline-min-v<versionCode>.apk`；服务包使用 `code/code-v<version>.zip` 和 `dependencies/dependencies-v<version>.zip`。
4. 发布顺序固定为：校验文件大小/SHA-256/签名与 profile → 上传版本化文件 → 原子替换服务 `manifest.json`（完整 APK 不替换清单）→ 验证 LAN/WAN → 精确清理旧版本。
5. 清理只允许删除当前发布根目录下、名称严格匹配数字版本的普通文件：`code-v*.zip`、`dependencies-v*.zip`、`aasc-display-offline-min-v*.apk`、`aasc-display-offline-v*.apk`。服务清单引用的 code/dependencies/min 必须保留；完整 APK 发布时保留本次 versionCode。禁止删除或跟随符号链接，禁止触碰 logs、models、config、task、results、非版本文件和临时文件。
6. 局域网 `/mnt/aasc-offline` 与外网 `as@120.79.245.103:~/a/aasc-offline` 独立执行发布和清理；远端命令必须显式使用 `/bin/sh -c`，不能依赖登录 shell。
7. 清理失败不回滚已经校验并切换的发布，必须报告可重试错误；不得用 `git clean`、递归删除工作区或手工删除未经过精确规则确认的资源。
8. 默认不把日志、模型、APK、ZIP、构建中间文件提交到 Git；只有用户明确要求提交发布资源时才提交，并先检查目标与大小。

## 任务记录格式

```
# 大模块
## 小模块
 - ✅已完成 [添加时间][完成时间] 任务描述
   - 改动的文件名，资源命名规则等
 - ✅已完成 [发现时间][修复时间] Bug 修复描述
```

## 对话注意事项

- 可以从 `docs/spec/*.md` 查看项目实现文档
- 一定要将变更记录到 `changelog.md` 中，以及 `spec` 文档
- 如果是新功能，一定要对应的 `design` 文档，记录功能需求描述，然后生成task文档
- 执行完后在已完成任务添加 ✅已完成 标记，记录改动文件，然后从 `todo.md` 删除该任务
- 然后更新自测模块的代码和文档，确保功能正常

## Task 文档规范
- 分析需求写入design文档，
- 根据design文档，更新spec文档
- 写入执行任务到task目录里，名字为“时间_简要需求描述.md” (包含任务描述、design需求、spec设计，受影响的功能模块和代码，自测用例，兼容性测试，性能测试，风险评估，预计工时)
- 不明确的需求，在task文档里记录下，等任务完成后再确认
- 根据task实现功能模块的代码
- 把任务从todo文档中移除，更新todo文档
- 更新design文档，描述已完成的功能模块
- 把任务记录到changelog.md
