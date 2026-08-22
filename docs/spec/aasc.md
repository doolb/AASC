# AASC 系统实现文档

## 概述

AASC（Actor-based Asynchronous Service Communication）系统的核心实现，包含消息总线、执行者模型、消息路由等核心组件。

## 模块结构

```
aasc/
├── index.js              # 入口文件，导出所有模块
├── init.js               # 系统初始化
├── message.js            # 消息协议定义
├── message-bus.js        # 消息总线核心
├── actor.js              # 执行者基类
├── actor-adapter.js      # Actor 适配器，将 Agent 包装成 Actor
├── router.js             # 消息路由和过滤
├── registry.js           # 执行者注册表
├── user.js               # 用户模型
├── record.js             # 用户记录
├── capability.js         # 能力继承
├── cluster.js            # 分布式集群
├── pipeline.js           # 能力管道执行器
├── composition.js        # 能力组合定义
├── level-calculator.js   # 能力等级计算器
├── actors/               # 具体执行者实现
│   ├── index.js
│   ├── reminder-actor.js
│   ├── chat-actor.js
│   ├── voice-command-actor.js
│   ├── media-control-actor.js
│   ├── media-library-actor.js
│   ├── display-render-actor.js
│   ├── system-command-actor.js
│   ├── private-chat-actor.js
│   ├── important-record-actor.js
│   ├── search-actor.js
│   └── tts-actor.js
├── agents/               # Agent 层实现
│   ├── index.js          # 所有 Agent 实现
│   └── base-agent.js     # Agent 基类
├── components/           # 可复用组件
│   ├── index.js
│   ├── message-parser.js     # 消息解析器
│   ├── message-dispatcher.js # 消息分发器
│   └── state-manager.js      # 状态管理器
├── middleware/           # 中间件
│   └── index.js          # 验证、日志、错误处理、限流、超时
└── system/               # 系统层
    ├── index.js
    └── websocket-system.js   # WebSocket 系统核心
```

## 消息协议 (message.js)

### 数据结构

```
Message
├── id: string              # 消息唯一标识
├── version: string         # 协议版本
├── type: MessageType       # 消息类型
├── priority: Priority      # 优先级
├── timestamp: number       # 时间戳
├── source: ActorAddress    # 发送者地址
├── target: ActorAddress    # 目标地址（可选）
├── topic: string           # 主题（可选）
├── payload: any            # 消息内容
├── ttl: number             # 生存时间
├── requiresAck: boolean    # 是否需要确认
└── correlationId: string   # 关联ID（用于响应）

ActorAddress
├── ip: string              # IP地址
├── role: string            # 角色类型
└── name: string            # 执行者名称
```

### 消息类型

| 类型 | 值 | 说明 |
|------|-----|------|
| COMMAND | 'command' | 命令消息 |
| EVENT | 'event' | 事件消息 |
| QUERY | 'query' | 查询消息 |
| RESPONSE | 'response' | 响应消息 |
| BROADCAST | 'broadcast' | 广播消息 |

### 消息主题

| 主题 | 值 | 说明 |
|------|-----|------|
| MEDIA_CONTROL | 'media.control' | 媒体控制 |
| MEDIA_STATUS | 'media.status' | 媒体状态 |
| DISPLAY_CONTROL | 'display.control' | 显示控制 |
| DISPLAY_STATUS | 'display.status' | 显示状态 |
| CHAT | 'chat' | 聊天消息 |
| REMINDER | 'reminder' | 提醒消息 |
| SYSTEM | 'system' | 系统消息 |
| VOICE | 'voice' | 语音消息 |
| USER_RECORD | 'user.record' | 用户记录 |
| ACTOR_LIFECYCLE | 'actor.lifecycle' | 执行者生命周期 |

### 使用示例

```javascript
const { Message, ActorAddress, MessageType, Priority, MessageTopic } = require('./aasc');

const source = new ActorAddress('192.168.1.100', 'control', 'mobile-app');
const target = new ActorAddress('192.168.1.200', 'display', 'living-room');

const message = new Message({
  type: MessageType.COMMAND,
  topic: MessageTopic.MEDIA_CONTROL,
  source: source,
  target: target,
  payload: { action: 'play', url: 'http://...' },
  priority: Priority.HIGH
});

const json = message.toJSON();
const restored = Message.fromJSON(json);
```

## 消息总线 (message-bus.js)

### 核心接口

```
MessageBus
├── register(actor)           # 注册执行者
├── unregister(address)       # 注销执行者
├── subscribe(topic, actor)   # 订阅主题
├── unsubscribe(topic, actor) # 取消订阅
├── publish(message)          # 发布消息
├── send(target, message)     # 发送点对点消息
├── broadcast(message)        # 广播消息
├── emit(topic, payload)      # 发送事件
├── getActors()               # 获取所有执行者
├── getActor(address)         # 获取指定执行者
├── getActorsByRole(role)     # 按角色获取执行者
├── getActorsByCapability(id) # 按能力获取执行者
├── updateHeartbeat(address)  # 更新心跳
├── checkHealth(timeout)      # 检查健康状态
└── getStats()                # 获取统计信息
```

### 全局消息总线

```javascript
const { getBus } = require('./aasc');

const bus = getBus();
```

### 使用示例

