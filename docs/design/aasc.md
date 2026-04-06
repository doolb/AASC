# AASC 系统架构设计文档

## 概述

AASC（Actor-based Asynchronous Service Communication）是一个基于消息总线的分布式系统架构，将所有系统能力抽象为"执行者"（Actor）实体，通过发布-订阅模式实现松耦合的消息流转。

## 1. 核心概念

### 1.1 执行者（Actor）

执行者是系统中最小的能力单元，具备以下特征：

| 特征 | 说明 |
|------|------|
| 唯一标识 | IP地址 + 角色类型 + 执行者名称 |
| 能力声明 | 描述可处理的消息类型和提供的服务 |
| 生命周期 | 支持动态注册、启用、禁用、注销 |
| 消息处理 | 订阅消息总线，自主过滤和处理消息 |

### 1.2 角色类型

| 角色 | 说明 | 示例 |
|------|------|------|
| 服务器 | 核心服务执行者 | 指令处理器、媒体库管理、定时任务 |
| 显示端 | 媒体展示执行者 | 画面渲染、语音播报、语音输入 |
| 控制端 | 用户交互执行者 | 媒体上传、控制指令、语音输入 |

### 1.3 消息总线

消息总线是系统的核心通信基础设施：

- 所有执行者共享同一消息总线
- 基于发布-订阅模式
- 支持消息过滤和路由
- 支持跨节点消息转发

---

## 2. 消息协议规范

### 2.1 消息格式

```typescript
interface Message {
  id: string;              // 消息唯一标识
  version: string;         // 协议版本
  type: MessageType;       // 消息类型
  priority: Priority;      // 优先级
  timestamp: number;       // 时间戳
  source: ActorAddress;    // 发送者地址
  target?: ActorAddress;   // 目标地址（点对点消息）
  topic?: string;          // 主题（发布-订阅消息）
  payload: any;            // 消息内容
  ttl?: number;            // 生存时间（毫秒）
  requiresAck?: boolean;   // 是否需要确认
}

interface ActorAddress {
  ip: string;              // IP地址
  role: 'server' | 'display' | 'control';
  name: string;            // 执行者名称
}

enum MessageType {
  COMMAND = 'command',     // 命令消息
  EVENT = 'event',         // 事件消息
  QUERY = 'query',         // 查询消息
  RESPONSE = 'response',   // 响应消息
  BROADCAST = 'broadcast'  // 广播消息
}

enum Priority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3
}
```

### 2.2 消息类型定义

| 类型 | 说明 | 示例 |
|------|------|------|
| COMMAND | 执行者间命令传递 | 播放媒体、设置音量 |
| EVENT | 状态变化通知 | 媒体播放完成、显示端上线 |
| QUERY | 信息查询请求 | 获取显示端状态、查询媒体列表 |
| RESPONSE | 查询响应 | 返回状态数据 |
| BROADCAST | 全局广播消息 | 整点报时、系统通知 |

### 2.3 消息主题定义

```typescript
enum MessageTopic {
  MEDIA_CONTROL = 'media.control',       // 媒体控制
  MEDIA_STATUS = 'media.status',         // 媒体状态
  DISPLAY_CONTROL = 'display.control',   // 显示控制
  DISPLAY_STATUS = 'display.status',     // 显示状态
  CHAT = 'chat',                         // 聊天消息
  REMINDER = 'reminder',                 // 提醒消息
  SYSTEM = 'system',                     // 系统消息
  VOICE = 'voice',                       // 语音消息
  USER_RECORD = 'user.record'            // 用户记录
}
```

---

## 3. 执行者模型

### 3.1 执行者能力结构

```typescript
interface ActorCapability {
  id: string;                    // 能力标识
  name: string;                  // 能力名称
  category: CapabilityCategory;  // 能力分类
  level: CapabilityLevel;        // 能力等级
  securityLevel: SecurityLevel;  // 保密等级
  description: string;           // 能力描述
  inputSchema?: object;          // 输入参数模式
  outputSchema?: object;         // 输出参数模式
  dependencies?: string[];       // 依赖的其他能力
  inherits?: string[];           // 继承的能力
}

enum CapabilityCategory {
  BASIC = 'basic',       // 基础能力
  PROFESSIONAL = 'professional',  // 专业能力
  SPECIAL = 'special'    // 特殊能力
}
```

### 3.2 执行者能力等级评级

能力等级用于评估执行者的能力和复杂度：

| 等级 | 名称 | 说明 | 示例 |
|------|------|------|------|
| L1 | 基础级 | 简单的消息处理和转发 | 消息转发、状态上报 |
| L2 | 标准级 | 单一功能实现 | 语音播报、定时提醒 |
| L3 | 进阶级 | 多功能组合 | 媒体库管理、聊天处理 |
| L4 | 高级 | 复杂业务逻辑 | AI助手、语音命令解析 |
| L5 | 专家级 | 系统核心能力 | 指令处理器、消息路由 |

### 3.3 执行者能力分类

#### 基础能力

| 能力 | 等级 | 说明 |
|------|------|------|
| 消息处理 | L1 | 接收、过滤、转发消息 |
| 事件触发 | L1 | 触发和监听系统事件 |
| 定时任务 | L2 | 定时执行任务 |
| 状态管理 | L2 | 管理执行者状态 |
| 日志记录 | L1 | 记录操作日志 |

#### 专业能力

| 能力 | 等级 | 说明 |
|------|------|------|
| 语言模型 | L4 | AI对话生成 |
| 代码辅助 | L4 | 代码生成和解释 |
| 语音识别 | L3 | 语音转文字 |
| 语音合成 | L3 | 文字转语音 |
| 图像处理 | L3 | 图片处理和分析 |

#### 特殊能力

| 能力 | 等级 | 说明 |
|------|------|------|
| 画面渲染 | L3 | 媒体画面渲染 |
| 媒体库管理 | L3 | 多源媒体管理 |
| 分布式协调 | L5 | 跨节点协调 |
| 安全认证 | L5 | 身份认证和授权 |

### 3.4 执行者注册信息

```typescript
interface ActorRegistration {
  address: ActorAddress;           // 执行者地址
  capabilities: ActorCapability[]; // 能力列表
  status: ActorStatus;             // 运行状态
  heartbeat: number;               // 心跳时间戳
  metadata: {                      // 元数据
    version: string;               // 版本号
    platform: string;              // 平台信息
    resources: ResourceInfo;       // 资源信息
  };
}

enum ActorStatus {
  INITIALIZING = 'initializing',
  READY = 'ready',
  BUSY = 'busy',
  DEGRADED = 'degraded',
  OFFLINE = 'offline'
}

interface ResourceInfo {
  hasMicrophone: boolean;    // 是否有麦克风
  hasSpeaker: boolean;       // 是否有扬声器
  hasCamera: boolean;        // 是否有摄像头
  screenResolution: { width: number; height: number };
}
```

