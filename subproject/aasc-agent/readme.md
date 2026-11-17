# AASC Agent

第一阶段提供独立命令解析、角色授权、模型决策和专用角色委派接口。运行 `npm test` 自测，`npm start` 打开聊天界面；`npm run parse` 是内部命令的开发调试工具。内部命令默认格式为 `[游戏,"今天先完成日常任务"]`，使用 CSV 双引号转义；调用 `parseCommand(text, { requireBrackets: false })` 可显式允许省略方括号。

模型通过 `decide({role, task, args})` 返回能力请求；宿主注册角色及其权限、模型和能力。`createHieTool` 接受具有 `execute` 的适配器。现已支持 OpenAI Responses 兼容模型；本地能力由宿主按需注入，默认无需 HIE。当前没有真实 HIE、网页、Codex 或 Claude 工具接入，也没有操作系统级隔离或跨进程会话持久化。

## 终端界面与模型配置

使用 Node.js 18 或更高版本。在本目录运行 `npm start`，直接输入自然语言；`/role` 查看角色，`/role 游戏` 切换，`/role --default` 恢复主助手，`/new` 开始当前角色的新会话，`/help` 查看帮助，`/exit` 或 Ctrl+D 退出。角色各自保存进程内续接点；`/new` 和进程退出不删除服务端或 Gemini 网页对话。

默认读取本目录 `config.json`。若尚未配置，可复制 `config.example.json`，在 `api.baseUrl`、`api.apiKey` 和 `api.model` 中填写服务地址、密钥和模型名；也可用 `AASC_AGENT_CONFIG` 指定配置路径。示例指向 `http://127.0.0.1:5918/v1`，使用 OpenAI Responses 兼容接口。`config.json` 被 Git 忽略，切勿将真实密钥填入示例文件。配置中 `roles` 包含主助手和游戏专用角色的人设，`defaultRole` 指定默认角色；可按需调整。

默认 `commandRoles` 和角色 `permissions` 为空，只使用模型聊天，不依赖 HIE。确需本地操作时，由可信宿主注入工具并在配置中明确授权；未注入的能力不会被模拟执行。模型适配器可以返回普通文本，也可显式返回 `{ text, commands: ['[角色,"任务"]'] }`；人输入的方括号和普通回复中的方括号不会直接执行。本地工具结果反馈给模型继续处理。

`npm start -- --demo` 是无网络的本地回显演示。`AASC_AGENT_MODULE` 可覆盖默认配置入口，加载本地可信宿主模块，模块导出 `createAgent()` 或默认 Agent 实例；Agent 须实现 `chat(text, { role, onEvent })`，支持 `/role` 时还须提供 `listRoles()`，支持 `/new` 时须提供 `resetChat()`。旧的内部命令解析工具可通过 `npm run parse` 使用。

如果模型续接失败，界面会要求使用 `/new` 明确开始新会话，不会悄悄丢弃上下文或重发。长任务顺序执行，Ctrl+C 关闭界面输入，但不会强行取消已提交的外部任务。
