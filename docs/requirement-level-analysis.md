# 需求等级分析报告（修订版）

> 用户补充说明: "viewbind的底层有一个服务端和客户端的通信机制"
> 参考: `ViewBind.integration.test.js` 中基于 WS + ViewBindList 的通信模式

## 评审结论
- **结论**: 需补充
- **主等级**: L6（功能模块替换）
- **次等级**: L7, L5, L4
- **置信度**: 0.72（中）
- **直接开发风险**: 高

## 能力级别下放评估
- **下放判定**: 必须下放
- **当前建议能力等级**: L4
- **触发证据**: "用viewbind的新的消息系统代替现有的消息系统" —— 补充说明指向 ViewBind.integration.test.js 中的 WS + ViewBindList 通信模式
- **拆解建议**: 
  1. 先识别现有 framework/aasc 的使用者（哪些模块调用了 MessageBus/Actor/publish/subscribe/WebSocketSystem）
  2. 从 ViewBind.integration.test.js 中提取更通用的 WS 通信模式类，替代现在 WebSocketSystem 对 MessageBus/Actor 的依赖
  3. 逐模块制定替换映射表（现有 WebSocketSystem API → 新 WS 通信层 API）
  4. 确定 ViewBind 在替换后的作用：作为状态管理的响应式数据层（类似集成测试中 displayClients ViewBindList 的用法）

## 评分

| 维度 | 分数 | 说明 |
|------|------|------|
| 层级清晰度 | 8/25 | 补充后明确了WS通信模式方向，但仍然缺少架构定义 |
| 证据充分度 | 6/20 | 有集成测试参考，但无具体接口定义 |
| 实现完备度 | 4/20 | 模式已有雏形，但未说明如何抽离为通用通信层 |
| 风险暴露度 | 4/20 | 替换范围、兼容性、回归风险仍未识别 |
| L4 可落地性 | 5/15 | 有了参考代码，但缺少操作步骤 |
| **总分** | **27/100** | **信息仍不足，但方向已明确** |

## 证据明细

- **[L7\|强]** "代替现有的消息系统" —— 涉及系统级架构替换，现有 system/websocket-system.js + framework/aasc/ 共 20+ 子模块
- **[L6\|强]** "用viewbind的新的消息系统" —— 参考 ViewBind.integration.test.js 中 WS + ViewBindList 通信模式，是功能模块级替换
- **[L5\|中]** 集成测试中展示的模式：WS连接/断开 → ViewBindList push/remove → broadcastDisplayList，是一个业务流程
- **[L4\|弱]** ViewBindList + WebSocket send/on('message') 的具体数据流操作

## 语义切片与判级

### 片段1: "用viewbind的新的消息系统"
- **候选层级**: L5~L6
- **证据**: 参考 `ViewBind.integration.test.js`，模式为：WS连接管理 + ViewBindList 状态管理 + 自动广播
- **断点**: 集成测试中的模式是 inline 实现的（startServer 函数），没有抽离为可复用的通信类。需要：
  - 抽离为 `WSViewBindServer` / `WSViewBindClient` 类
  - 定义通用 API（listen/connect/disconnect/broadcast/send）
  - 替代现有 `WebSocketSystem` 对 `MessageBus` + `Actor` 的依赖

### 片段2: "代替现有的消息系统"
- **候选层级**: L6~L7
- **证据**: 现有 `WebSocketSystem` 基于 `MessageBus` / `Actor` / `MessageDispatcher` 构建，共 576+ 行
- **断点**: 
  - 替换范围：仅 WebSocketSystem？还是整个 framework/aasc？
  - 现有 WebSocketSystem 有中间件链、Actor 状态管理、消息解析/分发等功能，ViewBind 模式下如何对应？

## 断点与影响

| 断点 | 类型 | 影响 | 修复建议 |
|------|------|------|----------|
| "新的消息系统"无定义 | 概念模糊 | 无法判断实现方案 | 给出具体接口设计和架构图 |
| 替换范围未限定 | 边界缺失 | 可能遗漏或过度替换 | 列出现有系统所有使用方，逐模块标记替换/保留/重构 |
| 未说明动机 | 目标缺失 | 无法评估替换是否合理 | 说明为什么要替换（性能？复杂度？维护性？兼容性？） |

## 需补充项

### [范围与目标]
- **缺失原因**: 需求仅一句话，未说明替换范围、目标和边界
- **补充建议**: 
  1. 明确"新的消息系统"的定义：是基于ViewBind重新设计的消息架构，还是ViewBind直接充当消息总线？
  2. 列出现有系统中哪些模块需要替换、哪些保留
  3. 明确不做项（如：是否保留跨设备转发？是否保留Actor模型？）
- **不补充风险**: 开发方向错误，可能将简单的数据绑定用在不适合的场景（如跨设备通信需要传输层）

### [输入输出契约]
- **缺失原因**: 无任何API接口或消息格式的定义
- **补充建议**: 
  1. 给出新消息系统的核心API签名（publish/subscribe/send/broadcast等）
  2. 定义消息体结构（字段、类型、约束）
  3. 对比现有Message类的字段（type, priority, ttl, correlationId等），确定哪些保留、哪些删除