---

## 4. 用户模型

### 4.1 用户数据结构

```typescript
interface User {
  id: string;                      // 用户唯一标识
  name: string;                    // 姓名
  birthday: string;                // 生日 (YYYY-MM-DD)
  securityLevel: SecurityLevel;    // 保密等级
  role: UserRole;                  // 用户角色
  createdAt: number;               // 创建时间
  lastLoginAt: number;             // 最后登录时间
  preferences: UserPreferences;    // 用户偏好
}

enum SecurityLevel {
  PUBLIC = 0,      // 公开
  LOW = 1,         // 低保密
  NORMAL = 2,      // 普通保密
  HIGH = 3,        // 高保密
  CRITICAL = 4,    // 关键保密
  TOP_SECRET = 5   // 最高保密
}

enum UserRole {
  USER = 'user',           // 普通用户
  MANAGER = 'manager',     // 管理者
  ADMIN = 'admin'          // 系统管理员
}
```

### 4.2 保密等级规则

| 用户保密等级 | 可访问的能力等级 | 说明 |
|--------------|------------------|------|
| 0 (公开) | L1-L2 | 仅可访问基础能力 |
| 1 (低保密) | L1-L3 | 可访问基础和部分专业能力 |
| 2 (普通保密) | L1-L3 | 可访问大部分能力 |
| 3 (高保密) | L1-L4 | 可访问高级能力 |
| 4 (关键保密) | L1-L4 | 可访问关键能力 |
| 5 (最高保密) | L1-L5 | 可访问所有能力（仅管理者） |

### 4.3 用户权限控制

```typescript
interface PermissionRule {
  userId: string;
  capabilityId: string;
  allowed: boolean;
  grantedBy: string;        // 授权者ID
  grantedAt: number;        // 授权时间
  expiresAt?: number;       // 过期时间
}

class PermissionManager {
  canAccessCapability(user: User, capability: ActorCapability): boolean {
    if (user.role === UserRole.MANAGER || user.role === UserRole.ADMIN) {
      return true;
    }
    return user.securityLevel >= capability.securityLevel;
  }
  
  getAccessibleCapabilities(user: User): ActorCapability[] {
    return allCapabilities.filter(cap => 
      this.canAccessCapability(user, cap)
    );
  }
}
```

### 4.4 管理者功能

管理者具有以下特殊权限：

1. **用户管理**
   - 查看所有用户列表
   - 修改用户的保密等级
   - 禁用/启用用户账户

2. **权限管理**
   - 查看所有用户的权限配置
   - 授予/撤销特定能力访问权限
   - 设置权限有效期

3. **审计功能**
   - 查看所有用户的操作日志
   - 查看敏感操作记录
   - 导出审计报告

---

## 5. 用户记录功能

### 5.1 记录数据结构

```typescript
interface UserRecord {
  id: string;                      // 记录唯一标识
  userId: string;                  // 用户ID
  type: RecordType;                // 记录类型
  content: string;                 // 记录内容
  source: RecordSource;            // 来源
  timestamp: number;               // 时间戳
  tags: string[];                  // 标签
  metadata: {                      // 元数据
    location?: string;             // 位置
    relatedActors?: string[];      // 相关执行者
    importance: ImportanceLevel;   // 重要程度
  };
}

enum RecordType {
  EVENT = 'event',           // 重要事件
  CONVERSATION = 'conversation',  // 重要对话
  TASK = 'task',             // 任务记录
  NOTE = 'note',             // 笔记
  REMINDER = 'reminder'      // 提醒记录
}

enum RecordSource {
  VOICE = 'voice',           // 语音输入
  TEXT = 'text',             // 文本输入
  SYSTEM = 'system',         // 系统生成
  IMPORT = 'import'          // 外部导入
}

enum ImportanceLevel {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4
}
```

### 5.2 系统记录指令

用户可以通过以下指令记录重要信息：

| 指令格式 | 说明 | 示例 |
|----------|------|------|
| `系统记录 {内容}` | 记录重要事件 | 系统记录 今天完成了项目验收 |
| `系统记录对话 {内容}` | 记录重要对话 | 系统记录对话 和客户讨论了新需求 |
| `系统记录任务 {内容}` | 记录任务 | 系统记录任务 完成月度报告 |
| `系统查询记录` | 查询所有记录 | 系统查询记录 |
| `系统查询记录 {关键词}` | 搜索记录 | 系统查询记录 验收 |

### 5.3 记录处理流程

```
用户输入 "系统记录 {内容}"
    ↓
系统指令执行者接收消息
    ↓
解析指令类型和内容
    ↓
创建 UserRecord 对象
    ├─ 自动提取标签
    ├─ 设置重要程度
    └─ 关联当前上下文
    ↓
保存到用户记录存储
    ↓
返回确认消息
```

### 5.4 记录存储

```typescript
interface UserRecordStore {
  save(record: UserRecord): Promise<void>;
  query(userId: string, filter: RecordFilter): Promise<UserRecord[]>;
  delete(recordId: string): Promise<void>;
  export(userId: string, format: 'json' | 'csv'): Promise<string>;
}

interface RecordFilter {
  type?: RecordType;
  startDate?: number;
  endDate?: number;
  tags?: string[];
  keywords?: string;
  importance?: ImportanceLevel;
}
```

---

## 6. 消息总线实现

### 6.1 核心接口

```typescript
interface MessageBus {
  register(actor: ActorRegistration): Promise<void>;
  unregister(actorAddress: ActorAddress): Promise<void>;
  subscribe(topic: string, handler: MessageHandler): void;
  unsubscribe(topic: string, handler: MessageHandler): void;
  publish(message: Message): Promise<void>;
  send(target: ActorAddress, message: Message): Promise<Message>;
  broadcast(message: Message): Promise<void>;
}

type MessageHandler = (message: Message) => Promise<void | Message>;
```

### 6.2 消息路由规则

```typescript
interface RoutingRule {
  topic: string;
  source?: ActorAddress;
  target?: ActorAddress;
  capability?: string;
  handler: string;  // 目标执行者名称
  priority: number;
}

class MessageRouter {
  private rules: RoutingRule[] = [];
  
  route(message: Message): ActorAddress[] {
    const matchedRules = this.rules
      .filter(rule => this.matchRule(rule, message))
      .sort((a, b) => b.priority - a.priority);
    
    return matchedRules.map(rule => this.parseAddress(rule.handler));
  }
  
  private matchRule(rule: RoutingRule, message: Message): boolean {
    if (rule.topic && rule.topic !== message.topic) return false;
    if (rule.source && !this.addressMatch(rule.source, message.source)) return false;
    if (rule.capability && !this.hasCapability(message.source, rule.capability)) return false;
    return true;
  }
}
```