```javascript
const { getBus, Message, MessageType, MessageTopic } = require('./aasc');

const bus = getBus();

bus.register(actor);

bus.subscribe(MessageTopic.CHAT, actor);

await bus.publish(new Message({
  type: MessageType.EVENT,
  topic: MessageTopic.SYSTEM,
  payload: { event: 'startup' }
}));

const stats = bus.getStats();
console.log(`Total messages: ${stats.totalMessages}`);
```

## 执行者模型 (actor.js)

### 执行者状态

| 状态 | 值 | 说明 |
|------|-----|------|
| INITIALIZING | 'initializing' | 初始化中 |
| READY | 'ready' | 就绪 |
| BUSY | 'busy' | 忙碌 |
| DEGRADED | 'degraded' | 降级 |
| OFFLINE | 'offline' | 离线 |

### 能力分类

| 分类 | 值 | 说明 |
|------|-----|------|
| BASIC | 'basic' | 基础能力 |
| PROFESSIONAL | 'professional' | 专业能力 |
| SPECIAL | 'special' | 特殊能力 |

### Actor 类

```
Actor
├── address: ActorAddress      # 执行者地址
├── capabilities: Capability[] # 能力列表
├── subscriptions: string[]    # 订阅主题
├── status: ActorStatus        # 当前状态
├── bus: MessageBus            # 消息总线引用
├── filter: MessageFilter      # 消息过滤器
├── config: object             # 配置
└── metadata: object           # 元数据

方法
├── init()                     # 初始化
├── destroy()                  # 销毁
├── onInit()                   # 初始化回调（子类实现）
├── onDestroy()                # 销毁回调（子类实现）
├── onMessage(message)         # 消息处理入口
├── handleMessage(message)     # 消息处理（子类实现）
├── shouldProcess(message)     # 消息过滤判断
├── registerHandler(topic, fn) # 注册消息处理器
├── send(target, payload)      # 发送消息
├── publish(topic, payload)    # 发布消息
├── broadcast(payload)         # 广播消息
├── hasCapability(id)          # 检查能力
├── getCapability(id)          # 获取能力
└── getInfo()                  # 获取执行者信息
```

### 创建执行者

```javascript
const { Actor, ActorBuilder, getBus } = require('./aasc');

class MyActor extends Actor {
  async onInit() {
    this.registerHandler('chat', this.handleChat.bind(this));
  }

  async handleChat(message) {
    console.log('Received chat:', message.payload);
    return { status: 'processed' };
  }
}

const actor = new MyActor({
  ip: '192.168.1.100',
  role: 'server',
  name: 'chat-handler',
  capabilities: [
    { id: 'chat', category: 'professional', level: 3 }
  ],
  subscriptions: ['chat'],
  bus: getBus()
});

await actor.init();
```

### 使用 ActorBuilder

```javascript
const { ActorBuilder, getBus } = require('./aasc');

const actor = new ActorBuilder()
  .withAddress('192.168.1.100', 'server', 'my-actor')
  .withCapabilities([
    { id: 'basic-handler', category: 'basic', level: 1 }
  ])
  .withSubscriptions(['system'])
  .withBus(getBus())
  .build();

await actor.init();
```

## 消息路由 (router.js)

### RoutingRule

```
RoutingRule
├── topic: string        # 匹配主题
├── type: MessageType    # 匹配类型
├── source: ActorAddress # 匹配来源
├── capability: string   # 匹配能力
├── handler: string      # 目标执行者
├── priority: number     # 优先级
└── condition: function  # 自定义条件

方法
└── matches(message)     # 检查是否匹配
```

### MessageRouter

```
MessageRouter
├── rules: RoutingRule[] # 路由规则列表
└── defaultHandler       # 默认处理器

方法
├── addRule(rule)        # 添加规则
├── removeRule(index)    # 移除规则
├── setDefaultHandler(h) # 设置默认处理器
├── route(message, actors) # 路由消息
├── getRules()           # 获取规则列表
└── clearRules()         # 清空规则
```

### MessageFilter

```
MessageFilter
├── topics: string[]       # 允许的主题
├── types: MessageType[]   # 允许的类型
├── sources: ActorAddress[] # 允许的来源
├── excludeTopics          # 排除的主题
├── excludeSources         # 排除的来源
└── custom: function       # 自定义过滤函数

方法
├── test(message)          # 测试消息
├── and(filter)            # 与运算
├── or(filter)             # 或运算
└── not()                  # 非运算
```

### 使用示例

```javascript
const { MessageRouter, RoutingRule, MessageFilter, FilterBuilder } = require('./aasc');

const router = new MessageRouter();

router.addRule({
  topic: 'chat',
  handler: '192.168.1.100/server/chat-handler',
  priority: 10
});

router.addRule({
  topic: 'media.control',
  type: 'command',
  handler: { role: 'display' },
  priority: 5
});

const handlers = router.route(message, actors);

const filter = new FilterBuilder()
  .withTopics(['chat', 'system'])
  .withTypes(['event', 'command'])
  .excludeSources([{ name: 'test-actor' }])
  .build();

if (filter.test(message)) {
  console.log('Message passed filter');
}
```

## 与现有系统集成

### 初始化消息总线

在 server.js 中初始化：

```javascript
const { getBus, Actor, ActorBuilder } = require('./aasc');

const bus = getBus();

const systemActor = new ActorBuilder()
  .withAddress(getLocalIP(), 'server', 'main')
  .withCapabilities([
    { id: 'routing', category: 'special', level: 5 }
  ])
  .withBus(bus)
  .build();

await systemActor.init();
```

