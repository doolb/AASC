# AASC Agent

第一阶段提供独立命令解析、角色授权、模型决策和专用角色委派接口。运行 `npm test` 自测，`npm start` 可输入一条命令查看解析结果。默认格式为 `[游戏,"今天先完成日常任务"]`，使用 CSV 双引号转义；调用 `parseCommand(text, { requireBrackets: false })` 可显式允许省略方括号。

模型通过 `decide({role, task, args})` 返回能力请求；宿主注册角色及其权限、模型和能力。`createHieTool` 接受具有 `execute` 的适配器。示例和测试使用模拟对象，当前没有真实 HIE、网页、Responses、Codex 或 Claude 接入，也没有操作系统级隔离或持久化。