### 6.3 消息过滤

执行者可以定义消息过滤器，只处理感兴趣的消息：

```typescript
interface MessageFilter {
  topics?: string[];
  types?: MessageType[];
  sources?: ActorAddress[];
  capabilities?: string[];
  custom?: (message: Message) => boolean;
}

class Actor {
  protected filter: MessageFilter;
  
  shouldProcess(message: Message): boolean {
    if (this.filter.topics && !this.filter.topics.includes(message.topic)) {
      return false;
    }
    if (this.filter.types && !this.filter.types.includes(message.type)) {
      return false;
    }
    if (this.filter.custom && !this.filter.custom(message)) {
      return false;
    }
    return true;
  }
}
```

---

## 7. 能力继承机制

### 7.1 继承模型

```typescript
interface CapabilityInheritance {
  capabilityId: string;
  inherits: string[];       // 继承的能力ID列表
  overrides?: {             // 覆盖的配置
    [key: string]: any;
  };
  extensions?: {            // 扩展的配置
    [key: string]: any;
  };
}

class CapabilityResolver {
  resolve(capabilityId: string): ResolvedCapability {
    const capability = this.getCapability(capabilityId);
    const inheritedCapabilities = capability.inherits?.map(id => this.resolve(id)) || [];
    
    return {
      ...capability,
      resolvedCapabilities: inheritedCapabilities,
      mergedConfig: this.mergeConfigs(capability, inheritedCapabilities)
    };
  }
  
  private mergeConfigs(capability: ActorCapability, inherited: ResolvedCapability[]): any {
    let config = {};
    for (const cap of inherited) {
      config = { ...config, ...cap.mergedConfig };
    }
    config = { ...config, ...capability.overrides };
    return config;
  }
}
```

### 7.2 继承示例

```typescript
const capabilities = {
  'llm-base': {
    id: 'llm-base',
    name: '语言模型基础能力',
    category: 'professional',
    level: 4,
    config: {
      model: 'gpt-4',
      maxTokens: 4096
    }
  },
  'chat': {
    id: 'chat',
    name: '聊天能力',
    inherits: ['llm-base'],
    extensions: {
      systemPrompt: '你是一个友好的助手'
    }
  },
  'code-assist': {
    id: 'code-assist',
    name: '代码辅助能力',
    inherits: ['llm-base'],
    extensions: {
      systemPrompt: '你是一个代码专家'
    }
  }
};
```

---

## 8. 分布式部署

### 8.1 节点架构

```
┌─────────────────────────────────────────────────────────────┐
│                     消息总线集群                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Node 1    │  │   Node 2    │  │   Node 3    │         │
│  │  (主节点)   │  │  (从节点)   │  │  (从节点)   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   执行者集群    │  │   执行者集群    │  │   执行者集群    │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
│  │  显示端   │  │  │  │  控制端   │  │  │  │  服务器   │  │
│  │  执行者   │  │  │  │  执行者   │  │  │  │  执行者   │  │
│  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 8.2 跨节点消息路由

```typescript
interface ClusterNode {
  id: string;
  address: string;
  status: 'leader' | 'follower' | 'candidate';
  actors: ActorAddress[];
  lastHeartbeat: number;
}

class ClusterRouter {
  private nodes: Map<string, ClusterNode> = new Map();
  
  async routeToActor(target: ActorAddress, message: Message): Promise<void> {
    const node = this.findActorNode(target);
    if (node) {
      await this.sendToNode(node, message);
    } else {
      throw new Error(`Actor not found: ${target.name}`);
    }
  }
  
  private findActorNode(target: ActorAddress): ClusterNode | null {
    for (const node of this.nodes.values()) {
      if (node.actors.some(a => 
        a.ip === target.ip && 
        a.role === target.role && 
        a.name === target.name
      )) {
        return node;
      }
    }
    return null;
  }
}
```

### 8.3 边缘计算支持

```typescript
interface EdgeDeployment {
  actorId: string;
  preferredLocation: 'server' | 'display' | 'control';
  fallbackLocation: 'server';
  resourceRequirements: {
    cpu: number;
    memory: number;
    microphone?: boolean;
    speaker?: boolean;
  };
}

class EdgeOrchestrator {
  deployActor(deployment: EdgeDeployment): ActorAddress {
    const candidates = this.findCandidateNodes(deployment);
    const selected = this.selectBestNode(candidates, deployment);
    return this.deployToNode(selected, deployment);
  }
  
  private findCandidateNodes(deployment: EdgeDeployment): ClusterNode[] {
    return Array.from(this.nodes.values()).filter(node => 
      this.meetsRequirements(node, deployment.resourceRequirements)
    );
  }
}
```

---

## 9. 安全与权限

### 9.1 身份认证

```typescript
interface Authentication {
  authenticate(token: string): Promise<User>;
  generateToken(user: User): Promise<string>;
  validateToken(token: string): Promise<boolean>;
}

class JWTAuthentication implements Authentication {
  async authenticate(token: string): Promise<User> {
    const decoded = this.verifyToken(token);
    const user = await this.userStore.findById(decoded.userId);
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }
}
```

### 9.2 权限控制

```typescript
interface Authorization {
  checkPermission(user: User, action: string, resource: string): Promise<boolean>;
  grantPermission(user: User, permission: Permission): Promise<void>;
  revokePermission(user: User, permission: string): Promise<void>;
}

class RBACAuthorization implements Authorization {
  async checkPermission(user: User, action: string, resource: string): Promise<boolean> {
    const role = await this.getRole(user.role);
    return role.permissions.some(p => 
      p.action === action && p.resource === resource
    );
  }
}
```

### 9.3 消息安全

```typescript
interface SecureMessage extends Message {
  signature: string;        // 消息签名
  encrypted?: boolean;      // 是否加密
  accessLevel: SecurityLevel;  // 访问等级要求
}

class MessageSecurity {
  sign(message: Message, privateKey: string): SecureMessage {
    const signature = this.generateSignature(message, privateKey);
    return { ...message, signature, accessLevel: SecurityLevel.PUBLIC };
  }
  
  verify(message: SecureMessage, publicKey: string): boolean {
    const expectedSignature = this.generateSignature(message, publicKey);
    return message.signature === expectedSignature;
  }
  