- **不补充风险**: 替换后调用方无法对接，或者对接后丢失功能（如无法设置消息优先级、无法做请求/响应）

### [业务规则]
- **缺失原因**: 无消息流转规则、错误处理、优先级策略的说明
- **补充建议**:
  1. 消息投递保证：at-most-once / at-least-once / exactly-once？
  2. 消息优先级处理策略（现有Priority有4级，ViewBind无优先级概念）
  3. TTL/过期策略（现有Message支持TTL过期，ViewBind不支持）
- **不补充风险**: 替换后消息语义变化，导致业务行为不一致

### [异常与边界]
- **缺失原因**: 无错误处理、回滚、容错方案
- **补充建议**:
  1. 消息投递失败的处理策略
  2. Actor状态管理替换方案（现有Actor有INITIALIZING→READY→BUSY→DEGRADED→OFFLINE状态机）
  3. 跨设备消息转发失败的回退策略
- **不补充风险**: 替换后系统容错能力下降，线上问题无法自动恢复

### [依赖与约束]
- **缺失原因**: 未说明现有系统调用方依赖
- **补充建议**:
  1. 审计现有代码中所有 import/require('../../framework/aasc') 的位置
  2. 评估每个依赖方的替换工作量
  3. 评估性能约束：现有MessageBus能处理多少消息/秒？新系统能否达标？
- **不补充风险**: 遗漏依赖方导致替换后功能缺失，或性能不达标

### [验收与观测]
- **缺失原因**: 无验收标准
- **补充建议**:
  1. 定义功能等价性测试：新系统能通过现有消息系统的全部测试吗？
  2. 定义替换后的系统行为和现有系统完全一致的关键指标
  3. 是否需要保留统计/监控能力（现有MessageBus有stats追踪）
- **不补充风险**: 替换后无法验证是否正确，可能出现静默失败

## 背景分析：两系统能力差距

### 现有系统 (framework/aasc) 核心能力
| 能力 | 说明 |
|------|------|
| 5种消息类型 | COMMAND, EVENT, QUERY, RESPONSE, BROADCAST |
| 4级优先级 | LOW, NORMAL, HIGH, URGENT |
| 9个预定义主题 | MEDIA_CONTROL, MEDIA_STATUS 等 |
| Actor模型 | 带状态机、心跳、生命周期管理 |
| 路由规则 | 按主题/类型/来源/能力/自定义条件匹配 |
| 跨设备转发 | 通过注册的传输函数 |
| 运行时消息 | 跨runtime通信 |
| 中间件链 | 验证、日志、鉴权、限流、超时 |
| 消息批处理 | 可配置时间窗口 |
| TTL/过期 | 每条消息独立TTL |
| 请求/响应 | 通过correlationId |
| 统计 | 按类型/主题/runtime/设备 |

### ViewBind 能力
| 能力 | 说明 |
|------|------|
| 数据绑定 | 键-回调映射，数据变化时通知 |
| 列表绑定 | ViewBindList 管理数组 |
| 重入安全 | pending binds/unbinds/notify |
| 错误隔离 | 每个回调try-catch |

### 主要能力缺口
1. **消息路由**: ViewBind没有路由概念，只有键匹配
2. **跨设备通信**: ViewBind没有网络层
3. **消息类型/优先级**: ViewBind没有消息元数据
4. **Actor生命周期**: ViewBind没有状态机
5. **请求/响应模式**: ViewBind没有correlationId机制
6. **中间件**: ViewBind没有过滤器/拦截器

## 结论

**当前需求仍无法直接开发**，但方向已明确。核心动作是：

1. **从 integration test 中抽离通用 WS 通信类**，替代现有 WebSocketSystem 对 MessageBus/Actor 的依赖
2. **ViewBind 作为状态管理的数据层**，WS 通信层基于 ViewBind/ViewBindList 做数据驱动推送

### 关键映射

| 现有 (framework/aasc) | 新系统 (ViewBind + WS) |
|---|---|
| MessageBus.publish() | ViewBind.data = newData → 触发绑定的 WS 广播 |
| Actor.onMessage() | WS on('message') 直接处理 |
| Actor 状态管理 | ViewBind 数据绑定 |
| MessageDispatcher + 中间件 | WS 消息 handler 链 |
| WebSocketSystem (576行) | 抽离通用 WSViewBindServer 类 (预计 ~300行) |
| MessageParser | JSON.parse + validate |

### 需要保留的能力
- 跨设备转发（需要 WS 传输层，ViewBind 不涉及）
- 请求/响应模式（可以用 callback/promise 模拟）
- 错误隔离（ViewBind 已有 _safeCall）

**建议**: 

1. **第一步** — 完成 `docs/design/viewbind-ws.md` 设计文档，定义新的 WS 通信层架构
2. **第二步** — 更新 `docs/spec/viewbind-ws.md` 实现文档（伪代码）
3. **第三步** — 生成 task 文档
4. **第四步** — 实现

---

请选择下一步：
1) 调用 `ai-code-translation`（基于当前 L4 草案进入翻译流程）
2) **仅保留本次判级结果，暂不翻译**（建议先补充设计文档再实现）
