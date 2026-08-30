# Chat2API 核心内置任务设计

## 需求概述

将 Chat2API 的 Provider、OAuth、账号、API Key、负载均衡和 OpenAI 兼容代理能力移植到 AASC，封装为 AASC 的常驻内置任务 `chat2api.proxy`。运行时不读取 `/mnt/Chat2API`，不启动 Electron，也不依赖独立 Chat2API 进程。

## 范围与边界

### 本次范围

- 内置常驻任务：启动、停止、重启和状态展示。
- OpenAI 兼容接口：`/v1/chat/completions`、`/v1/models`、`/v1/completions`。
- Chat2API 当前 Provider：DeepSeek、GLM、Kimi、Mimo、MiniMax、Perplexity、Qwen、Qwen AI、Z.ai。
- Provider 配置、账号凭据、账号状态和多账号负载均衡。
- OAuth 登录流程及登录状态回调。
- API Key 创建、启用、禁用、删除和请求鉴权。
- 流式 SSE、非流式响应、模型映射、失败切换和请求统计。
- AASC 控制端任务面板配置，不移植 Chat2API Electron/React 界面。

### 不在范围

- 不保留 Electron 主进程、窗口、托盘、IPC 和独立 React 应用。
- 不依赖 `/mnt/Chat2API` 的源码路径、`node_modules` 或运行进程。
- 不把 Chat2API 的日志文件、构建产物和桌面更新器带入 AASC。
- 不改变 AASC 现有 LLM profile、Pi Agent 和统一 TTS 的默认行为。

## 上游同步策略

```text
3rd/chat2api-core/       上游核心源码快照，仅保留 GPL 相关文件和核心模块
src/apps/server/modules/chat2api/  AASC 适配层、配置桥接、生命周期和管理接口
src/apps/server/modules/task-engine/builtin-tasks/chat2api-proxy.js  内置任务入口
src/apps/web-mediacenter/ui/public/js/chat2api.js  控制端面板逻辑
```

- `3rd/chat2api-core` 保存上游版本号、上游 commit 和许可证说明。
- 上游来源文件原则上不直接改动；AASC 差异放在适配层或独立补丁中。
- 同步上游后先运行核心协议、Provider、OAuth、流式响应和任务生命周期测试，再更新适配层。
- Chat2API GPL-3.0 许可证和版权声明随移植代码保留；发布包提供对应源代码和修改说明。

## 系统架构

```text
控制端任务面板
    ↓ task:start / widget action
AASC TaskManager
    ↓ builtin task mode=service
Chat2APIProxyService
    ├─ OpenAI compatible routes
    ├─ API key middleware
    ├─ Provider registry + account store
    ├─ OAuth manager + callback session
    ├─ Load balancer + model mapper
    └─ stream/response adapters
         ↓
    DeepSeek / GLM / Kimi / Mimo / MiniMax / Perplexity / Qwen / Z.ai
```

内置任务启动独立的代理 HTTP Server，默认监听 `127.0.0.1:8080`，端口和监听地址可配置，避免占用 AASC 主服务端口。任务停止时关闭代理、OAuth 临时回调和活动连接，并清理内存中的敏感状态。

## 配置与数据

```text
~/.config/aasc-user/chat2api/
    config.json       代理地址、端口、超时、负载均衡和 API Key 开关
    providers.json    Provider 定义和模型映射
    accounts.json     账号凭据、启用状态和健康状态
    api-keys.json     AASC 代理访问密钥
    oauth-sessions/   临时 OAuth 状态，完成或超时后删除
```

- 凭据文件创建目录后设置用户私有权限，日志和控制端响应不得输出完整 Token、Cookie 或 API Key。
- 支持导入 Chat2API 导出的 Provider/账号数据；导入采用预览、确认、写入三步，失败不覆盖原数据。
- 旧 AASC LLM 配置继续有效；Chat2API 代理作为独立服务，不自动替换当前 profile。

## 控制端设计

任务卡片显示运行状态、监听地址、活动连接、请求统计和当前 Provider/账号使用情况，并提供：

- 代理启动/停止、端口和 API Key 开关。
- Provider 列表、模型映射和账号启用/禁用。
- OAuth 登录、回调状态和账号刷新。
- API Key 创建、复制、禁用和删除。
- 上游版本、数据导入和健康检查入口。

敏感凭据只允许写入专用表单，列表只显示脱敏值；控制端不把完整凭据写入普通任务参数或任务日志。

## 错误处理与安全

- 端口占用、Provider 配置错误、OAuth 超时、上游鉴权失败和流式协议错误分别返回可定位错误。
- 单个账号失败进入冷却或故障转移，不影响同 Provider 其他账号和其他 Provider。
- 代理未启动时管理接口可读取配置，但聊天接口返回明确的服务未运行错误。
- OAuth 回调使用一次性 state、过期时间和 Provider 绑定，禁止跨 Provider 串用。
- API Key 比对使用恒定时间比较；管理接口使用独立管理鉴权，不复用代理访问密钥。
- 服务停止和 AASC 重启时关闭所有监听器、SSE 流和 OAuth 回调，避免残留端口和敏感数据。

## 验收标准

- AASC 不启动 `/mnt/Chat2API`，单独启动 `chat2api.proxy` 即可提供代理服务。
- 非流式和流式 `/v1/chat/completions` 均能返回标准 OpenAI 格式。
- Provider、账号、模型映射、API Key 和 OAuth 管理可从 AASC 控制端完成。
- 多账号轮询、故障转移和请求统计有效。
- 停止任务后端口释放，重新启动不会重复注册路由或 OAuth 回调。
- 上游同步后，适配层回归测试能发现协议、字段和 Provider 行为变化。