### 迁移现有模块

将现有模块包装为执行者：

```javascript
const { Actor, MessageTopic } = require('./aasc');

class ReminderActor extends Actor {
  async onInit() {
    this.reminder = require('../src/apps/web-mediacenter/modules/reminder/reminder-app-service');
    this.registerHandler(MessageTopic.REMINDER, this.handleReminder.bind(this));
  }

  async handleReminder(message) {
    const { action, data } = message.payload;
    switch (action) {
      case 'add':
        return this.reminder.add(data);
      case 'remove':
        return this.reminder.remove(data.id);
      case 'list':
        return this.reminder.list();
    }
  }
}
```

## 消息批处理 (message-batch.js)

### MessageBatch

```
MessageBatch
├── windowMs: number            # 聚合窗口（毫秒），默认 200
├── maxCount: number            # 最大条数，默认 50
├── queue: Map                  # key -> mergedItem
├── timer: Timeout              # 定时器引用
├── flushOnEmpty: boolean       # 窗口到期时仅 1 条也 flush，默认 true
├── push(key, item, mergeFn)    # 推入待发送项，若 key 重复则 mergeFn 合并
├── flush()                     # 立即发送当前队列全部
├── destroy()                   # flush + 清理定时器
└── onFlush: callback(items)    # flush 回调（由 MessageBus 设置）
```

## 客户端通道 (channel/client-channel.js)

### ClientChannel

```
ClientChannel
├── bus: MessageBus              # 内部持有的消息总线
├── clientId: string             # 服务端分配的客户端 ID
├── handlerMap: Map              # topic -> handler 映射
├── connect(clientId)            # 设置 clientId，注册已缓存的订阅
├── send(topic, payload)         # 发送消息（经 MessageBus 聚合后发出）
├── on(topic, handler)           # 订阅 topic（同时订阅 topic 和 topic:clientId）
├── off(topic)                   # 取消订阅
└── disconnect()                 # 取消所有订阅
```

### 伪代码

```text
ClientChannel.send(topic, payload):
    bus.publish(new Message({
        type: EVENT,
        topic,
        payload: { clientId, data: payload }
    }))

ClientChannel.on(topic, handler):
    handlerMap[topic] = handler
    若 clientId 不存在: 缓存，connect 时再订阅
    否则:
        bus.subscribeHandler(topic, 'client:' + clientId + ':' + topic, 包装回调)
        bus.subscribeHandler(topic + ':' + clientId, 'client:' + clientId + ':' + topic, 包装回调)

包装回调:
    msg = 收到的消息
    payload = msg.payload
    若 payload.targetClientId 存在 且 payload.targetClientId != clientId:
        跳过（私密消息非本客户端）
    否则:
        handler(payload.data)

ClientChannel.off(topic):
    bus.unsubscribeHandler(topic, ...)
    bus.unsubscribeHandler(topic + ':' + clientId, ...)
    handlerMap.delete(topic)
```

## 服务端通道 (channel/server-channel.js)

### ServerChannel

```
ServerChannel
├── bus: MessageBus              # 内部持有的消息总线
├── handlerMap: Map              # topic -> handler 映射
├── on(topic, handler)           # 订阅客户端消息
├── push(clientIds[], topic, payload)  # 向指定客户端推送
├── broadcast(topic, payload)    # 向所有订阅者广播
└── assignClientId()             # 生成唯一 clientId
```

### 伪代码

```text
ServerChannel.on(topic, handler):
    handlerMap[topic] = handler
    bus.subscribeHandler(topic, 'server:' + topic, handler)

ServerChannel.push(clientIds, topic, payload):
    for each clientId in clientIds:
        bus.publish(new Message({
            type: EVENT,
            topic: topic + ':' + clientId,
            payload: { data: payload, targetClientId: clientId }
        }))

ServerChannel.broadcast(topic, payload):
    bus.publish(new Message({
        type: BROADCAST,
        topic,
        payload: { data: payload }
    }))

ServerChannel.assignClientId():
    生成 uuid 作为 clientId
    返回 clientId
```

## 消息总线集成

### MessageBus 扩展

```text
MessageBus 新增:
├── batchConfigs: Map            # topic -> { windowMs, maxCount, mergeFn }
├── batchers: Map                # topic -> MessageBatch 实例
├── setBatchConfig(topic, config) # 设置聚合配置
├── removeBatchConfig(topic)     # 移除聚合配置
└── publish 方法扩展:
    若有 topic 的 batchConfig:
        将消息推入 batchers[topic]
        batcher.onFlush = (items) -> 逐一发送到订阅者
    若无 batchConfig:
        走原有广播/点对点逻辑
```

### 伪代码

```text
MessageBus.setBatchConfig(topic, config):
    batchConfigs[topic] = config
    batch = new MessageBatch(config)
    batch.onFlush = (items) ->
        for item in items:
            // 将合并后的消息发布到 topic
            this.publishDirect(item.message)
    batchers[topic] = batch

MessageBus.publish(message):
    原有逻辑...
    若 message 是 EVENT 类型 且 batchConfigs 有 message.topic:
        batcher = batchers[message.topic]
        batcher.push(message.topic, message, config.mergeFn)
        返回
    原有 broadcast/send 逻辑...
```

## 文件清单

