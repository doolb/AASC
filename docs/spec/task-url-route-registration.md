# 任务 URL 路由注册实现规格

## 核心对象

```text
TaskRouteRegistry:
  routes: Map<method + path, RouteEntry>
  pendingRequests: Map<requestId, PendingRequest>

RouteEntry:
  routeId
  taskName
  instanceId
  method
  path
  target: 'server' | 'display'
  displayId
  params
  handler                 # server 任务存在，display 任务为空
```

## 路由注册伪代码

```text
normalizeRoute(route):
  method = uppercase(route.method)
  path = trim(route.path)
  require method 在 GET/POST/PUT/PATCH/DELETE/OPTIONS 集合中
  require path 以 '/' 开头且不包含 '?'、'..'
  require path 长度不超过 512
  return { method, path }

registerServerRoute(taskInfo, route):
  normalized = normalizeRoute(route)
  require route.handler 是函数
  key = normalized.method + ' ' + normalized.path
  require routes[key] 不存在
  entry = { ...taskInfo, ...normalized, target: 'server', handler: route.handler }
  routes[key] = entry
  registrations[taskInfo.instanceId].add(key)
  return () => unregister(key, taskInfo.instanceId)

registerDisplayRoute(taskInfo, route):
  normalized = normalizeRoute(route)
  key = normalized.method + ' ' + normalized.path
  require routes[key] 不存在
  entry = { ...taskInfo, ...normalized, target: 'display', handler: null }
  routes[key] = entry
  registrations[taskInfo.instanceId].add(key)
  return entry.routeId
```

## HTTP 请求伪代码

```text
handleRequest(req, res, next):
  key = uppercase(req.method) + ' ' + req.path
  route = routes[key]
  if route 不存在:
    return false

  request = {
    method: req.method,
    path: req.path,
    query: plainObject(req.query),
    headers: plainObject(req.headers),
    body: req.body
  }

  if route.target == 'server':
    response = createExpressResponseAdapter(res)
    await route.handler({ request, response, taskName, instanceId, params })
    if response 未结束且 handler 返回值存在:
      response.json(返回值)
    return true

  requestId = generateRequestId()
  pendingRequests[requestId] = { res, route, timer }
  sendToDisplay(route.displayId, {
    type: 'task:route_request',
    payload: { routeId, requestId, taskName, instanceId, request }
  })
  if 发送失败:
    rejectPending(requestId, 503, '目标显示端不在线')
  return true
```

## 显示端 WebSocket 伪代码

```text
displayContext.registerRoute(route):
  routeId = generateLocalRouteId(instanceId)
  localRoutes[routeId] = route.handler
  send({
    type: 'task:route_register',
    payload: { taskName, instanceId, routeId, method, path }
  })
  wait task:route_registered
  return async unregister():
    delete localRoutes[routeId]
    send({ type: 'task:route_unregister', payload: { instanceId, routeId } })

on task:route_request(payload):
  route = localRoutes[payload.routeId]
  response = createWebSocketResponse(payload.requestId, payload.routeId)
  try:
    result = await route({ request: payload.request, response, taskName, instanceId })
    if response 未结束:
      response.json(result) 或 response.end()
  catch error:
    response.error(error)
```

## TaskManager 生命周期伪代码

```text
runInstance(taskName, instanceId):
  从实例索引恢复 task
  if task.mode == 'service' 且 target == 'server':
    context.registerRoute = route => registerServerRoute(task, route)
    run service
  if task.mode == 'service' 且 target == 'display/subdisplay':
    task:execute 携带 mode=service
    显示端 context 提供 registerRoute

stopInstance(taskName, instanceId):
  调用服务 stop
  routeRegistry.unregisterInstance(instanceId)
  向显示端发送 task:stop
  持久化 stopped

handleDisplayDisconnect(displayId):
  routeRegistry.rejectDisplayRequests(displayId, 503)
  routeRegistry.unregisterDisplayRoutes(displayId)
  按既有规则把显示端服务标记为 display_offline
```

## 消息类型

| 消息 | 方向 | 作用 |
|------|------|------|
| `task:route_register` | 显示端 → 服务端 | 注册显示端任务路由 |
| `task:route_registered` | 服务端 → 显示端 | 返回注册结果 |
| `task:route_unregister` | 显示端 → 服务端 | 注销显示端任务路由 |
| `task:route_request` | 服务端 → 显示端 | 转发 HTTP 请求 |
| `task:route_response` | 显示端 → 服务端 | 返回 headers/chunk/end/error |
| `task:route_cancel` | 服务端 → 显示端 | HTTP 客户端断开或超时 |

所有消息都包含 `type`，请求和响应包含 `requestId`，路由注册包含 `routeId` 和 `instanceId`。
