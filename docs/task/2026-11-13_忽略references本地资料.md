# 忽略 references 本地资料

任务：所有 references 目录暂不上传，已跟踪游戏参考资料退出索引，保留工作区文件。
设计与伪代码：分别见 `docs/design/subprojects-hie.md`、`docs/spec/subprojects-hie.md`。
影响：`.gitignore`、游戏参考文件索引；脚本与测试仍从本地 references 读取。
自测：检查忽略匹配、已跟踪文件计数及本地代表文件；兼容性：新克隆不含模板，需要本地同步；性能：不影响运行时。
风险：远端历史中已有文件，不能仅靠忽略规则删除；本次不改写远端历史。预计工时：30 分钟。