| 文件 | 说明 |
|------|------|
| aasc/index.js | 入口文件 |
| aasc/message.js | 消息协议 |
| aasc/message-bus.js | 消息总线 |
| aasc/message-batch.js | 消息批处理 |
| aasc/channel/client-channel.js | 客户端通信通道 |
| aasc/channel/server-channel.js | 服务端通信通道 |
| aasc/actor.js | 执行者基类 |
| aasc/router.js | 消息路由 |
| aasc/registry.js | 执行者注册表 |
| aasc/user.js | 用户模型 |
| aasc/record.js | 用户记录 |
| aasc/capability.js | 能力继承 |
| aasc/cluster.js | 分布式集群 |
| aasc/actors/reminder-actor.js | 提醒执行者 |
| aasc/actors/chat-actor.js | 聊天执行者 |
| aasc/actors/voice-command-actor.js | 语音命令执行者 |
| aasc/actors/media-control-actor.js | 媒体控制执行者 |

## 多 Auto-Brain 运行时支持（伪代码）

### 1. 运行时注册与主题约定

```text
MessageBus.registerRuntime(runtimeId, metadata):
    若 runtimeId 为空:
        返回 false
    若 runtimeRegistry 已存在 runtimeId:
        返回 false
    runtimeRegistry[runtimeId] = {
        runtimeId,
        metadata,
        status: 'ready',
        registeredAt: now,
        lastHeartbeat: now
    }
    返回 true

MessageBus.buildRuntimeTopic(runtimeId, channel):
    返回 'autobrain.' + runtimeId + '.' + channel
```

### 2. 运行时订阅与发布

```text
MessageBus.subscribeRuntime(runtimeId, channel, handler, subscriberId):
    topic = buildRuntimeTopic(runtimeId, channel)
    subscribeHandler(topic, subscriberId, handler)

MessageBus.publishRuntime(runtimeId, channel, payload):
    topic = buildRuntimeTopic(runtimeId, channel)
    publish({
        type: EVENT,
        topic,
        payload: {
            runtimeId,
            channel,
            data: payload
        }
    })
```

### 3. 统计扩展

```text
MessageBus.updateStats(message):
    维持原有 totalMessages / messagesByType / messagesByTopic
    若 topic 以 'autobrain.' 开头:
        从 topic 解析 runtimeId
        messagesByRuntime[runtimeId] += 1

MessageBus.getStats():
    返回 runtimeCount = runtimeRegistry.size
    返回 messagesByRuntime
```

### 4. 跨设备消息伪代码

```text
MessageBus.registerDeviceTransport(deviceId, transport):
    deviceTransports[deviceId] = transport

MessageBus.publishRuntime(runtimeId, channel, payload, options):
    envelope = {
        runtimeId,
        channel,
        data: payload,
        sourceDeviceId: localDeviceId,
        targetDeviceId: options.targetDeviceId,
        targetRuntimeId: options.targetRuntimeId
    }

    若 options.broadcastDevices 存在:
        对每个 deviceId 执行投递
        返回

    若 envelope.targetRuntimeId 存在:
        runtimeDeviceId = runtimeDeviceIndex[targetRuntimeId]
        若 runtimeDeviceId != localDeviceId:
            forwardRuntimeEnvelope(runtimeDeviceId, envelope)
            返回

    若 envelope.targetDeviceId 存在 且 envelope.targetDeviceId != localDeviceId:
        forwardRuntimeEnvelope(envelope.targetDeviceId, envelope)
        返回

    publishRuntimeEnvelope(envelope)

MessageBus.forwardRuntimeEnvelope(targetDeviceId, envelope):
    transport = deviceTransports[targetDeviceId]
    若 transport 不存在:
        返回 null
    调用 transport(envelope) 或 transport.publishRuntimeMessage(envelope)

MessageBus.receiveRemoteRuntimeMessage(envelope):
    若 targetDeviceId 不为空 且 targetDeviceId != localDeviceId:
        返回
    publishRuntimeEnvelope(envelope)
```

### 5. WebSocket 桥接协议（/runtime-bridge）

```text
客户端连接: ws://{host}:{port}/runtime-bridge?deviceId={deviceId}

服务端下行:
    runtimeBridge.connected
    runtimeBridge.heartbeatAck
    runtimeEnvelope

客户端上行:
    runtimeBridge.register
    runtimeBridge.heartbeat
    runtimeEnvelope
```

## 能力组合系统

### 核心原则

**能力与执行者解耦**：
- 能力是独立定义的功能单元，不绑定到特定执行者
- 一个能力可以被多个执行者共享使用
- 执行者通过能力ID引用能力，声明自己拥有哪些能力

### 模块结构

```
aasc/
├── pipeline.js           # 能力管道执行器
├── composition.js        # 能力组合定义
├── level-calculator.js   # 能力等级计算器
└── config/
    └── capabilities.json # 能力配置文件（全局能力定义）
```

### 管道执行器 (pipeline.js)