  canAccess(user: User, message: SecureMessage): boolean {
    return user.securityLevel >= message.accessLevel;
  }
}
```

---

## 10. 迁移方案

### 10.1 迁移阶段

| 阶段 | 内容 | 预计时间 |
|------|------|----------|
| 第一阶段 | 实现消息总线和基础执行者抽象 | 2周 |
| 第二阶段 | 迁移现有功能模块为执行者 | 3周 |
| 第三阶段 | 实现用户模型和权限系统 | 2周 |
| 第四阶段 | 实现能力继承和分布式支持 | 2周 |
| 第五阶段 | 测试和优化 | 1周 |

### 10.2 模块映射

| 现有模块 | 执行者名称 | 能力等级 |
|----------|------------|----------|
| server.js | 消息路由执行者 | L5 |
| core/voiceCommand.js | 语音命令执行者 | L4 |
| core/chat.js | 聊天执行者 | L4 |
| core/reminder.js | 提醒执行者 | L2 |
| core/tts.js | 语音合成执行者 | L3 |
| core/timeAnnounce.js | 整点报时执行者 | L2 |
| core/media-library.js | 媒体库执行者 | L3 |
| public/js/controls.js | 显示控制执行者 | L3 |

### 10.3 兼容性策略

迁移期间保持向后兼容：

```typescript
class LegacyAdapter {
  convertLegacyMessage(legacyMsg: any): Message {
    return {
      id: this.generateId(),
      version: '1.0',
      type: this.mapMessageType(legacyMsg.type),
      priority: Priority.NORMAL,
      timestamp: Date.now(),
      source: this.parseLegacySource(legacyMsg),
      topic: this.mapTopic(legacyMsg.type),
      payload: legacyMsg.data
    };
  }
}
```

---

## 11. 附录

### 11.1 执行者配置示例

```json
{
  "actors": [
    {
      "name": "voice-command",
      "role": "server",
      "capabilities": [
        {
          "id": "voice-recognition",
          "category": "professional",
          "level": 3
        },
        {
          "id": "command-parsing",
          "category": "basic",
          "level": 2
        }
      ],
      "subscribes": ["voice", "chat"],
      "securityLevel": 1
    },
    {
      "name": "media-player",
      "role": "display",
      "capabilities": [
        {
          "id": "media-rendering",
          "category": "special",
          "level": 3
        },
        {
          "id": "voice-output",
          "category": "professional",
          "level": 3
        }
      ],
      "subscribes": ["media.control", "media.status"],
      "securityLevel": 0
    }
  ]
}
```

### 11.2 消息示例

```json
{
  "id": "msg_abc123",
  "version": "1.0",
  "type": "command",
  "priority": 1,
  "timestamp": 1704067200000,
  "source": {
    "ip": "192.168.1.100",
    "role": "control",
    "name": "mobile-app"
  },
  "target": {
    "ip": "192.168.1.200",
    "role": "display",
    "name": "living-room"
  },
  "topic": "media.control",
  "payload": {
    "action": "play",
    "media": {
      "type": "video",
      "url": "http://192.168.1.1:8081/media/video.mp4"
    }
  }
}
```

---

## 12. 能力组合系统

### 12.1 概述

能力组合系统允许执行者通过组合多个原子能力来实现更复杂的功能。每个能力都是系统实现的一个独立功能单元，能力之间可以通过管道（Pipeline）方式进行组合。

**核心原则：能力与执行者解耦**
- 能力是独立定义的功能单元，不绑定到特定执行者
- 一个能力可以被多个执行者共享使用
- 执行者通过能力ID引用能力，声明自己拥有哪些能力
- 能力的执行由具备该能力的执行者来完成

### 12.2 核心概念

#### 12.2.1 原子能力（Atomic Capability）

原子能力是系统中最小的功能单元，不可再分：

```typescript
interface AtomicCapability {
  id: string;                    // 能力唯一标识
  name: string;                  // 能力名称
  category: CapabilityCategory;  // 能力分类
  level: CapabilityLevel;        // 能力等级 (1-5)
  securityLevel: SecurityLevel;  // 保密等级 (0-5)
  description: string;           // 能力描述
  inputSchema: JSONSchema;       // 输入参数模式
  outputSchema: JSONSchema;      // 输出参数模式
  defaultExecutor: string;       // 默认执行者名称（可选）
  defaultHandler: string;        // 默认处理方法名（可选）
  timeout: number;               // 超时时间（毫秒）
  retryPolicy: RetryPolicy;      // 重试策略
}

interface RetryPolicy {
  maxRetries: number;            // 最大重试次数
  backoff: 'fixed' | 'exponential';
  interval: number;              // 重试间隔
}
```

#### 12.2.2 能力与执行者的关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                         能力注册表（全局）                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ time-parser │  │voice-broadcast│ │display-text │                 │
│  │   (L2)      │  │    (L3)       │  │   (L2)      │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│         ↑                ↑                ↑                        │
│         │                │                │                        │
│    ┌────┴────┐      ┌────┴────┐      ┌────┴────┐                   │
│    │         │      │         │      │         │                   │
│  ┌─┴───────┐ │    ┌─┴───────┐ │    ┌─┴───────┐ │                   │
│  │ 报时Actor│ │    │ 提醒Actor│ │    │ 天气Actor│ │                   │
│  │         │ │    │         │ │    │         │ │                   │
│  │ ✓ time  │ │    │ ✓ time  │ │    │         │ │                   │
│  │ ✓ voice │ │    │ ✓ voice │ │    │ ✓ voice │ │                   │
│  │ ✓display│ │    │         │ │    │ ✓display│ │                   │
│  └─────────┘ │    └─────────┘ │    └─────────┘ │                   │
│              │              │              │                        │
│  ┌───────────┴─┐  ┌─────────┴──┐  ┌───────┴────┐                   │
│  │  TTS Actor  │  │Display Actor│  │ Chat Actor │                   │
│  │             │  │             │  │            │                   │
│  │ ✓ voice     │  │ ✓ display   │  │ ✓ chat     │                   │
│  └─────────────┘  └─────────────┘  └────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘

说明：
- time-parser 能力被 报时Actor、提醒Actor 共享使用
- voice-broadcast 能力被 报时Actor、提醒Actor、天气Actor、TTS Actor 共享使用
- display-text 能力被 报时Actor、天气Actor、Display Actor 共享使用
```

#### 12.2.3 执行者能力声明

执行者通过能力ID列表声明自己拥有的能力：

```typescript
interface ActorCapabilityRef {
  capabilityId: string;          // 能力ID（引用全局能力）
  executor: string;              // 执行者名称（覆盖默认执行者）
  handler?: string;              // 处理方法（覆盖默认处理方法）
  config?: object;               // 能力配置（覆盖默认配置）
}

class Actor {
  constructor(options) {
    this.capabilities = options.capabilities.map(ref => {
      if (typeof ref === 'string') {
        return { capabilityId: ref };
      }
      return ref;
    });
  }
}
```

