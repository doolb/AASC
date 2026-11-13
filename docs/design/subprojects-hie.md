# HIE 子工程与游戏任务桥接

HIE、retop 和 remote-gamepad 的实际目录分别位于 `subproject/aasc-hie`、`subproject/retop` 和 `subproject/remote-gamepad`。三个子工程及 aasc-game 使用 AASC 主仓库；原 HIE 与 retop 的本地 Git 元数据移出子工程工作树，旧历史不要求合并。模型、运行数据和重建产物按忽略规则留在本地。旧 HIE 和 retop 路径通过链接兼容。

HIE 提供游戏任务桥接，读取 aasc-game 关卡识别、计划、结果并可上报卡关；真实运行必须显式启用。脚本仍负责 X11 输入与逐步验证。当前需要调用方主动读取快照，不声称已经实现自动排障。详见子工程 `docs/design/game-task-bridge.md`。

自动测试依赖的固定截图与布局样本纳入仓库，其他关卡运行记录仍保存在本机；测试样本的例外不包含日志、模型、安装包或构建产物。
