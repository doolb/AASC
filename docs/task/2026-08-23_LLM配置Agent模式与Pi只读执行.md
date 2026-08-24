# LLM 配置 Agent 模式与 Pi 只读执行

## 任务描述

为普通聊天的每个 LLM profile 增加 Agent 调用模式。Agent 模式暂支持 Pi，由服务器直接管理 Pi RPC 子进程，复用 profile 的 LLM 服务器配置，并只允许文件读取/搜索和受限网络查询。

## design 需求

- 设计文档：`docs/design/llm-agent-mode.md`
- 每个 profile 独立选择 `llm` 或 `agent`。
- Agent 只支持 Pi；权限绑定聊天模板/角色，当前只读策略不能修改文件或执行 shell。
- 权限策略由控制端设置，本次不实现管理员接口和用户身份鉴权；服务器只校验策略枚举并映射固定工具白名单。
- 当前 profile 的聊天历史会传给 Agent，profile 之间历史隔离。
- 服务器负责 Pi 启停、串行请求和异常回收。

## spec 设计

- 实现文档：`docs/spec/llm-agent-mode.md`
- 在 `llm-service` 的 `chatStream` 中按 profile.mode 分流。
- 新增通用 `PiRuntimeManager` 和只读 Pi 扩展，聊天作为第一个调用方。
- 通过 Pi RPC JSONL 解析流式文本并复用现有 TTS/聊天回包。

## 受影响的功能模块和代码

- `src/external/llm/llm-service.js`
- `src/apps/server/modules/chat/pi-readonly-tools.js`
- `src/apps/server/boot/server-app.js`
- `src/apps/web-mediacenter/ui/public/js/chat.js`
- `src/apps/web-mediacenter/ui/public/upload.html`
- `src/apps/server/modules/config/config-app-service.js`
- `src/apps/server/modules/chat/pi-runtime-manager.js`（替代聊天专用的 Pi 管理器命名）
- `config/config.json`（仅在默认配置需要同步时修改）

## 自测用例

- 旧 profile 无 mode 时仍走普通 LLM。
- Agent profile 使用 Pi RPC，不调用普通 LLM 请求函数。
- 每个 profile 的 API URL、模型、Key、会话和历史隔离。
- Pi RPC 文本增量可转为现有 chatChunk/chatResponse。
- Pi 只启用 read/grep/find/ls 和只读网络工具。
- 模板权限设置可持久化，权限变更不会复用旧 Pi session。
- Pi 启动参数不包含 bash/edit/write，路径穿越和非 HTTP URL 被拒绝。
- Pi 退出/超时后当前请求失败，下一次请求可重启。
- 服务器退出回收所有 Pi 子进程。

## 兼容性测试

- 现有普通 LLM 群聊、私聊、模板、TTS、requestId 流式回包。
- 旧 config.json 和旧 chat-history.json。
- Pi 不存在或 API 服务不可用时的错误显示。
- Node.js 当前版本和无真实 Pi 的测试环境。

## 性能测试

- profile 首次启动耗时和首次响应耗时。
- 连续多轮 Agent 请求的串行吞吐和内存增长。
- 大文件搜索和大网页响应的大小限制。
- 多 profile 同时运行时的进程数和资源占用。

## 风险评估

- Pi CLI 版本和 RPC 事件格式变化：通过 fake Pi 进程锁定协议测试，并在真实 Pi 环境做一次手工验证。
- OpenAI 兼容接口的 base URL 差异：统一规范化 `/v1/chat/completions` 为 provider base URL。
- 只读工具误开放写能力：启动参数使用固定白名单，扩展不注册 shell/写文件工具，并增加静态断言。
- 旧历史缺少 profile 字段：首次加载归属启动时 active profile，保留旧用户可见记录。
- 服务器重启导致内存 Agent 会话丢失：聊天历史仍持久化，下一次启动使用历史重建上下文。

## 预计工时

- 文档与协议：0.5 小时
- Pi 管理器与只读工具：2 小时
- LLM 分流、历史隔离与服务器生命周期：2 小时
- 控制端配置 UI：1 小时
- 测试与兼容性验证：2 小时

## 执行结果

- ✅已完成 [2026-08-23][2026-08-23]
  - 新增 profile 策略规范化、Pi RPC Runtime、固定只读网络扩展和聊天 Agent 分流。
  - 新增控制端 profile 模式选择、模板 readonly 权限选择和模板编辑保存。
  - 普通内置命令保持确定性优先；未识别聊天继续进入当前 profile 的 LLM/Pi 路由。
  - 实际变更文件：`src/apps/server/modules/chat/pi-runtime-policy.js`、`src/apps/server/modules/chat/pi-runtime-manager.js`、`src/apps/server/modules/chat/pi-readonly-tools.js`、`src/apps/server/modules/chat/pi-readonly-tools.mjs`、`src/external/llm/llm-service.js`、`src/apps/server/boot/server-app.js`、`src/apps/server/modules/config/config-app-service.js`、`config/config.json`、控制端 UI、相关测试和设计/spec 文档。
  - 自测：策略、只读网络、Pi RPC、Agent 路由、UI、LLM、TTS、requestId 回归通过。
  - 真实 Pi 验证：服务器实际启动 `/home/as/.local/bin/pi --mode rpc`，加载只读扩展并通过本地模拟 OpenAI 流式接口收到增量文本，`PiRuntimeManager` 回调链路通过。
  - 完整测试：227 项中 224 项通过；3 项失败均为既有模块测试（Claude 超时重建、WSViewBind 未知消息、native bridge 触摸注入），不涉及本次改动。
