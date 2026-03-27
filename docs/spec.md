# Web MediaCenter - 项目规格文档

## 1. 项目概述

Web MediaCenter 是一个基于 WebSocket 的实时媒体展示控制系统，支持多显示端连接和统一控制。系统采用客户端-服务器架构，包含三个核心组件：

- **服务器端 (server.js)**: Node.js + Express + WebSocket
- **控制端 (upload.html)**: 媒体上传与显示控制界面
- **显示端 (display.html)**: 媒体展示界面

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Server (server.js)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Express   │  │  WebSocket  │  │  File Management    │  │
│  │   HTTP API  │  │   Server    │  │  (uploads/)         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Control UI    │  │   Display 1     │  │   Display N     │
│  (upload.html)  │  │ (display.html)  │  │ (display.html)  │
│                 │  │                 │  │                 │
│ - 文件上传      │  │ - 媒体展示      │  │ - 媒体展示      │
│ - 显示控制      │  │ - 旋转/裁剪     │  │ - 旋转/裁剪     │
│ - 裁剪预览      │  │ - 画面适配      │  │ - 画面适配      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 3. WebSocket 通信协议

### 3.1 连接端点

| 端点 | 用途 |
|------|------|
| `/display` | 显示端连接 |
| `/control` | 控制端连接 |

### 3.2 消息类型

#### 服务器 → 显示端

| 类型 | 说明 | 数据结构 |
|------|------|----------|
| `serverStartTime` | 服务器启动时间 | `{ type: 'serverStartTime', time: number }` |
| `displayId` | 分配的显示端ID | `{ type: 'displayId', id: string }` |
| `url` / `base64` | 媒体数据 | 见媒体数据结构 |
| `control` | 控制指令 | 见控制指令结构 |

#### 显示端 → 服务器

| 类型 | 说明 | 数据结构 |
|------|------|----------|
| `canvasSize` | 画布尺寸 | `{ type: 'canvasSize', width: number, height: number }` |

#### 服务器 → 控制端

| 类型 | 说明 | 数据结构 |
|------|------|----------|
| `serverStartTime` | 服务器启动时间 | `{ type: 'serverStartTime', time: number }` |
| `displayList` | 显示端列表 | `{ type: 'displayList', list: DisplayInfo[] }` |
| `displayState` | 显示端状态 | `{ type: 'displayState', displayId: string, state: DisplayState }` |

#### 控制端 → 服务器

| 类型 | 说明 | 数据结构 |
|------|------|----------|
| `getState` | 获取显示端状态 | `{ type: 'getState', displayId: string }` |
| `media` | 发送媒体 | `{ type: 'media', displayId: string, media: MediaData }` |
| `control` | 发送控制指令 | `{ type: 'control', displayId: string, action: string, value: any }` |

### 3.3 数据结构

#### MediaData
```typescript
interface MediaData {
    type: 'url' | 'base64';
    url?: string;           // type为url时
    data?: string;          // type为base64时
    mediaType: 'image' | 'gif' | 'video';
    fileName?: string;
    timestamp?: number;
}
```

#### DisplayState
```typescript
interface DisplayState {
    currentMedia: MediaData | null;
    rotation: 0 | 90 | 180 | 270;
    fit: 'contain' | 'height' | 'width' | 'crop';
    crop: {
        x: number;      // 0-100
        y: number;      // 0-100
        width: number;  // 0-100
        height: number; // 0-100
    };
    canvasSize: {
        width: number;
        height: number;
    };
}
```

#### ControlAction
```typescript
type ControlAction = {
    action: 'rotate';
    value: 0 | 90 | 180 | 270;
} | {
    action: 'fit';
    value: 'contain' | 'height' | 'width' | 'crop';
} | {
    action: 'crop';
    value: { x: number, y: number, width: number, height: number };
} | {
    action: 'play';
    value: boolean;
} | {
    action: 'seek';
    value: number;  // 0-100
} | {
    action: 'volume';
    value: number;  // 0-100
};
```

## 4. HTTP API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 重定向到 /upload |
| `/upload` | GET | 控制端页面 |
| `/display` | GET | 显示端页面 |
| `/upload-file` | POST | 上传文件 |
| `/media-list` | GET | 获取媒体列表 |
| `/media/:filename` | DELETE | 删除媒体文件 |
| `/uploads/:filename` | GET | 访问上传的文件 |

## 5. 显示端功能规格

### 5.1 画面适配模式

| 模式 | 说明 |
|------|------|
| `contain` | 适应屏幕，保持比例，可能有空白 |
| `height` | 高度铺满屏幕，宽度自适应 |
| `width` | 宽度铺满屏幕，高度自适应 |
| `crop` | 裁剪模式，铺满屏幕，支持裁剪区域 |

### 5.2 旋转处理

- 支持 0°、90°、180°、270° 四个旋转角度
- 旋转90°或270°时，高度/宽度铺满模式自动互换
- CSS transform 实现旋转动画

### 5.3 裁剪功能

- 裁剪区域以百分比表示 (0-100)
- 裁剪框比例与显示端屏幕比例一致
- 支持拖拽移动和缩放

## 6. 控制端功能规格

### 6.1 媒体管理

- 支持上传图片、GIF、视频文件
- 支持 URL 直接发送
- 显示服务器资源列表
- 支持删除已上传文件

### 6.2 显示控制

- 选择目标显示端
- 画面填充模式切换
- 视频播放/暂停控制
- 播放进度控制
- 音量控制

### 6.3 裁剪预览

- 实时预览裁剪效果
- 裁剪框与显示端屏幕比例一致
- 支持拖拽移动和等比缩放
- 支持旋转预览

## 7. 文件存储

- 上传文件存储在 `uploads/` 目录
- 文件命名格式: `{timestamp}_{originalName}`
- 支持的媒体类型:
  - 图片: jpg, jpeg, png, gif, webp 等
  - 视频: mp4, webm, mov, avi, mkv 等

## 8. 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 8081 | 服务器端口 |
| `UPLOADS_DIR` | ./uploads | 上传文件目录 |
| JSON limit | 500mb | 请求体大小限制 |
