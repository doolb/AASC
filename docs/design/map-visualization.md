# 地图可视化设计文档

## 概述

执行者和能力的可视化管理系统，采用2D地图方案展示系统中的执行者（人物）和物理设备（房子），支持后续扩展3D可视化。

## 设计目标

1. **可视化展示**：直观展示系统中的执行者、能力、物理设备
2. **实时状态**：显示执行者的实时状态变化
3. **交互操作**：支持点击查看详情、拖拽移动等交互
4. **可扩展性**：支持从2D平滑过渡到3D

## 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                    数据层 (Data Layer)                   │
│  MapData, BuildingData, ActorData, ConnectionData       │
│  与渲染无关的纯数据模型                                  │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                    适配层 (Adapter Layer)                │
│  DataAdapter: 将 ActorRegistry 数据转换为可视化数据     │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                    渲染层 (Renderer Layer)               │
│  ┌─────────────────┐    ┌─────────────────┐            │
│  │  Renderer2D     │    │  Renderer3D     │            │
│  │  (PixiJS)       │    │  (Three.js)     │            │
│  └─────────────────┘    └─────────────────┘            │
│          统一接口: IRenderer                             │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                    交互层 (Interaction Layer)            │
│  点击、拖拽、缩放、选择等（2D/3D通用逻辑）              │
└─────────────────────────────────────────────────────────┘
```

### 模块结构

```
public/js/map/
├── core/
│   ├── map-data.js        # 数据模型（与渲染无关）
│   ├── data-adapter.js    # 数据适配器
│   └── constants.js       # 常量定义
│
├── renderer/
│   ├── i-renderer.js      # 渲染器接口
│   ├── renderer-pixi.js   # PixiJS 2D渲染器
│   └── renderer-three.js  # Three.js 3D渲染器（后续）
│
├── sprites/
│   ├── building-sprite.js # 房子精灵
│   ├── actor-sprite.js    # 人物精灵
│   └── connection-line.js # 连接线
│
├── ui/
│   ├── detail-panel.js    # 详情面板
│   └── toolbar.js         # 工具栏
│
└── map-panel.js           # 地图面板入口
```

## 数据模型

### BuildingData（房子/物理设备）

```typescript
interface BuildingData {
  id: string;                              // 唯一标识
  type: 'server' | 'display' | 'control';  // 设备类型
  name: string;                            // 设备名称
  status: 'online' | 'offline' | 'busy';   // 设备状态
  
  // 位置信息
  position: {
    x: number;
    y: number;
  };
  
  // 尺寸
  size: {
    width: number;
    height: number;
  };
  
  // 元数据
  metadata: {
    ip: string;
    lastHeartbeat: number;
    resources?: {
      hasMicrophone?: boolean;
      hasSpeaker?: boolean;
      screenResolution?: { width: number; height: number };
    };
  };
  
  // 房子内的执行者
  actors: ActorData[];
}
```

### ActorData（执行者/人物）

```typescript
interface ActorData {
  id: string;                    // 唯一标识
  name: string;                  // 执行者名称
  address: ActorAddress;         // 执行者地址
  status: ActorStatus;           // 执行者状态
  
  // 能力信息
  capabilities: CapabilityInfo[];
  maxLevel: number;              // 最大能力等级 (1-5)
  
  // 可视化属性
  visual: {
    size: number;                // 人物大小（根据能力等级计算）
    color: string;               // 颜色（根据状态）
    accessories: string[];       // 服饰/装备（根据能力类型）
  };
  
  // 所属房子
  buildingId: string;
  
  // 位置（相对于房子）
  localPosition: {
    x: number;
    y: number;
  };
}