#### 12.2.4 能力组合（Capability Composition）

能力组合定义了多个能力如何协同工作：

```typescript
interface CapabilityComposition {
  id: string;                    // 组合唯一标识
  name: string;                  // 组合名称
  description: string;           // 组合描述
  trigger: CompositionTrigger;   // 触发条件
  pipeline: PipelineStep[];      // 执行管道
  fallback: PipelineStep[];      // 降级管道
  timeout: number;               // 总超时时间
  parallel: boolean;             // 是否并行执行
}

interface CompositionTrigger {
  type: 'command' | 'event' | 'schedule' | 'message';
  pattern: string;               // 匹配模式（正则或精确匹配）
  topic?: string;                // 消息主题
  priority: number;              // 优先级
}

interface PipelineStep {
  capabilityId: string;          // 能力ID
  inputMapping: InputMapping;    // 输入映射
  outputMapping: OutputMapping;  // 输出映射
  condition?: Condition;         // 执行条件
  onError: 'skip' | 'abort' | 'fallback';
}

interface InputMapping {
  static?: object;               // 静态参数
  fromContext?: string[];        // 从上下文获取
  fromPrevious?: string;         // 从上一步输出获取
  transform?: TransformFunction; // 转换函数
}

interface OutputMapping {
  toContext?: string;            // 存储到上下文
  transform?: TransformFunction; // 转换函数
}
```

### 12.3 能力管道（Pipeline）

#### 12.3.1 管道执行流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                         能力管道执行流程                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  输入 ──→ [步骤1] ──→ [步骤2] ──→ [步骤3] ──→ 输出                   │
│           │           │           │                                │
│           ▼           ▼           ▼                                │
│        能力A       能力B       能力C                                │
│           │           │           │                                │
│           ▼           ▼           ▼                                │
│        输出1 ────→ 输入2 ────→ 输出2 ────→ 输入3 ────→ 最终输出       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 12.3.2 管道执行器

```typescript
class PipelineExecutor {
  private registry: CapabilityRegistry;
  private context: ExecutionContext;

  async execute(composition: CapabilityComposition, input: any): Promise<PipelineResult> {
    this.context = new ExecutionContext(input);
    
    const steps = composition.parallel 
      ? await this.executeParallel(composition.pipeline)
      : await this.executeSequential(composition.pipeline);

    return {
      success: steps.every(s => s.success),
      output: this.context.getFinalOutput(),
      steps: steps,
      context: this.context.toJSON()
    };
  }

  private async executeSequential(steps: PipelineStep[]): Promise<StepResult[]> {
    const results = [];
    
    for (const step of steps) {
      if (step.condition && !this.evaluateCondition(step.condition)) {
        continue;
      }

      const input = this.mapInput(step.inputMapping);
      const result = await this.executeStep(step, input);
      
      if (result.success) {
        this.mapOutput(step.outputMapping, result.output);
      } else if (step.onError === 'abort') {
        break;
      } else if (step.onError === 'fallback') {
        return this.executeFallback(step);
      }
      
      results.push(result);
    }
    
    return results;
  }

  private async executeStep(step: PipelineStep, input: any): Promise<StepResult> {
    const capability = this.registry.resolve(step.capabilityId);
    
    try {
      const output = await this.invokeCapability(capability, input, step.timeout);
      return { success: true, output, capabilityId: step.capabilityId };
    } catch (error) {
      return { success: false, error: error.message, capabilityId: step.capabilityId };
    }
  }
}
```

### 12.4 能力等级评估

#### 12.4.1 执行者能力等级

执行者的能力等级由其拥有的所有能力综合评估得出：

```typescript
interface ActorCapabilityScore {
  actorId: string;
  overallLevel: number;          // 综合等级 (1-5)
  capabilityCount: number;       // 能力数量
  maxLevel: number;              // 最高能力等级
  avgLevel: number;              // 平均能力等级
  categories: CategoryScore[];   // 各分类得分
  composition: CompositionScore[]; // 组合能力得分
}

interface CategoryScore {
  category: CapabilityCategory;
  count: number;
  maxLevel: number;
  avgLevel: number;
}

interface CompositionScore {
  compositionId: string;
  name: string;
  effectiveLevel: number;        // 有效等级
}
```

#### 12.4.2 等级计算规则

```typescript
class CapabilityLevelCalculator {
  calculateActorLevel(actor: ActorRegistration): ActorCapabilityScore {
    const capabilities = actor.capabilities;
    
    const maxLevel = Math.max(...capabilities.map(c => c.level));
    const avgLevel = capabilities.reduce((sum, c) => sum + c.level, 0) / capabilities.length;
    
    const categoryScores = this.calculateCategoryScores(capabilities);
    
    const compositionScores = this.calculateCompositionScores(actor);
    
    const overallLevel = this.calculateOverallLevel({
      maxLevel,
      avgLevel,
      capabilityCount: capabilities.length,
      categoryScores,
      compositionScores
    });

    return {
      actorId: actor.address.toString(),
      overallLevel,
      capabilityCount: capabilities.length,
      maxLevel,
      avgLevel,
      categories: categoryScores,
      composition: compositionScores
    };
  }

  private calculateOverallLevel(params: CalculateParams): number {
    const { maxLevel, avgLevel, capabilityCount, categoryScores, compositionScores } = params;
    
    let score = maxLevel * 0.4 + avgLevel * 0.3;
    
    const categoryBonus = categoryScores.length * 0.1;
    score += Math.min(categoryBonus, 0.5);
    
    const compositionBonus = compositionScores.length * 0.05;
    score += Math.min(compositionBonus, 0.5);
    
    const countBonus = Math.min(capabilityCount / 10, 0.3);
    score += countBonus;
    
    return Math.min(Math.round(score), 5);
  }
}
```

### 12.5 能力配置系统

#### 12.5.1 配置文件结构