```
PipelineStatus
├── PENDING     # 等待中
├── RUNNING     # 运行中
├── COMPLETED   # 已完成
├── FAILED      # 失败
└── CANCELLED   # 已取消

StepErrorStrategy
├── FAIL        # 失败终止
├── SKIP        # 跳过继续
├── RETRY       # 重试
└── FALLBACK    # 降级处理

PipelineContext
├── data: object           # 上下文数据
├── results: object        # 步骤结果
├── errors: array          # 错误列表
├── metadata: object       # 元数据
├── set(key, value)        # 设置数据
├── get(key)               # 获取数据
├── setStepResult(id, res) # 设置步骤结果
├── getStepResult(id)      # 获取步骤结果
├── addError(stepId, err)  # 添加错误
├── hasErrors()            # 是否有错误
└── toJSON()               # 导出JSON

PipelineStep
├── id: string             # 步骤ID
├── capabilityId: string   # 能力ID
├── inputMapping: object   # 输入映射
├── outputMapping: object  # 输出映射
├── onError: string        # 错误策略
├── retryCount: number     # 重试次数
├── retryDelay: number     # 重试延迟
├── timeout: number        # 超时时间
├── condition: any         # 执行条件
├── resolveInput(ctx)      # 解析输入
├── applyOutputMapping(res, ctx) # 应用输出映射
└── shouldExecute(ctx)     # 是否执行

PipelineExecutor
├── capabilityRegistry     # 能力注册表
├── messageBus             # 消息总线
├── actorRegistry          # 执行者注册表
├── transformers: Map      # 转换器
├── stepExecutors: Map     # 步骤执行器
├── execute(composition, ctx) # 执行组合
├── executeStep(step, ctx) # 执行步骤
├── executeCapability(id, input, timeout) # 执行能力
├── findActorsWithCapability(id) # 查找执行者
└── executeParallel(steps, ctx) # 并行执行

PipelineBuilder
├── step(capabilityId, options) # 添加步骤
├── withInput(mapping)    # 设置输入映射
├── withOutput(mapping)   # 设置输出映射
├── onError(strategy)     # 设置错误策略
├── withRetry(count, delay) # 设置重试
├── withCondition(cond)   # 设置条件
└── build()               # 构建管道
```

### 能力组合定义 (composition.js)

```
TriggerType
├── COMMAND    # 命令触发
├── EVENT      # 事件触发
├── SCHEDULE   # 定时触发
├── MANUAL     # 手动触发
└── CAPABILITY # 能力触发

CompositionStatus
├── ENABLED    # 启用
├── DISABLED   # 禁用
└── DEPRECATED # 废弃

Trigger
├── type: string           # 触发类型
├── pattern: string        # 匹配模式
├── topic: string          # 事件主题
├── schedule: string       # 定时表达式
├── condition: any         # 触发条件
├── capabilityId: string   # 能力ID
├── matches(input)         # 匹配检查
└── extractParams(input, matchResult) # 提取参数

CapabilityComposition
├── id: string             # 组合ID
├── name: string           # 组合名称
├── description: string    # 描述
├── trigger: Trigger       # 触发器
├── pipeline: PipelineStep[] # 管道步骤
├── fallbackPipeline       # 降级管道
├── status: string         # 状态
├── priority: number       # 优先级
├── timeout: number        # 超时时间
├── metadata: object       # 元数据
├── shouldTrigger(input)   # 是否触发
├── getCapabilityIds()     # 获取能力ID列表
├── getMaxCapabilityLevel(registry) # 获取最大能力等级
├── getDependencies(registry) # 获取依赖
└── validate(registry)     # 验证

CompositionRegistry
├── configPath: string     # 配置路径
├── compositions: Map      # 组合列表
├── triggerIndex: Map      # 触发索引
├── load()                 # 加载配置
├── save()                 # 保存配置
├── register(composition)  # 注册组合
├── unregister(id)         # 注销组合
├── get(id)                # 获取组合
├── getByTriggerType(type) # 按触发类型获取
├── findMatchingCompositions(input, type) # 查找匹配组合
├── getEnabled()           # 获取启用的组合
├── getAll()               # 获取所有组合
└── validateAll(registry)  # 验证所有组合

CompositionExecutor
├── compositionRegistry    # 组合注册表
├── pipelineExecutor       # 管道执行器
├── capabilityRegistry     # 能力注册表
├── execute(id, context)   # 执行组合
├── executeByTrigger(input, type) # 按触发执行
└── executeAllMatches(input, type) # 执行所有匹配

CompositionBuilder
├── withId(id)             # 设置ID
├── withName(name)         # 设置名称
├── withDescription(desc)  # 设置描述
├── withTrigger(trigger)   # 设置触发器
├── commandTrigger(pattern) # 命令触发
├── eventTrigger(topic)    # 事件触发
├── scheduleTrigger(schedule) # 定时触发
├── addStep(capabilityId, options) # 添加步骤
├── withPipeline(steps)    # 设置管道
├── withFallback(pipeline) # 设置降级管道
├── withPriority(priority) # 设置优先级
├── withTimeout(timeout)   # 设置超时
├── withMetadata(metadata) # 设置元数据
└── build()                # 构建组合
```

### 能力等级计算器 (level-calculator.js)

