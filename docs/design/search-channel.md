# 搜索频道与独立 Pi 搜索进程设计

## 需求概述

搜索命令需要与群聊消息解耦。控制端提供独立搜索频道，显示搜索开始、进行中、完成和失败状态，并显示可管理的搜索历史；搜索内容和结果不写入群聊历史。

当搜索通过 LLM/Pi/Codex Agent 处理时，每次搜索使用临时、独立的 Agent 进程。该进程只接收当前搜索请求，不继承群聊或私聊 Agent 的内存上下文；请求结束、失败或超时后立即回收进程。

## 数据流

```text
搜索命令
    ├─ 立即广播 searchChannel(start)
    ├─ 立即播报“正在搜索${内容}”
    └─ 路由
        ├─ system → 内置搜索 → 记录 search-history.json → searchChannel(results)
        └─ llm + Pi → 临时 Pi 进程 → searchChannel(chunk/result)
                         └─ 完成后回收 Pi 进程
```

搜索频道消息只供控制端展示，不调用普通聊天 UI 的 `chatInput`、`chatChunk` 或 `chatResponse`，也不追加聊天历史。

## 控制端展示

- 搜索频道独立于群聊面板，具有搜索输入、当前搜索状态和历史列表。
- WebSocket 收到 `searchChannel` 后，按 requestId 更新对应记录。
- `searchHistory` 继续作为持久化历史同步消息；收到后必须刷新搜索频道，不依赖聊天面板刷新。
- 结果、错误和搜索中状态均使用转义后的文本渲染。

## 系统搜索结果选择

- 系统搜索从 Bing 的前十条真实网页结果中选取候选，不再直接使用第一条结果。
- 优先读取结果摘要中的绝对日期（如 `2026年8月21日`、`Aug 21, 2026`），其次解析 Bing 的相对日期（如 `1天前`、`1 day ago`）。
- 有可解析日期的候选按时间从新到旧排序；无日期候选排在有日期候选之后；全部无日期时保持 Bing 原顺序。
- 任务返回排序后的前五条结果；搜索频道、历史和弹窗展示五条，TTS 播报前三条。
- 任务统一返回 `data.result` 数组，每条结果继续沿用 `first_result` 字段结构；不再新增 `data.results` 字段。

## 单次内置任务

- 系统搜索实现为注册的 `search.web` 内置任务，模式为 `one-shot`，支持语音流程和控制端任务列表手动调用。
- 任务只负责使用 Axios 请求 Bing、解析前十条真实结果、按时间排序并返回前五条结果。
- 任务不负责 TTS、搜索频道、搜索历史、聊天或 Pi 会话；这些由调用方按既有流程处理。
- `fetchLimit`、`displayLimit` 和 `ttsLimit` 通过任务级全局配置保存，不要求创建任务实例；默认值为 10、5、3。
- 手动调用通过任务引擎标准 `task:result` 返回结果；语音调用继续复用现有搜索频道、历史和 TTS。

## 生命周期与资源

- 系统搜索不启动 Pi 进程。
- LLM/Pi 搜索使用唯一临时 conversation key 或显式 ephemeral 选项创建新进程。
- Pi 请求成功、失败、RPC 错误、超时和客户端断开后均关闭临时进程并从 Runtime 会话表移除。
- Pi 使用 `--no-session`，不会将搜索会话写入持久化 session 文件。
- 不清理既有群聊或私聊历史；搜索本身不产生这些历史。

## 兼容性

- 保留 `getSearchHistory`、`clearSearchHistory`、`deleteSearchHistory` 和 `searchHistory` 协议。
- 保留系统搜索的 Bing 解析和搜索结果弹窗。
- 普通群聊、私聊及其 Pi 会话键不变。