```json
{
  "version": "1.0",
  "capabilities": [
    {
      "id": "time-parser",
      "name": "时间解析",
      "category": "basic",
      "level": 2,
      "description": "解析自然语言时间表达式",
      "inputSchema": {
        "type": "object",
        "properties": {
          "expression": { "type": "string", "description": "时间表达式" }
        },
        "required": ["expression"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "timestamp": { "type": "number" },
          "formatted": { "type": "string" }
        }
      }
    },
    {
      "id": "voice-broadcast",
      "name": "语音播报",
      "category": "professional",
      "level": 3,
      "description": "文字转语音并播报",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "displayId": { "type": "string" }
        },
        "required": ["text"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "audioUrl": { "type": "string" },
          "success": { "type": "boolean" }
        }
      }
    },
    {
      "id": "display-text",
      "name": "文本显示",
      "category": "basic",
      "level": 2,
      "description": "在显示端显示文本内容",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "displayId": { "type": "string" }
        },
        "required": ["text"]
      }
    }
  ],
  "compositions": [
    {
      "id": "time-announce",
      "name": "报时功能",
      "description": "组合时间解析、语音播报、文本显示实现报时",
      "trigger": {
        "type": "command",
        "pattern": "^(报时|现在几点)$"
      },
      "pipeline": [
        {
          "capabilityId": "time-parser",
          "inputMapping": {
            "static": { "expression": "现在" }
          },
          "outputMapping": {
            "toContext": "parsedTime"
          }
        },
        {
          "capabilityId": "voice-broadcast",
          "inputMapping": {
            "fromContext": ["parsedTime.formatted"],
            "transform": "formatTimeAnnounce"
          },
          "outputMapping": {
            "toContext": "broadcastResult"
          }
        },
        {
          "capabilityId": "display-text",
          "inputMapping": {
            "fromContext": ["parsedTime.formatted"]
          },
          "onError": "skip"
        }
      ],
      "timeout": 10000
    }
  ]
}
```

#### 12.5.2 配置管理器

```typescript
class CapabilityConfigManager {
  private configPath: string;
  private capabilities: Map<string, AtomicCapability>;
  private compositions: Map<string, CapabilityComposition>;

  load(configPath: string): void {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    this.capabilities.clear();
    for (const cap of config.capabilities) {
      this.capabilities.set(cap.id, cap);
    }
    
    this.compositions.clear();
    for (const comp of config.compositions) {
      this.validateComposition(comp);
      this.compositions.set(comp.id, comp);
    }
  }

  private validateComposition(composition: CapabilityComposition): void {
    for (const step of composition.pipeline) {
      if (!this.capabilities.has(step.capabilityId)) {
        throw new Error(`Unknown capability: ${step.capabilityId}`);
      }
    }
  }

  addComposition(composition: CapabilityComposition): void {
    this.validateComposition(composition);
    this.compositions.set(composition.id, composition);
    this.save();
  }

  removeComposition(compositionId: string): boolean {
    const result = this.compositions.delete(compositionId);
    if (result) {
      this.save();
    }
    return result;
  }

  getComposition(trigger: string): CapabilityComposition | null {
    for (const comp of this.compositions.values()) {
      if (this.matchTrigger(comp.trigger, trigger)) {
        return comp;
      }
    }
    return null;
  }

  private matchTrigger(trigger: CompositionTrigger, input: string): boolean {
    const regex = new RegExp(trigger.pattern, 'i');
    return regex.test(input);
  }
}
```

### 12.6 示例：报时功能完整实现

#### 12.6.1 能力定义

```javascript
const timeParserCapability = {
  id: 'time-parser',
  name: '时间解析',
  category: 'basic',
  level: 2,
  description: '解析自然语言时间表达式',
  executor: 'time-actor',
  handler: 'parseTime',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '时间表达式，如"现在"、"明天上午10点"' }
    },
    required: ['expression']
  },
  outputSchema: {
    type: 'object',
    properties: {
      timestamp: { type: 'number', description: 'Unix时间戳' },
      formatted: { type: 'string', description: '格式化的时间字符串' },
      date: { type: 'string', description: '日期部分' },
      time: { type: 'string', description: '时间部分' }
    }
  }
};

const voiceBroadcastCapability = {
  id: 'voice-broadcast',
  name: '语音播报',
  category: 'professional',
  level: 3,
  description: '文字转语音并播报',
  executor: 'tts-actor',
  handler: 'broadcast',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要播报的文本' },
      displayId: { type: 'string', description: '目标显示端ID' },
      showText: { type: 'boolean', description: '是否同时显示文本' }
    },
    required: ['text']
  },
  outputSchema: {
    type: 'object',
    properties: {
      audioUrl: { type: 'string' },
      success: { type: 'boolean' }
    }
  }
};
```

#### 12.6.2 组合定义

```javascript
const timeAnnounceComposition = {
  id: 'time-announce',
  name: '报时功能',
  description: '组合时间解析、语音播报、文本显示实现报时',
  trigger: {
    type: 'command',
    pattern: '^(报时|现在几点)$',
    priority: 1
  },
  pipeline: [
    {
      capabilityId: 'time-parser',
      inputMapping: {
        static: { expression: '现在' }
      },
      outputMapping: {
        toContext: 'parsedTime'
      },
      onError: 'abort'
    },
    {
      capabilityId: 'voice-broadcast',
      inputMapping: {
        fromContext: ['parsedTime.formatted'],
        transform: (time) => `现在是${time}`
      },
      outputMapping: {
        toContext: 'broadcastResult'
      },
      onError: 'fallback'
    },
    {
      capabilityId: 'display-text',
      inputMapping: {
        fromContext: ['parsedTime.formatted']
      },
      onError: 'skip'
    }
  ],
  fallback: [
    {
      capabilityId: 'display-text',
      inputMapping: {
        fromContext: ['parsedTime.formatted']
      }
    }
  ],
  timeout: 10000
};
```

#### 12.6.3 执行流程

```
用户输入: "报时"
    ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤1: time-parser                                              │
│   输入: { expression: "现在" }                                   │
│   输出: { timestamp: 1704067200, formatted: "2024年1月1日 12:00" }│
│   上下文: parsedTime = { ... }                                   │
├─────────────────────────────────────────────────────────────────┤
│ 步骤2: voice-broadcast                                          │
│   输入: { text: "现在是2024年1月1日 12:00" }                      │
│   输出: { audioUrl: "/uploads/tts/xxx.mp3", success: true }      │
│   上下文: broadcastResult = { ... }                              │
├─────────────────────────────────────────────────────────────────┤
│ 步骤3: display-text                                             │
│   输入: { text: "2024年1月1日 12:00" }                           │
│   输出: { success: true }                                        │
└─────────────────────────────────────────────────────────────────┘
    ↓
返回结果: { success: true, output: "现在是2024年1月1日 12:00" }
```

### 12.7 能力组合配置示例

#### 12.7.1 天气播报组合