```
ScoreWeight
├── BASIC: 0.5        # 基础能力权重
├── PROFESSIONAL: 1.0 # 专业能力权重
└── SPECIAL: 1.5      # 特殊能力权重

CapabilityScore
├── capabilityId: string   # 能力ID
├── name: string           # 能力名称
├── category: string       # 能力分类
├── level: number          # 能力等级
├── weight: number         # 权重
├── weightedScore: number  # 加权分数
├── dependencies: string[] # 依赖列表
└── toJSON()               # 导出JSON

ActorLevelScore
├── actorId: string        # 执行者ID
├── actorName: string      # 执行者名称
├── capabilities: array    # 能力分数列表
├── categoryScores: object # 分类分数
├── maxLevel: number       # 最大等级
├── overallLevel: number   # 综合等级
├── totalWeightedScore: number # 总加权分数
├── complexityScore: number # 复杂度分数
├── dependencyScore: number # 依赖分数
├── recommendations: array # 建议列表
├── addCapability(score)   # 添加能力分数
├── calculate()            # 计算分数
├── calculateComplexityScore() # 计算复杂度
├── calculateDependencyScore() # 计算依赖分数
├── calculateOverallLevel() # 计算综合等级
├── generateRecommendations() # 生成建议
└── toJSON()               # 导出JSON

CapabilityLevelCalculator
├── capabilityRegistry     # 能力注册表
├── customWeights: object  # 自定义权重
├── setWeight(category, weight) # 设置权重
├── getWeight(category)    # 获取权重
├── calculateCapabilityScore(capability) # 计算能力分数
├── calculateActorLevel(actor) # 计算执行者等级
├── calculateMultipleActors(actors) # 计算多个执行者
├── calculateSystemLevel(actors) # 计算系统等级
├── calculateCoverage(scores, category) # 计算覆盖率
├── generateSystemRecommendations(score) # 生成系统建议
├── compareActors(actor1, actor2) # 比较执行者
├── rankActors(actors)     # 排名执行者
└── findBestActorForCapability(actors, capabilityId) # 查找最佳执行者

LevelCalculatorBuilder
├── withCapabilityRegistry(registry) # 设置能力注册表
├── withCustomWeights(weights) # 设置自定义权重
└── build()               # 构建计算器
```

### 使用示例

```javascript
const { 
  PipelineExecutor, PipelineBuilder,
  CompositionRegistry, CompositionBuilder, CompositionExecutor,
  CapabilityLevelCalculator, LevelCalculatorBuilder,
  CapabilityRegistry, getBus
} = require('./aasc');

const capabilityRegistry = new CapabilityRegistry();
capabilityRegistry.load();

const compositionRegistry = new CompositionRegistry();
compositionRegistry.load();

const pipelineExecutor = new PipelineExecutor({
  capabilityRegistry,
  messageBus: getBus()
});

const compositionExecutor = new CompositionExecutor({
  compositionRegistry,
  pipelineExecutor,
  capabilityRegistry
});

const result = await compositionExecutor.executeByTrigger('报时', 'command');

const calculator = new LevelCalculatorBuilder()
  .withCapabilityRegistry(capabilityRegistry)
  .build();

const actorScore = calculator.calculateActorLevel(actor);
console.log(`Actor level: ${actorScore.overallLevel}`);
```

### 配置文件

能力配置文件: config/capabilities.json

组合配置文件: config/compositions.json（自动生成）

## AASC 四层架构实现

### 架构概述

AASC (Advance Action System Control) 架构将系统分为四层：

