# 关卡任务桥接伪代码

已有声明 := NavigationGapQueue.report、AutonomyCoordinator、CommandExecutor、猪关卡自动脚本
新增定义 := GameTaskBridge {脚本路径, 工作目录, 显式启用, 进程启动器}; GameTaskSnapshot {observation, plans, feedback, gaps, evidence}
读取任务目录 → 读取 level.json、plan.json、result.json（缺失表示未产生）→ 校验 JSON 对象 → 复制初始布局、计划和反馈 → 若结果为卡关或中断则生成包含原因与证据路径的 NavigationGap → 输出快照
显式启用且参数合法 → 以参数数组启动 Python 脚本 → 等待退出 → 返回退出码及输出；未启用直接拒绝
桥接层不点击设备，不自动发布导航包；现有脚本负责动作和逐步验证。

关卡快照 + 现有世界状态 → 合并 gameTask 观察 → 将本次 gaps 传给 AutonomyCoordinator.decide → 返回快照与分层决策；调用方自行决定后续动作，重复读取不自动累计上报。
