# 地图可视化实现文档

## 概述

执行者和能力可视化管理的前端实现，使用 PixiJS 进行 2D 渲染。

## 模块结构

```
public/js/map/
├── core/
│   ├── map-data.js        # 数据模型
│   ├── data-adapter.js    # 数据适配器
│   └── constants.js       # 常量定义
│
├── renderer/
│   ├── i-renderer.js      # 渲染器接口
│   └── renderer-pixi.js   # PixiJS 渲染器
│
├── sprites/
│   ├── building-sprite.js # 房子精灵
│   └── actor-sprite.js    # 人物精灵
│
└── map-panel.js           # 地图面板入口
```

## 常量定义 (constants.js)

```javascript
// 设备类型
const BuildingType = {
  SERVER: 'server',
  DISPLAY: 'display',
  SUB_DISPLAY: 'sub-display',
  CONTROL: 'control'
};

// 设备状态
const BuildingStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy'
};

// 执行者状态
const ActorStatus = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  BUSY: 'busy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline'
};

// 能力分类
const CapabilityCategory = {
  BASIC: 'basic',
  PROFESSIONAL: 'professional',
  SPECIAL: 'special'
};

// 设备颜色映射
const BuildingColors = {
  server: 0x3498db,    // 蓝色
  display: 0x2ecc71,   // 绿色
  control: 0xe67e22    // 橙色
};

// 状态颜色映射
const StatusColors = {
  initializing: 0x3498db,  // 蓝色
  ready: 0x2ecc71,         // 绿色
  busy: 0xf1c40f,          // 黄色
  degraded: 0xe67e22,      // 橙色
  offline: 0x95a5a6        // 灰色
};

// 能力等级大小映射
const LevelSizeMap = {
  1: 24,   // L1 基础级
  2: 32,   // L2 标准级
  3: 40,   // L3 进阶级
  4: 48,   // L4 高级
  5: 56    // L5 专家级
};

// 设备尺寸
const BuildingSize = {
  server: { width: 120, height: 100 },
  display: { width: 80, height: 60 },
  control: { width: 60, height: 50 }
};
```

## 数据模型 (map-data.js)

### BuildingData

```
BuildingData
├── id: string                    # 唯一标识
├── type: BuildingType            # 设备类型
├── name: string                  # 设备名称
├── status: BuildingStatus        # 设备状态
├── position: { x, y }            # 位置
├── size: { width, height }       # 尺寸
├── metadata: object              # 元数据
│   ├── ip: string
│   ├── lastHeartbeat: number
│   └── resources: object
└── actors: ActorData[]           # 房子内的执行者

方法
├── toJSON()                      # 导出JSON
└── fromJSON(json)                # 从JSON创建
```

### ActorData

```
ActorData
├── id: string                    # 唯一标识
├── name: string                  # 执行者名称
├── address: object               # 执行者地址
│   ├── ip: string
│   ├── role: string
│   └── name: string
├── status: ActorStatus           # 执行者状态
├── capabilities: object[]        # 能力列表
│   ├── id: string
│   ├── name: string
│   ├── category: string
│   └── level: number
├── maxLevel: number              # 最大能力等级
├── visual: object                # 可视化属性
│   ├── size: number
│   ├── color: string
│   └── accessories: string[]
├── buildingId: string            # 所属房子ID
└── localPosition: { x, y }       # 相对位置

方法
├── toJSON()                      # 导出JSON
└── fromJSON(json)                # 从JSON创建
```

### MapData

```
MapData
├── buildings: BuildingData[]     # 房子列表
├── actors: ActorData[]           # 执行者列表
├── connections: ConnectionData[] # 连接线列表
└── metadata: object              # 元数据

方法
├── addBuilding(building)         # 添加房子
├── removeBuilding(id)            # 移除房子
├── getBuilding(id)               # 获取房子
├── addActor(actor)               # 添加执行者
├── removeActor(id)               # 移除执行者
├── getActor(id)                  # 获取执行者
├── updateActorStatus(id, status) # 更新执行者状态
├── toJSON()                      # 导出JSON
└── fromJSON(json)                # 从JSON创建
```

## 数据适配器 (data-adapter.js)

