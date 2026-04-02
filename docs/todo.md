# Web MediaCenter - 未完成任务列表

## 代码重构
 - 拆分代码，分为核心代码和业务代码
   - 核心代码负责处理显示端和控制端的通信
   - 业务代码负责处理业务逻辑，如裁剪、播放视频等
npm install pixi.js
## 功能完善
- 重构 server.js 中的 ws.on('message') 函数，按 AASC（Actor-Agent-System-Component）架构进行模块化设计：
  - **Actor 层**：定义消息 Actor，负责接收和分发 WebSocket 消息
  - **Agent 层**：创建业务 Agent，处理具体的业务逻辑（如设备管理、执行者管理、能力管理）
  - **System 层**：构建核心系统，协调 Actor 与 Agent 之间的通信
  - **Component 层**：抽象可复用组件（消息解析器、路由分发器、状态管理器）
  - 实现消息路由机制，根据消息类型自动分发到对应的 Agent 处理
  - 支持插件化扩展，新功能可通过注册新 Agent 实现
  - 添加消息验证和错误处理中间件
### Bug 修复

 90度，显示端计算方法不对 {
    "容器尺寸": {
        "width": 1423,
        "height": 835
    },
    "媒体原始尺寸": {
        "width": 1920,
        "height": 1080
    },
    "当前旋转": 90,
    "是否旋转": true,
    "当前适配模式": "crop",
    "当前裁剪百分比": {
        "x": 0,
        "y": 0,
        "width": 100,
        "height": 33.00685172171469
    },
    "状态": "裁剪模式",
    "媒体显示尺寸": {
        "width": 835,
        "height": 469.6875
    },
    "裁剪像素值": {
        "cropX": 0,
        "cropY": 0,
        "cropWidth": 469.6875,
        "cropHeight": 275.60721187631765
    },
    "最终样式": {
        "width": "1423px",
        "height": "2425px",
        "left": "0px",
        "top": "0px"
    }
}