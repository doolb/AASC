# AASC 系统实现文档

## 概述

AASC（Actor-based Asynchronous Service Communication）系统的核心实现，包含消息总线、执行者模型、消息路由等核心组件。

## 模块结构

```
aasc/
├── index.js          # 入口文件，导出所有模块
├── message.js        # 消息协议定义
├── message-bus.js    # 消息总线核心
├── actor.js          # 执行者基类
├── router.js         # 消息路由和过滤
├── registry.js       # 执行者注册表
├── user.js           # 用户模型
├── record.js         # 用户记录
├── capability.js     # 能力继承
├── cluster.js        # 分布式集群
└── actors/           # 具体执行者实现
    ├── index.js
    ├── reminder-actor.js
    ├── chat-actor.js
    ├── voice-command-actor.js
    ├── media-control-actor.js
    ├── media-library-actor.js
    ├── display-render-actor.js
    ├── system-command-actor.js
    ├── private-chat-actor.js
    ├── important-record-actor.js
    ├── search-actor.js
    └── tts-actor.js
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
    this.reminder = require('../core/reminder');
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

## 文件清单

| 文件 | 说明 |
|------|------|
| aasc/index.js | 入口文件 |
| aasc/message.js | 消息协议 |
| aasc/message-bus.js | 消息总线 |
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
