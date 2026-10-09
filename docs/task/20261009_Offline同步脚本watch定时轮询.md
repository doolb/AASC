# Offline 同步脚本 watch 定时轮询

## 任务描述

为 `npm run sync:offline-update` 增加可选 watch 模式：间隔以正整数分钟指定，省略时默认 10 分钟；启动后立即执行同步；每轮结束后等待完整间隔再串行执行下一轮；单轮失败记录错误后继续；Ctrl+C 停止 watch；不带 `--watch` 时保留单次同步行为。

## Design 需求

- 参数形式：`--watch [--interval-minutes <正整数>]`；省略间隔时默认 10 分钟。
- 间隔计时从每轮完成后开始，不累计同步耗时；任意时刻至多有一轮同步在运行。
- Ctrl+C 时，等待阶段立即结束；同步阶段让本轮收尾后退出，不再启动下一轮。
- watch 轮次错误不阻止后续轮次；一次性调用仍维持原有错误退出码语义。
- 仅修改 Node CLI，不改变 Android 更新端及同步数据/资源校验语义。

## Spec 设计

`docs/spec/android-offline-hot-update.md` 中 `parseCliArguments` 对显式间隔校验正整数和重复参数；`--watch` 未指定间隔时归一化为 10 分钟，单独传 interval 仍拒绝。`runCli` 在 watch 模式循环调用单轮同步，首轮立即开始，捕获单轮错误后按间隔等待，SIGINT 结束等待或在当前轮结束后安全退出。非 watch 路径保持单次调用。

## 受影响模块和文件

- `scripts/ops/sync-offline-update.js`：CLI 参数、watch 循环、可中断等待和 SIGINT 清理。
- `tests/offline-update-sync.test.js`：参数、轮次时序、串行、失败继续、停止行为回归。
- `docs/design/android-offline-hot-update.md`、`docs/spec/android-offline-hot-update.md`：设计与伪代码。
- `docs/usage.md`：watch 参数与运行说明。
- `docs/task/20261009_Offline同步脚本watch定时轮询.md`：任务执行记录。
- `docs/todo.md`、`changelog.md`：任务状态及完成记录。

## 自测用例

1. 省略 watch 时保持单次模式；仅传 `--watch` 时默认为 10 分钟；显式正整数可设置间隔；interval 单独出现、重复参数、零、负数、小数、非数字及超安全整数均被拒绝。
2. watcher 首次同步立即开始；各轮串行；无论成功或失败，完整轮结束后才等待；等待后才开始下一轮。
3. 同步失败不设置进程退出失败状态，之后仍会进入新一轮。
4. Ctrl+C 在等待期间立即停止；Ctrl+C 在同步期间让当前轮完成并阻止后续轮次。
5. 不带 `--watch` 参数仍只运行一轮并保留既有错误处理。

## 兼容性测试

- 用现有签名清单和本地 HTTP fixture 运行 `node --test tests/offline-update-sync.test.js`。
- 检查旧参数解析、父目录/直接目录行为及同步用例不回归。
- 运行 CLI 参数/循环新增的定向测试、`node --check` 与 `git diff --check`。

## 性能测试

该功能不增加单轮同步工作量、不引入依赖；验证调度层无并发轮次，等待期间不执行忙循环。实际资源网络吞吐不作为本任务变化范围。

## 风险评估

- 清单和资源同步包含临时落盘及原子切换；Ctrl+C 不强制中断进行中的一轮，避免留下被中断的替换事务。
- interval 参数校验需拒绝 Node 定时器不支持的无效/溢出用法；长间隔等待需采用分段计时，支持正整数分钟。
- watch 的单轮失败需与单次 CLI 失败区分，避免无意改变现有退出码。

## 预计工时

约 1 小时（实现、测试和文档同步）。

## 实施结果

- `scripts/ops/sync-offline-update.js` 新增 `--watch [--interval-minutes N]` 参数验证与 watch 调度。省略间隔时默认 10 分钟，显式值为正整数分钟；首轮立即开始，各轮串行；一轮完成后再等待分钟间隔；失败记录错误后继续。Ctrl+C 中止等待，活动中的同步轮安全完成后退出，不再进入下一轮；大于 Node 单个定时器上限的间隔采用分段等待。未带 `--watch` 的单次同步仍使用原有错误退出码。
- `tests/offline-update-sync.test.js` 新增参数边界、首轮立即执行/串行与失败续跑、活动轮 Ctrl+C 和等待取消测试。
- design/spec/usage/changelog/todo 已同步；`docs/todo.md` 未遗留本功能待办。
- 参数、默认 10 分钟间隔、轮次/失败续跑/Ctrl+C 定向回归 8/8 通过，两个 Node 文件语法检查和 `git diff --check` 通过。未运行全量 `npm test`，未构建 APK 或发布 Offline 资源。