```javascript
const weatherAnnounceComposition = {
  id: 'weather-announce',
  name: '天气播报',
  trigger: {
    type: 'command',
    pattern: '^(天气|今天天气|查询天气)$'
  },
  pipeline: [
    {
      capabilityId: 'weather-fetch',
      inputMapping: {
        static: { location: 'auto' }
      },
      outputMapping: {
        toContext: 'weatherData'
      }
    },
    {
      capabilityId: 'weather-format',
      inputMapping: {
        fromContext: ['weatherData']
      },
      outputMapping: {
        toContext: 'weatherText'
      }
    },
    {
      capabilityId: 'voice-broadcast',
      inputMapping: {
        fromContext: ['weatherText']
      }
    },
    {
      capabilityId: 'display-text',
      inputMapping: {
        fromContext: ['weatherText']
      },
      onError: 'skip'
    }
  ]
};
```

#### 12.7.2 提醒播报组合

```javascript
const reminderAnnounceComposition = {
  id: 'reminder-announce',
  name: '提醒播报',
  trigger: {
    type: 'event',
    topic: 'reminder.triggered'
  },
  pipeline: [
    {
      capabilityId: 'reminder-get',
      inputMapping: {
        fromContext: ['event.reminderId']
      },
      outputMapping: {
        toContext: 'reminderData'
      }
    },
    {
      capabilityId: 'voice-broadcast',
      inputMapping: {
        fromContext: ['reminderData.content'],
        transform: (content) => `提醒：${content}`
      }
    }
  ]
};
```

### 12.8 能力组合与执行者的关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                           执行者层级结构                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    报时执行者 (TimeActor)                     │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │              能力组合: time-announce                  │    │   │
│  │  │  ┌─────────┐   ┌─────────┐   ┌─────────┐           │    │   │
│  │  │  │时间解析 │ ─→│语音播报 │ ─→│文本显示 │           │    │   │
│  │  │  │ (L2)   │   │ (L3)   │   │ (L2)   │           │    │   │
│  │  │  └─────────┘   └─────────┘   └─────────┘           │    │   │
│  │  │       ↑             ↑             ↑                │    │   │
│  │  │       │             │             │                │    │   │
│  │  │  ┌────┴────┐   ┌────┴────┐   ┌────┴────┐          │    │   │
│  │  │  │TimeActor│   │TTSActor │   │Display  │          │    │   │
│  │  │  │         │   │         │   │Actor    │          │    │   │
│  │  │  └─────────┘   └─────────┘   └─────────┘          │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  │                                                              │   │
│  │  综合能力等级: L3 (max(L2,L3,L2) + 组合加成)                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.9 能力组合的优势

1. **灵活组合**：通过配置实现功能组合，无需修改代码
2. **能力复用**：同一能力可被多个组合使用
3. **等级提升**：组合能力可提升执行者的整体能力等级
4. **降级处理**：支持 fallback 机制，提高系统可靠性
5. **并行执行**：支持并行执行多个能力，提高效率
6. **条件执行**：支持条件判断，实现复杂逻辑

---

## 13. AASC 四层架构设计

### 13.1 架构概述

AASC (Advance Action System Control) 四层架构是对原有执行者模型的进一步抽象和模块化：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        System 层 (系统层)                            │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    WebSocketSystem                             │ │
│  │  - 初始化和管理所有 Actor                                      │ │
│  │  - 协调消息总线 (MessageBus)                                   │ │
│  │  - 处理 WebSocket 连接生命周期                                 │ │
│  │  - 提供系统级 API (sendToDisplay, broadcastToControls)        │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│    Actor 层       │ │    Actor 层       │ │    Actor 层       │
│ VoiceCommandActor │ │    ChatActor      │ │ MediaControlActor │
│                   │ │                   │ │                   │
│ - 消息路由        │ │ - 消息路由        │ │ - 消息路由        │
│ - Agent 组合      │ │ - Agent 组合      │ │ - Agent 组合      │
│ - 能力声明        │ │ - 能力声明        │ │ - 能力声明        │
└───────────────────┘ └───────────────────┘ └───────────────────┘
            │                 │                 │
            ▼                 ▼                 ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│    Agent 层       │ │    Agent 层       │ │    Agent 层       │
│ VoiceCommandAgent │ │    ChatAgent      │ │ MediaControlAgent │
│                   │ │                   │ │                   │
│ - 业务逻辑        │ │ - 业务逻辑        │ │ - 业务逻辑        │
│ - 能力实现        │ │ - 能力实现        │ │ - 能力实现        │
│ - 依赖注入        │ │ - 依赖注入        │ │ - 依赖注入        │
└───────────────────┘ └───────────────────┘ └───────────────────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Component 层 (组件层)                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │  MessageParser  │  │   Dispatcher    │  │  StateManager   │     │
│  │                 │  │                 │  │                 │     │
│  │  - 消息解析     │  │  - 消息路由     │  │  - 状态存储     │     │
│  │  - 消息验证     │  │  - 处理器注册   │  │  - 状态变更     │     │
│  │  - 消息转换     │  │  - 中间件链     │  │  - 历史记录     │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.2 各层职责

#### 13.2.1 System 层

System 层是整个架构的顶层协调者：

```typescript
interface WebSocketSystemInterface {
    bus: MessageBus;              // 消息总线
    parser: MessageParser;        // 消息解析器
    dispatcher: MessageDispatcher; // 消息分发器
    stateManager: StateManager;   // 状态管理器
    actors: Map<string, Actor>;   // Actor 注册表
    agents: Map<string, Agent>;   // Agent 注册表
    
    initialize(): Promise<void>;  // 初始化系统
    registerActor(name: string, actor: Actor): void; // 注册 Actor
    registerAgent(name: string, agent: Agent): void; // 注册 Agent
    use(middleware: Middleware): void; // 添加中间件
    
    handleDisplayMessage(displayId: string, message: any, ws: WebSocket): Promise<Result>;
    handleControlMessage(message: any, ws: WebSocket): Promise<Result>;
    handleDisplayConnect(displayId: string, clientIP: string, ws: WebSocket): void;
    handleDisplayDisconnect(displayId: string): void;
    handleControlConnect(ws: WebSocket): void;
    handleControlDisconnect(ws: WebSocket): void;
    
    sendToDisplay(displayId: string, data: any): void;
    broadcastToControls(data: any): void;
    getDisplayList(): DisplayInfo[];
    getStats(): SystemStats;
    shutdown(): Promise<void>;
}
```

#### 13.2.2 Actor 层

Actor 层负责消息路由和 Agent 组合：

```typescript
interface ActorInterface {
    name: string;                 // Actor 名称
    capabilities: Capability[];   // 能力列表
    agents: Agent[];              // 组合的 Agent 列表
    supportedTypes: string[];     // 支持的消息类型
    
    init(): Promise<void>;        // 初始化
    destroy(): Promise<void>;     // 销毁
    canHandle(messageType: string): boolean; // 检查是否能处理
    handle(message: Message, context: Context): Promise<Result>; // 处理消息
}
```