```
┌─────────────────────────────────────────────────────────────┐
│                     System 层                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              WebSocketSystem                         │   │
│  │  - 初始化和管理所有 Actor                            │   │
│  │  - 协调消息总线                                      │   │
│  │  - 处理 WebSocket 连接                               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Actor 层      │ │   Actor 层      │ │   Actor 层      │
│ VoiceCommand    │ │ Chat            │ │ MediaControl    │
│ Actor           │ │ Actor           │ │ Actor           │
└─────────────────┘ └─────────────────┘ └─────────────────┘
           │               │               │
           ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Agent 层      │ │   Agent 层      │ │   Agent 层      │
│ VoiceCommand    │ │ Chat            │ │ MediaControl    │
│ Agent           │ │ Agent           │ │ Agent           │
└─────────────────┘ └─────────────────┘ └─────────────────┘
           │               │               │
           └───────────────┼───────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Component 层                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │MessageParser│  │Dispatcher   │  │StateManager │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Component 层

#### MessageParser (消息解析器)

```
MessageParser
├── parse(rawMessage)           # 解析原始消息
├── parseToMessage(rawMessage)  # 解析并转换为 Message 对象
├── validate(data)              # 验证消息数据
├── transform(data)             # 转换消息数据
├── registerValidator(field, fn) # 注册验证器
└── registerTransformer(field, fn) # 注册转换器
```

#### MessageDispatcher (消息路由分发器)

```
MessageDispatcher
├── dispatch(message, context)  # 分发消息到对应处理器
├── registerRoute(route)        # 注册路由规则
├── registerHandler(type, handler) # 注册处理器
├── use(middleware)             # 添加中间件
├── setDefaultHandler(handler)  # 设置默认处理器
└── getHandlers()               # 获取所有处理器
```

##### 默认路由规则

| 消息类型 | 目标 Actor | 说明 |
|---------|-----------|------|
| voiceCommand | voice-command-actor | 语音命令处理 |
| voiceInput | voice-command-actor | 语音输入处理（子显示端） |
| confirmVoiceCommand | voice-command-actor | 确认语音命令 |
| executeCommands | voice-command-actor | 执行命令 |
| getAssistantConfig | voice-command-actor | 获取助手配置 |
| setAssistantConfig | voice-command-actor | 设置助手配置 |
| chat | chat-actor | 聊天消息 |
| chatMessage | chat-actor | 聊天消息 |
| media | media-control-actor | 媒体控制 |
| mediaBatch | media-control-actor | 批量媒体控制 |
| control | media-control-actor | 显示控制 |
| getState | media-control-actor | 获取状态 |
| tts | tts-actor | 语音合成 |
| getReminders | reminder-actor | 获取提醒列表 |
| timeAnnounce | system-command-actor | 整点报时 |
| canvasSize | display-render-actor | 画布尺寸更新 |
| browserInfo | display-render-actor | 浏览器信息 |
| commandAck | display-render-actor | 命令确认 |
| voiceStatus | display-render-actor | 语音状态 |
| getSearchHistory | search-actor | 获取搜索历史 |
| clearSearchHistory | search-actor | 清空搜索历史 |
| deleteSearchHistory | search-actor | 删除搜索历史 |

**注意**：voiceInput 消息由子显示端（voice-display-node）发送，包含语音识别文本，路由到 voice-command-actor 进行语音命令处理。

#### StateManager (状态管理器)

```
StateManager
├── get(name, defaultValue)     # 获取状态
├── set(name, value)            # 设置状态
├── update(name, updater)       # 更新状态
├── delete(name)                # 删除状态
├── registerState(name, config) # 注册状态
├── getDisplayClient(displayId) # 获取显示端客户端
├── setDisplayClient(displayId, data) # 设置显示端客户端
├── removeDisplayClient(displayId) # 移除显示端客户端
└── getDisplayList()            # 获取显示端列表
```

### Agent 层

#### Agent 基类

```
BaseAgent
├── name: string                # Agent 名称
├── description: string         # Agent 描述
├── capabilities: array         # 能力列表
├── dependencies: array         # 依赖列表
├── init()                      # 初始化
├── destroy()                   # 销毁
├── execute(action, params, context) # 执行操作
├── hasCapability(capabilityId) # 检查能力
└── getInfo()                   # 获取信息
```

#### 已实现的 Agent

| Agent | 能力 | 说明 |
|-------|------|------|
| VoiceCommandAgent | voice-command | 语音命令处理 |
| ChatAgent | chat | 聊天处理 |
| MediaControlAgent | media-control | 媒体控制 |
| TTSAgent | tts | 语音合成 |
| ReminderAgent | reminder | 提醒处理 |
| DisplayRenderAgent | display-render | 显示端渲染 |
| SystemCommandAgent | system-command | 系统命令 |
| SearchAgent | search | 搜索处理 |

#### MediaControlAgent 详细实现

```
MediaControlAgent
├── sendMedia(params, context)       # 发送媒体到显示端
│   ├── 获取 displayClient
│   ├── 更新 displayClient.state.currentMedia
│   ├── 调用 config.updateDisplayStateById(displayId, ip, { currentMedia }) # 按显示端身份持久化状态
│   └── 调用 context.sendToDisplay(displayId, media)
│
├── sendMediaBatch(params, context)  # 批量发送媒体
│   └── 遍历 displayIds:
│       ├── 更新 displayClient.state.currentMedia
│       ├── 调用 config.updateDisplayStateById(displayId, ip, { currentMedia }) # 按显示端身份持久化状态
│       └── 调用 context.sendToDisplay(displayId, media)
│
├── sendControl(params, context)     # 发送控制指令
│   ├── 获取 displayClient
│   ├── 根据 action 更新状态:
│   │   ├── 'rotate' -> state.rotation = value, config.updateDisplayStateById(displayId, ip, { rotation })
│   │   ├── 'fit' -> state.fit = value, config.updateDisplayStateById(displayId, ip, { fit })
│   │   ├── 'crop' -> state.crop = value, config.updateDisplayStateById(displayId, ip, { crop })
│   │   ├── 'volume' -> state.volume = value, config.updateDisplayStateById(displayId, ip, { volume })
│   │   └── 'play' -> state.isPlaying = value, config.updateDisplayStateById(displayId, ip, { isPlaying })
│   └── 调用 context.sendToDisplay(displayId, { type: 'control', action, value })
│
└── getState(params, context)        # 获取显示端状态
    ├── 获取 displayClient
    ├── 如果 displayClient 不存在:
    │   └── 通过 context.ws.send() 发送空 state 给控制端
    ├── 复制 state
    ├── 如果 state.currentMedia 存在:
    │   ├── state.currentMediaUrl = state.currentMedia.url
    │   └── state.currentMediaType = state.currentMedia.mediaType
    └── 通过 context.ws.send() 发送 displayState 给控制端（非显示端）
```

### System 层

#### WebSocketSystem

```
WebSocketSystem
├── bus: MessageBus             # 消息总线
├── parser: MessageParser       # 消息解析器
├── dispatcher: MessageDispatcher # 消息分发器
├── stateManager: StateManager  # 状态管理器
├── actors: Map                 # Actor 注册表
├── agents: Map                 # Agent 注册表
├── initialize()                # 初始化系统
├── registerActor(name, actor)  # 注册 Actor
├── registerAgent(name, agent)  # 注册 Agent
├── use(middleware)             # 添加中间件
├── handleDisplayMessage(displayId, message, ws) # 处理显示端消息
├── handleControlMessage(message, ws) # 处理控制端消息
├── handleDisplayConnect(displayId, clientIP, ws, savedState) # 处理显示端连接，savedState 为已保存的状态
├── handleDisplayDisconnect(displayId) # 处理显示端断开
├── handleControlConnect(ws)    # 处理控制端连接
├── handleControlDisconnect(ws) # 处理控制端断开
├── sendToDisplay(displayId, data) # 发送消息到显示端
├── broadcastToControls(data)   # 广播消息到控制端
├── getDisplayList()            # 获取显示端列表
├── getStats()                  # 获取系统统计
└── shutdown()                  # 关闭系统
```

#### handleDisplayConnect 实现

```
handleDisplayConnect(displayId, clientIP, ws, savedState = null):
    displayState = {
        ws: ws,
        ip: clientIP,
        state: { ...createDisplayState(), ...savedState }  # 合并默认状态和已保存状态
    }
    
    stateManager.setDisplayClient(displayId, displayState)
    
    如果 callbacks.onDisplayConnect 存在:
        调用 callbacks.onDisplayConnect(displayId, clientIP, ws)
    
    broadcastToControls({ type: 'displayList', list: stateManager.getDisplayList() })
    
    返回 displayState