interface CapabilityInfo {
  id: string;
  name: string;
  category: 'basic' | 'professional' | 'special';
  level: number;
}
```

### ConnectionData（连接线）

```typescript
interface ConnectionData {
  id: string;
  sourceId: string;              // 源房子ID
  targetId: string;              // 目标房子ID
  type: 'active' | 'inactive';   // 连接状态
  messageCount: number;          // 消息数量（用于显示流量）
}
```

## 可视化规则

### 房子可视化

| 设备类型 | 图标 | 颜色 | 位置 |
|----------|------|------|------|
| server | 🏠 服务器机房 | #3498db (蓝) | 中心位置，固定 |
| display | 📺 显示端 | #2ecc71 (绿) | 围绕服务器分布 |
| control | 📱 控制端 | #e67e22 (橙) | 边缘位置 |

| 设备状态 | 视觉效果 |
|----------|----------|
| online | 正常显示，发光效果 |
| offline | 灰色显示，半透明 |
| busy | 黄色边框，脉冲动画 |

### 人物可视化

| 属性 | 可视化方式 |
|------|-----------|
| 状态 | 颜色/光环（ready=绿，busy=黄，offline=灰，initializing=蓝） |
| 能力等级 | 人物大小（L1=24px，L2=32px，L3=40px，L4=48px，L5=56px） |
| 能力类型 | 服饰/图标（basic=帽子，professional=披风，special=光环） |
| 能力数量 | 装备栏位显示 |

### 能力等级与大小映射

```javascript
const LEVEL_SIZE_MAP = {
  1: 24,   // L1 基础级
  2: 32,   // L2 标准级
  3: 40,   // L3 进阶级
  4: 48,   // L4 高级
  5: 56    // L5 专家级
};
```

### 状态与颜色映射

```javascript
const STATUS_COLOR_MAP = {
  'initializing': '#3498db',  // 蓝色
  'ready': '#2ecc71',         // 绿色
  'busy': '#f1c40f',          // 黄色
  'degraded': '#e67e22',      // 橙色
  'offline': '#95a5a6'        // 灰色
};
```

## 交互设计

### 基础交互

| 操作 | 效果 |
|------|------|
| 点击房子 | 显示房子详情面板 |
| 点击人物 | 显示执行者详情面板 |
| 拖拽画布 | 平移视图 |
| 滚轮 | 缩放视图 |
| 双击 | 聚焦到元素 |

### 详情面板

点击元素后显示详情面板：

**房子详情**：
- 设备名称、类型、IP地址
- 在线状态、最后心跳时间
- 房子内的执行者列表
- 资源信息

**执行者详情**：
- 执行者名称、地址
- 当前状态
- 能力列表（含等级、类型）
- 最近处理的消息

## 数据流

```
服务端 ActorRegistry
        ↓ WebSocket/HTTP API
前端 DataAdapter
        ↓ 转换
MapData
        ↓ 传入
Renderer.render()
        ↓ 绘制
Canvas/WebGL
```

## 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 2D渲染 | PixiJS | 高性能 WebGL 渲染 |
| 3D渲染 | Three.js | 后续扩展 |
| 数据通信 | WebSocket | 实时状态更新 |
| UI组件 | 原生 DOM | 详情面板、工具栏 |

## 性能考虑

1. **分层渲染**：背景层、建筑层、人物层分开渲染
2. **视口裁剪**：只渲染视口内的元素
3. **批量更新**：合并多次数据更新
4. **节流处理**：高频事件节流处理

## 扩展性设计

### 2D 到 3D 切换

通过统一的 `IRenderer` 接口，切换渲染器只需：

```javascript
// 2D 模式
const renderer = new RendererPixi();

// 3D 模式（后续）
const renderer = new RendererThree();
```

### 自定义主题

支持自定义颜色、图标等视觉元素：

```javascript
const theme = {
  building: {
    server: { color: '#3498db', icon: '🏠' },
    display: { color: '#2ecc71', icon: '📺' },
    control: { color: '#e67e22', icon: '📱' }
  },
  actor: {
    statusColors: { ... },
    levelSizes: { ... }
  }
};
```

## 相关文档

- [实现文档](../spec/map-visualization.md)
- [AASC 架构](./aasc.md)
- [任务文档](../task/2026-04-02_执行者能力可视化管理.md)