#### 13.2.3 Agent 层

Agent 层实现具体的业务逻辑：

```typescript
interface AgentInterface {
    name: string;                 // Agent 名称
    description: string;          // Agent 描述
    capabilities: Capability[];   // 能力列表
    dependencies: string[];       // 依赖列表
    
    init(): Promise<void>;        // 初始化
    destroy(): Promise<void>;     // 销毁
    execute(action: string, params: any, context: Context): Promise<Result>;
    hasCapability(capabilityId: string): boolean;
}
```

#### 13.2.4 Component 层

Component 层提供可复用的基础组件：

```typescript
interface MessageParserInterface {
    parse(rawMessage: any): ParsedMessage;
    parseToMessage(rawMessage: any, source: ActorAddress): Message;
    validate(data: any): ValidationResult;
    transform(data: any): any;
    registerValidator(field: string, validator: Validator): void;
    registerTransformer(field: string, transformer: Transformer): void;
}

interface MessageDispatcherInterface {
    dispatch(message: Message, context: Context): Promise<Result>;
    registerRoute(route: RoutingRule): void;
    registerHandler(type: string, handler: Handler): void;
    use(middleware: Middleware): void;
    setDefaultHandler(handler: Handler): void;
}

interface StateManagerInterface {
    get(name: string, defaultValue?: any): any;
    set(name: string, value: any): void;
    update(name: string, updater: (value: any) => any): void;
    delete(name: string): void;
    
    getDisplayClient(displayId: string): DisplayClient | undefined;
    setDisplayClient(displayId: string, data: DisplayClientData): void;
    removeDisplayClient(displayId: string): void;
    getDisplayList(): DisplayInfo[];
}
```

### 13.3 消息处理流程

```
WebSocket 消息到达
    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ System 层                                                            │
│   handleDisplayMessage / handleControlMessage                        │
│   ↓                                                                  │
│   MessageParser.parse() → 解析消息                                   │
│   ↓                                                                  │
│   中间件链执行 → 验证、日志、限流等                                   │
│   ↓                                                                  │
│   MessageDispatcher.dispatch() → 路由分发                            │
└─────────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Actor 层                                                            │
│   根据 message.type 查找对应的 Actor                                 │
│   ↓                                                                  │
│   Actor.canHandle() → 检查是否能处理                                 │
│   ↓                                                                  │
│   Actor.handle() → 调用 Agent 处理                                   │
└─────────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Agent 层                                                            │
│   Agent.execute(action, params, context)                            │
│   ↓                                                                  │
│   执行具体业务逻辑                                                   │
│   ↓                                                                  │
│   调用外部模块 (voiceCommand, chat, tts 等)                          │
│   ↓                                                                  │
│   返回处理结果                                                       │
└─────────────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Component 层                                                        │
│   StateManager 更新状态                                              │
│   ↓                                                                  │
│   记录历史、触发事件等                                               │
└─────────────────────────────────────────────────────────────────────┘
    ↓
返回响应给 WebSocket 客户端
```

### 13.4 中间件系统

中间件用于处理横切关注点：

```typescript
interface Middleware {
    name: string;
    execute(message: Message, context: Context, next: NextFunction): Promise<Result>;
}

const middlewares = {
    ValidationMiddleware: {
        name: 'validation',
        execute: async (message, context, next) => {
            const validation = validateMessage(message);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            return next();
        }
    },
    
    LoggingMiddleware: {
        name: 'logging',
        execute: async (message, context, next) => {
            const startTime = Date.now();
            console.log(`[${message.type}] 处理开始`);
            const result = await next();
            console.log(`[${message.type}] 处理完成, 耗时: ${Date.now() - startTime}ms`);
            return result;
        }
    },
    
    ErrorHandlingMiddleware: {
        name: 'error-handling',
        execute: async (message, context, next) => {
            try {
                return await next();
            } catch (error) {
                console.error(`[${message.type}] 处理错误:`, error);
                return { success: false, error: error.message };
            }
        }
    },
    
    RateLimitMiddleware: {
        name: 'rate-limit',
        execute: async (message, context, next) => {
            const key = `${context.sourceIp}:${message.type}`;
            if (isRateLimited(key)) {
                return { success: false, error: '请求过于频繁' };
            }
            return next();
        }
    },
    
    TimeoutMiddleware: {
        name: 'timeout',
        execute: async (message, context, next) => {
            return Promise.race([
                next(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('处理超时')), 30000)
                )
            ]);
        }
    }
};
```

### 13.5 扩展新功能

添加新功能的步骤：

1. **创建 Agent**：实现业务逻辑
2. **创建 Actor 适配器**：将 Agent 包装为 Actor
3. **注册到 System**：将 Actor 添加到系统

```javascript
const { BaseAgent, AgentActorAdapter, WebSocketSystem } = require('./aasc');

class MyFeatureAgent extends BaseAgent {
    constructor(options) {
        super({
            name: 'my-feature-agent',
            description: '新功能 Agent',
            capabilities: [
                { id: 'my-feature', name: '新功能', category: 'professional', level: 3 }
            ],
            ...options
        });
        this.myDependency = options.myDependency;
    }
    
    async myAction(params, context) {
        return { success: true, data: '处理结果' };
    }
}

const agent = new MyFeatureAgent({ myDependency: myModule });
const actor = AgentActorAdapter.createFromAgent(agent, {
    name: 'my-feature-actor',
    supportedTypes: ['myType'],
    actionMap: { 'myType': 'myAction' }
});

await actor.init();
wsSystem.registerActor('my-feature-actor', actor);
```

### 13.6 与原有架构的关系

AASC 四层架构是对原有执行者模型的增强：

| 原有概念 | AASC 对应 | 说明 |
|----------|-----------|------|
| Actor | Actor 层 | 保持不变，增加 Agent 组合 |
| Capability | Agent 层的能力 | 能力由 Agent 实现 |
| Message | Component 层 | 消息解析由 MessageParser 处理 |
| MessageBus | System 层 | 由 WebSocketSystem 协调 |
| 无 | Component 层 | 新增可复用组件层 |
| 无 | 中间件 | 新增横切关注点处理 |

### 13.7 优势

1. **模块化**：各层职责清晰，易于理解和维护
2. **可扩展**：通过注册新 Actor/Agent 轻松扩展功能
3. **可测试**：各层可独立测试
4. **可复用**：Component 层组件可在不同场景复用
5. **松耦合**：通过依赖注入和接口解耦
6. **中间件**：横切关注点集中处理，避免代码重复
7. **向后兼容**：保留 fallback 机制，平滑迁移