```

### 中间件

#### 内置中间件

| 中间件 | 说明 |
|--------|------|
| ValidationMiddleware | 消息验证 |
| LoggingMiddleware | 日志记录 |
| ErrorHandlingMiddleware | 错误处理 |
| AuthenticationMiddleware | 身份认证 |
| RateLimitMiddleware | 请求限流 |
| TimeoutMiddleware | 超时处理 |
| DisplayCheckMiddleware | 显示端检查（仅检查 media/control/tts 类型） |

#### RateLimitMiddleware 配置

```
RateLimitMiddleware options:
├── maxRequests: number      # 最大请求数，默认 100
├── windowMs: number         # 时间窗口（毫秒），默认 60000
└── exemptTypes: string[]    # 豁免限流的消息类型
    ├── 'voiceStatus'        # 语音状态（高频）
    ├── 'voiceInput'         # 语音输入（高频）
    ├── 'heartbeat'          # 心跳
    ├── 'commandAck'         # 命令确认（高频）
    ├── 'canvasSize'         # 画布尺寸同步（高频）
    └── 'browserInfo'        # 浏览器信息同步（高频）
```

#### 使用示例

```javascript
const { createMiddlewareChain } = require('./aasc');

const middlewareChain = createMiddlewareChain({
    logging: true,
    errorHandling: true,
    validation: true,
    displayCheck: true,
    timeout: 30000,
    rateLimit: {
        maxRequests: 100,
        windowMs: 60000,
        exemptTypes: ['voiceStatus', 'voiceInput', 'heartbeat', 'commandAck', 'canvasSize', 'browserInfo']
    }
});

wsSystem.use(async (message, context) => {
    const result = await middlewareChain.execute(message, context);
    if (result && result.success === false) {
        return false;  // 中间件拒绝
    }
    return message;
});
```

### 消息类型映射

| 消息类型 | 处理 Actor | 处理 Agent |
|----------|------------|------------|
| voiceCommand | voice-command-actor | VoiceCommandAgent |
| chat | chat-actor | ChatAgent |
| chatMessage | chat-actor | ChatAgent |
| media | media-control-actor | MediaControlAgent |
| mediaBatch | media-control-actor | MediaControlAgent |
| control | media-control-actor | MediaControlAgent |
| tts | tts-actor | TTSAgent |
| getReminders | reminder-actor | ReminderAgent |
| timeAnnounce | system-command-actor | SystemCommandAgent |
| canvasSize | display-render-actor | DisplayRenderAgent |
| browserInfo | display-render-actor | DisplayRenderAgent |
| voiceInput | voice-command-actor | VoiceCommandAgent |
| commandAck | display-render-actor | DisplayRenderAgent |
| capabilities | display-render-actor | DisplayRenderAgent |
| getSearchHistory | search-actor | SearchAgent |
| getAssistantConfig | voice-command-actor | VoiceCommandAgent |

### 语音输入与能力声明补充

```javascript
VoiceCommandAgent.processVoiceInput(params, context):
    读取 text/fullText
    如果内容为空或只包含标点:
        直接忽略
    读取 displayId 对应的显示端 IP
    打印 `[语音输入] 显示端 {displayId} ({displayIP}): {text}`
    调用 voiceCommand.enqueueVoiceInput()，保证同一显示端语音串行执行

DisplayRenderAgent.updateCapabilities(params, context):
    读取 displayId / capabilities
    与默认能力集合合并
    写回 stateManager.displayClient.state.capabilities
    广播最新 displayList 给控制端

MessageDispatcher:
    注册 capabilities -> display-render-actor 路由
```

### 初始化流程

```javascript
const { initializeAASCSystem } = require('./aasc/init');

const wsSystem = await initializeAASCSystem({
    localIP,
    port: PORT,
    voiceCommand,
    chat,
    tts,
    reminder,
    timeAnnounce,
    config,
    sendToDisplay,
    broadcastToControls,
    onDisplayConnect: (displayId, clientIP, ws) => { },
    onDisplayDisconnect: (displayId) => { },
    onControlConnect: (ws) => { },
    onControlDisconnect: (ws) => { }
});
```

### 扩展新功能

1. 创建新的 Agent：

```javascript
class MyAgent extends BaseAgent {
    constructor(options) {
        super({
            name: 'my-agent',
            capabilities: [{ id: 'my-capability', category: 'basic', level: 2 }],
            ...options
        });
    }

    async myAction(params, context) {
        return { success: true };
    }
}
```

2. 创建 Actor 适配器：

```javascript
const actor = AgentActorAdapter.createFromAgent(new MyAgent(), {
    name: 'my-actor',
    supportedTypes: ['myType'],
    actionMap: { 'myType': 'myAction' }
});
```

3. 注册到系统：

```javascript
await actor.init();
wsSystem.registerActor('my-actor', actor);
```
