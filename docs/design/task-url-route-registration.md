# 任务 URL 路由注册设计

## 目标

为任务引擎提供受控的 URL 路由注册能力。任务不自行监听端口，而是把路由挂载到 AASC 主服务当前端口；默认端口继续为 `8081`。路由可以由服务端任务直接处理，也可以由显示端任务通过现有 WebSocket 请求/响应协议处理。

## 范围

- 支持服务端任务注册 HTTP 路由。
- 支持显示端和子显示端服务任务注册 HTTP 路由。
- HTTP 请求仍由任务所在 AASC 服务的 Express 进程接收。
- 显示端不监听新的 TCP 端口，只通过显示端 WebSocket 收发任务请求。
- 路由按 `method + path` 唯一，同一个 AASC 服务内不允许不同实例抢占同一路由。
- 不新增独立 HTTP 配置读取/保存接口，不改变已有远端配置流程。

## 路由 API

任务服务上下文提供：

```text
await context.registerRoute({
  method: 'POST',
  path: '/example',
  handler: async ({ request, response, taskName, instanceId, params }) => {
    response.json({ ok: true, value: request.body });
  }
});
```

`request` 只包含可序列化数据：`method`、`path`、`query`、`headers`、`body`。`response` 提供 `status()`、`setHeader()`、`json()`、`send()`、`write()`、`end()` 和 `flushHeaders()`，任务不直接接触 Express 全局应用对象。

注册成功返回注销函数。任务停止、重启、启动失败、显示端断开和 TaskManager 销毁时，任务引擎都会清理实例拥有的路由。

## 请求流转

```text
外部 HTTP 客户端
      │ :8081
      ▼
Express 动态路由中间件
      │
      ├─ server 任务：直接调用任务 handler
      │
      └─ display/subdisplay 任务：task:route_request
                                  │
                                  ▼
                          显示端任务 handler
                                  │
                          task:route_response
                                  ▼
                              HTTP 响应
```

显示端注册路由时发送 `task:route_register`，服务端校验实例、目标显示端和路由冲突后返回 `task:route_registered`。请求使用独立 `requestId`，响应支持 headers、chunk、end 和 error 事件，以保留流式 HTTP 的扩展能力。

## 生命周期与异常

- 路由注册必须绑定 `taskName + instanceId`，不能成为全局匿名路由。
- 服务重启恢复时，任务重新执行并重新注册路由。
- 显示端断开时，相关路由立即注销，正在等待的请求返回 `503`。
- 显示端请求超过任务路由超时时间时返回 `504`，并发送取消消息。
- 路径只允许绝对路径，不允许 query、路径遍历和空路径；方法统一转为大写并限制在 HTTP 常用方法集合内。
- 路由处理器抛错时返回结构化 `500`，不得让 Express 进程产生未处理 Promise 拒绝。

## 本地 LLM 网关

`llm-server` 使用任务路由注册 `/v1/models`、`/v1/chat/completions`、`/v1/responses` 和 `/v1/chat/responses`。服务端目标时直接复用现有 LLM 网关处理器；显示端目标时，路由请求经 WebSocket 到达显示端任务，实际模型推理仍由显示端本地模型能力完成。

每台运行 AASC 的设备使用自己的 `8081` 端口。同一路径在不同设备之间不冲突；同一设备内重复运行会被任务路由注册器拒绝或由服务作用域先停止旧实例。

## 非目标

- 不为单个任务新增 `listen()` 或独立端口。
- 不在本次改动中实现多设备统一负载均衡。
- 不修改显示端现有媒体、ASR、TTS 和 LLM 普通 WebSocket 消息语义。