```
DataAdapter
├── capabilityRegistry            # 能力注册表
├── buildingPositions: Map        # 房子位置缓存

方法
├── adaptActorRegistry(registry)  # 转换执行者注册表数据
├── adaptActor(actor)             # 转换单个执行者
├── adaptBuilding(address, actors)# 转换房子数据
├── calculateBuildingPosition(type, index, total) # 计算房子位置
├── calculateActorSize(capabilities) # 计算执行者大小
├── getActorColor(status)         # 获取执行者颜色
└── getAccessories(capabilities)  # 获取服饰/装备
```

### 使用示例

```javascript
const adapter = new DataAdapter(capabilityRegistry);

// 从服务端数据转换
const mapData = adapter.adaptActorRegistry(serverData);

// 获取所有房子
const buildings = mapData.buildings;

// 获取所有执行者
const actors = mapData.actors;
```

## 渲染器接口 (i-renderer.js)

```
IRenderer (抽象接口)
├── init(container)               # 初始化渲染器
├── destroy()                     # 销毁渲染器
├── setData(data)                 # 设置数据
├── addBuilding(building)         # 添加房子
├── removeBuilding(id)            # 移除房子
├── updateBuildingStatus(id, status) # 更新房子状态
├── addActor(actor)               # 添加执行者
├── removeActor(id)               # 移除执行者
├── updateActorStatus(id, status) # 更新执行者状态
├── zoomIn()                      # 放大
├── zoomOut()                     # 缩小
├── resetView()                   # 重置视图
├── on(event, handler)            # 注册事件
├── off(event, handler)           # 移除事件
└── render()                      # 渲染
```

### 事件类型

| 事件 | 参数 | 说明 |
|------|------|------|
| building:click | buildingData | 点击房子 |
| actor:click | actorData | 点击执行者 |
| view:change | { zoom, pan } | 视图变化 |

## PixiJS 渲染器 (renderer-pixi.js)

```
RendererPixi implements IRenderer
├── app: PIXI.Application         # PixiJS 应用
├── stage: PIXI.Container         # 主舞台
├── buildingLayer: PIXI.Container # 房子层
├── actorLayer: PIXI.Container    # 人物层
├── connectionLayer: PIXI.Container # 连接线层
├── sprites: Map                  # 精灵缓存
├── data: MapData                 # 数据引用
├── zoom: number                  # 缩放级别
└── pan: { x, y }                 # 平移偏移

方法
├── init(container)               # 初始化
├── createBuildingSprite(building) # 创建房子精灵
├── createActorSprite(actor)      # 创建人物精灵
├── updateLayout()                # 更新布局
├── handleInteraction(event)      # 处理交互
└── ...实现 IRenderer 接口
```

### 初始化示例

```javascript
const renderer = new RendererPixi();
await renderer.init(document.getElementById('map-container'));

// 设置数据
renderer.setData(mapData);

// 监听事件
renderer.on('building:click', (building) => {
  console.log('点击房子:', building.name);
});

renderer.on('actor:click', (actor) => {
  console.log('点击执行者:', actor.name);
});
```

## 房子精灵 (building-sprite.js)

```
BuildingSprite extends PIXI.Container
├── data: BuildingData            # 房子数据
├── background: PIXI.Graphics     # 背景
├── icon: PIXI.Text               # 图标
├── label: PIXI.Text              # 标签
├── statusIndicator: PIXI.Graphics # 状态指示器
├── actorContainer: PIXI.Container # 人物容器
├── isDragging: boolean           # 是否正在拖拽
├── dragStartPos: { x, y }        # 拖拽起始位置
└── buildingStartPos: { x, y }    # 建筑起始位置

方法
├── update(data)                  # 更新数据
├── updateStatus(status)          # 更新状态
├── addActor(actorSprite)         # 添加人物
├── removeActor(actorId)          # 移除人物
├── setPosition(x, y)             # 设置位置
├── highlight(enabled)            # 高亮显示
└── setupInteraction()            # 设置交互（含拖拽）
```

### 拖拽功能

```
拖拽流程
├── pointerdown: 记录起始位置，设置拖拽状态
├── pointermove: 计算偏移量，更新建筑位置
├── pointerup: 结束拖拽，触发 dragend 事件
└── pointerupoutside: 处理拖出边界的情况

事件
├── dragstart: 开始拖拽
├── dragging: 拖拽中
└── dragend: 拖拽结束（触发位置保存）
```

### 绘制逻辑

```
绘制房子
├── 绘制圆角矩形背景（根据类型设置颜色）
├── 绘制设备图标（emoji 或图形）
├── 绘制设备名称标签
├── 绘制状态指示器（在线/离线/忙碌）
└── 绘制人物容器（用于容纳执行者）
```

## 人物精灵 (actor-sprite.js)

```
ActorSprite extends PIXI.Container
├── data: ActorData               # 人物数据
├── body: PIXI.Graphics           # 身体
├── statusRing: PIXI.Graphics     # 状态光环
├── accessories: PIXI.Container   # 服饰/装备
├── label: PIXI.Text              # 标签

方法
├── update(data)                  # 更新数据
├── updateStatus(status)          # 更新状态
├── updateSize(size)              # 更新大小
├── addAccessory(type)            # 添加服饰
├── removeAccessory(type)         # 移除服饰
├── setPosition(x, y)             # 设置位置
└── highlight(enabled)            # 高亮显示
```

### 绘制逻辑

```
绘制人物
├── 绘制状态光环（根据状态设置颜色）
├── 绘制圆形身体（根据能力等级设置大小）
├── 绘制服饰/装备（根据能力类型）
│   ├── basic: 帽子
│   ├── professional: 披风
│   └── special: 光环
└── 绘制名称标签
```

## 地图面板入口 (map-panel.js)

```
MapPanel
├── container: HTMLElement        # 容器元素
├── renderer: IRenderer           # 渲染器
├── dataAdapter: DataAdapter      # 数据适配器
├── mapData: MapData              # 地图数据
├── detailPanel: DetailPanel      # 详情面板
├── wsClient: WebSocket           # WebSocket 客户端

方法
├── init()                        # 初始化
├── loadData()                    # 加载数据
├── connectWebSocket()            # 连接 WebSocket
├── handleActorUpdate(data)       # 处理执行者更新
├── handleBuildingUpdate(data)    # 处理房子更新
├── showDetail(data)              # 显示详情
└── destroy()                     # 销毁
```

### 初始化流程

```
初始化
├── 创建容器元素
├── 初始化渲染器
├── 初始化数据适配器
├── 加载初始数据
├── 连接 WebSocket
└── 注册事件监听
```

## 服务端 API

### GET /api/map-positions

获取所有建筑的保存位置。

**响应**:
```json
{
  "status": "success",
  "positions": {
    "building-id": {
      "position": { "x": 100, "y": 200 },
      "updatedAt": 1712016000000
    }
  }
}
```

### PUT /api/map-positions/:id

保存建筑位置。

**请求**:
```json
{
  "position": { "x": 100, "y": 200 }
}
```

**响应**:
```json
{
  "status": "success",
  "message": "位置保存成功"
}
```

### GET /api/actors

获取所有执行者数据

**响应**:
```json
{
  "status": "success",
  "actors": [
    {
      "address": { "ip": "192.168.1.100", "role": "server", "name": "main" },
      "capabilities": [...],
      "status": "ready",
      "lastHeartbeat": 1711843200000
    }
  ]
}
```

### GET /api/buildings

获取所有设备数据

**响应**:
```json
{
  "status": "success",
  "buildings": [
    {
      "id": "server-main",
      "type": "server",
      "name": "主服务器",
      "ip": "192.168.1.100",
      "status": "online",
      "actors": [...]
    }
  ]
}
```

### WebSocket 消息

**执行者状态更新**:
```json
{
  "type": "actor:status",
  "data": {
    "id": "server-main",
    "status": "busy"
  }
}
```

**执行者注册**:
```json
{
  "type": "actor:register",
  "data": { ... }
}
```

**执行者注销**:
```json
{
  "type": "actor:unregister",
  "data": { "id": "..." }
}
```

## 文件清单

| 文件 | 说明 |
|------|------|
| public/js/map/core/constants.js | 常量定义 |
| public/js/map/core/map-data.js | 数据模型 |
| public/js/map/core/data-adapter.js | 数据适配器 |
| public/js/map/renderer/i-renderer.js | 渲染器接口 |
| public/js/map/renderer/renderer-pixi.js | PixiJS 渲染器 |
| public/js/map/sprites/building-sprite.js | 房子精灵 |
| public/js/map/sprites/actor-sprite.js | 人物精灵 |
| public/js/map/map-panel.js | 地图面板入口 |
| public/css/map.css | 地图样式 |

## 相关文档

- [设计文档](../design/map-visualization.md)
- [任务文档](../task/2026-04-02_执行者能力可视化管理.md)
- [AASC 架构](./aasc.md)
