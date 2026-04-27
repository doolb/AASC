# Web MediaCenter - 代码规范

## 技术栈

- Node.js + Express
- WebSocket (ws 库)
- 原生 HTML/CSS/JavaScript (无框架)

## 新目录映射表

| 旧路径 | 新路径 | 说明 |
|------|------|------|
| `core/config.js` | `src/apps/server/modules/config/config-app-service.js` | 配置管理 |
| `core/timeParser.js` | `src/core/utils/time-parser.js` | 时间解析 |
| `core/data-snapshot/*` | `src/core/data-snapshot/*` | 快照存储 |
| `core/viewbind/*` | `src/core/viewbind/*` | 绑定模型 |
| `core/log-buffer.js` | `src/framework/observability/log-buffer.js` | 日志缓冲 |
| `core/system-monitor.js` | `src/framework/observability/system-monitor.js` | 系统监控 |
| `core/connection.js` | `src/framework/transport/ws/connection.js` | WS 传输 |
| `core/sub-server.js` | `src/framework/cluster/sub-server-manager.js` | 子服务管理 |
| `core/asr.js` | `src/external/asr/asr-service.js` | ASR 服务 |
| `core/tts.js` | `src/external/tts/tts-service.js` | TTS 服务 |
| `core/chat.js` | `src/external/llm/llm-service.js` | LLM 服务 |
| `core/voiceCommand.js` | `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js` | 语音命令 |
| `core/reminder.js` | `src/apps/web-mediacenter/modules/reminder/reminder-app-service.js` | 提醒服务 |
| `core/timeAnnounce.js` | `src/apps/web-mediacenter/modules/time/time-announce-app-service.js` | 报时服务 |
| `core/timeListener.js` | `src/apps/web-mediacenter/modules/time/time-listener-app-service.js` | 时间监听 |
| `src/aasc/*` | `src/framework/aasc/*` | AASC 消息总线与执行者 |
| `src/auto-brain/*` | `src/framework/auto-brain/*` | Auto-Brain 决策分层 |

## 路径引用规则

1. 禁止新增 `core/*` 旧路径引用。
2. 新代码必须直接依赖 `src/core`、`src/framework`、`src/external`、`src/apps`。
3. 若发现旧路径引用，必须在本次改动中同步替换为新路径。
4. 历史文档（task/changelog）允许保留旧路径用于回溯，但应补充“现路径”注记，避免误导。

## 开发命令

```bash
# 安装依赖
npm install

# 启动服务器
npm start

# 指定端口启动
PORT=3000 npm start
```

## 代码规范

### 命名约定

- 变量/函数: camelCase (如 `currentFit`, `applyCrop`)
- 常量: UPPER_SNAKE_CASE (如 `UPLOADS_DIR`)
- CSS 类: kebab-case (如 `.crop-box`, `.control-btn`)
- CSS ID: camelCase (如 `#mediaContainer`)

### 文件结构

- HTML 文件内嵌 CSS 和 JavaScript，不使用外部文件
- 按功能分组代码：状态管理 → DOM 元素 → 核心功能 → 事件处理 → 初始化
- 拆分代码为多个文件，每个文件负责一个功能模块
- 单个文件代码行数不超过 1000 行

### WebSocket 消息格式

所有消息使用 JSON 格式，包含 `type` 字段标识消息类型。

## 1. 项目结构

```
web-mediacenter/
├── package.json                                  # 项目配置
├── 3rd/                                          # 第三方与子显示端程序
│   ├── voice-display/                            # Go 子显示端
│   └── voice-display-node/                       # Node.js 子显示端
├── config/                                       # 配置文件目录
├── docs/                                         # 文档目录
├── res/                                          # 资源目录（models/uploads/temp/certs）
├── src/                                          # 分层代码主目录
│   ├── apps/server/boot/server-app.js            # 服务器入口
│   └── apps/web-mediacenter/ui/public/           # 静态页面目录
└── skills/                                       # 技能配置
```

## 2. JavaScript 规范

### 2.1 命名约定

| 类型 | 命名风格 | 示例 |
|------|----------|------|
| 变量 | camelCase | `currentFit`, `mediaRatio` |
| 常量 | UPPER_SNAKE_CASE | `UPLOADS_DIR`, `PORT` |
| 函数 | camelCase | `applyCrop()`, `sendControl()` |
| 类/构造函数 | PascalCase | `WebSocket`, `Map` |
| 私有变量 | _前缀 | `_internalState` |
| 事件处理 | on前缀 | `onCropMouseDown()` |

### 2.2 变量声明

```javascript
// 推荐: 使用 const/let
const container = document.getElementById('mediaContainer');
let currentFit = 'contain';

// 不推荐: 使用 var
var oldStyle = 'deprecated';

// 多个变量声明
let isDragging = false;
let isResizing = false;
let resizeHandle = null;
```

### 2.3 函数定义

```javascript
// 推荐: 函数声明
function applyCrop() {
    // ...
}

// 推荐: 箭头函数 (回调)
const handler = (e) => {
    e.preventDefault();
};

// 推荐: 方法简写
const obj = {
    send(data) {
        this.ws.send(JSON.stringify(data));
    }
};
```

### 2.4 异步处理

```javascript
// 推荐: async/await
async function loadMediaList() {
    try {
        const res = await fetch('/media-list');
        const data = await res.json();
        renderMediaList(data.list);
    } catch (err) {
        console.error('加载失败:', err);
    }
}

// 不推荐: 回调地狱
fetch('/media-list')
    .then(res => res.json())
    .then(data => {
        fetch('/other')
            .then(res => res.json())
            .then(other => {
                // ...
            });
    });
```

### 2.5 错误处理

```javascript
// 推荐: try-catch 包裹可能出错的代码
try {
    const data = JSON.parse(message);
    handleData(data);
} catch (e) {
    console.error('解析消息失败:', e);
}

// 推荐: 提前返回
function sendControl(action, value) {
    if (!currentDisplayId) {
        showToast('请先选择显示端', 'error');
        return;
    }
    // ... 发送逻辑
}
```

## 3. HTML 规范

### 3.1 文档结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>页面标题</title>
    <style>
        /* CSS 样式 */
    </style>
</head>
<body>
    <!-- HTML 内容 -->
    <script>
        // JavaScript 代码
    </script>
</body>
</html>
```

### 3.2 ID 和 Class 命名

| 类型 | 命名风格 | 示例 |
|------|----------|------|
| ID | camelCase | `#mediaContainer`, `#cropBox` |
| Class | kebab-case | `.crop-preview-media`, `.control-btn` |
| 状态类 | 单词 | `.active`, `.rotate-90` |

### 3.3 事件绑定

```html
<!-- 推荐: 使用 addEventListener -->
<button id="playBtn">播放</button>

<script>
document.getElementById('playBtn').addEventListener('click', playMedia);
</script>

<!-- 可接受: 简单操作使用内联 -->
<button onclick="resetCrop()">重置裁剪</button>
```

## 4. CSS 规范

### 4.1 选择器

```css
/* 推荐: 类选择器 */
.crop-box {
    position: absolute;
}

/* 避免: 过深嵌套 */
.container .section .item .title {
    /* 不推荐 */
}

/* 推荐: BEM 风格 */
.crop-box__handle {}
.crop-box--active {}
```

### 4.2 属性顺序

```css
.element {
    /* 定位 */
    position: absolute;
    top: 0;
    left: 0;
    
    /* 盒模型 */
    width: 100px;
    height: 100px;
    margin: 10px;
    padding: 10px;
    
    /* 视觉 */
    background: #000;
    border: 1px solid #fff;
    
    /* 动画 */
    transition: transform 0.3s ease;
    transform: rotate(90deg);
}
```

### 4.3 响应式设计

```css
/* 移动端优先 */
.container {
    padding: 10px;
}

/* 平板及以上 */
@media (min-width: 768px) {
    .container {
        padding: 20px;
    }
}

/* 桌面端 */
@media (min-width: 1024px) {
    .container {
        padding: 30px;
    }
}
```

## 5. WebSocket 通信规范

### 5.1 消息格式

```javascript
// 所有消息使用 JSON 格式
const message = {
    type: 'control',
    displayId: 'abc123',
    action: 'rotate',
    value: 90
};

ws.send(JSON.stringify(message));
```

### 5.2 消息处理

```javascript
// 推荐: 使用 switch 处理不同类型
ws.onmessage = function(event) {
    try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'displayList':
                handleDisplayList(data.list);
                break;
            case 'displayState':
                handleDisplayState(data);
                break;
            default:
                console.warn('未知消息类型:', data.type);
        }
    } catch (e) {
        console.error('解析消息失败:', e);
    }
};
```

### 5.3 连接管理

```javascript
// 推荐: 自动重连
function connectWebSocket() {
    const ws = new WebSocket(url);
    
    ws.onclose = function() {
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket错误:', error);
    };
}
```

## 6. 代码组织

### 6.1 函数分组

```javascript
// 推荐: 按功能分组

// === 状态管理 ===
let currentFit = 'contain';
let currentRotation = 0;

// === DOM 元素 ===
const mediaImage = document.getElementById('mediaImage');
const mediaVideo = document.getElementById('mediaVideo');

// === 核心功能 ===
function applyFit(fit) { /* ... */ }
function applyCrop() { /* ... */ }

// === 事件处理 ===
function onCropMouseDown(e) { /* ... */ }
function onCropMouseMove(e) { /* ... */ }

// === 初始化 ===
function init() { /* ... */ }
init();
```

### 6.2 避免全局污染

```javascript
// 推荐: 使用 IIFE 或模块
(function() {
    // 所有代码在此作用域内
    const privateVar = 'private';
    
    function privateFunc() {}
    
    // 暴露必要的全局变量
    window.publicAPI = {
        doSomething: privateFunc
    };
})();
```

## 7. 性能优化

### 7.1 DOM 操作

```javascript
// 推荐: 批量更新
const fragment = document.createDocumentFragment();
items.forEach(item => {
    const el = document.createElement('div');
    fragment.appendChild(el);
});
container.appendChild(fragment);

// 避免: 循环中直接操作 DOM
items.forEach(item => {
    container.appendChild(createElement(item)); // 不推荐
});
```

### 7.2 事件节流

```javascript
// 推荐: 节流高频事件
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(updateCropBox, 100);
});
```

### 7.3 内存管理

```javascript
// 推荐: 及时清理
ws.onclose = function() {
    displayClients.delete(displayId);
    // 清理相关资源
};

// 推荐: 移除事件监听
function destroy() {
    element.removeEventListener('click', handler);
    ws.close();
}
```

## 8. 注释规范

### 8.1 函数注释

```javascript
/**
 * 应用裁剪设置
 * 根据当前裁剪数据计算并应用媒体尺寸和位置
 */
function applyCrop() {
    // ...
}

/**
 * 发送控制指令到显示端
 * @param {string} action - 控制动作类型
 * @param {any} value - 控制值
 */
function sendControl(action, value) {
    // ...
}
```

### 8.2 复杂逻辑注释

```javascript
// 旋转90度或270度时，宽高互换
// "高度铺满"旋转后应执行"宽度铺满"效果
if (isRotated) {
    const displayHeight = containerWidth;
    const displayWidth = containerWidth * mediaRatio;
}
```

## 9. 安全规范

### 9.1 输入验证

```javascript
// 推荐: 验证外部输入
function handleControl(data) {
    const validActions = ['rotate', 'fit', 'crop', 'play', 'seek', 'volume'];
    if (!validActions.includes(data.action)) {
        console.warn('无效的控制动作:', data.action);
        return;
    }
    // ...
}
```

### 9.2 XSS 防护

```javascript
// 推荐: 使用 textContent 而非 innerHTML
fileNameDisplay.textContent = data.fileName;

// 避免: 直接插入未转义的内容
element.innerHTML = `<div>${userInput}</div>`; // 危险
```

### 9.3 敏感信息

```javascript
// 不记录敏感信息
console.log('用户连接:', clientIP); // 可接受
console.log('密码:', password); // 禁止
```

## 10. 测试规范

### 10.1 手动测试清单

- [ ] 显示端连接/断开
- [ ] 控制端选择显示端
- [ ] 文件上传
- [ ] URL 发送
- [ ] 画面填充模式切换
- [ ] 旋转功能
- [ ] 裁剪功能
- [ ] 视频播放控制
- [ ] 多显示端场景

### 10.2 边界条件测试

```javascript
// 测试边界值
cropData.x = Math.max(0, Math.min(100 - cropData.width, value));
cropData.width = Math.max(10, Math.min(100, value));
```

## 11. AASC 系统规范

AASC（Actor-based Asynchronous Service Communication）是基于消息总线的分布式系统架构。

### 11.1 核心原则

1. **执行者模型**：所有系统能力抽象为"执行者"（Actor），是系统中最小的能力单元
2. **消息驱动**：执行者之间通过消息总线通信，基于发布-订阅模式实现松耦合
3. **能力解耦**：能力是独立定义的功能单元，不绑定到特定执行者，可被多个执行者共享
4. **管道组合**：多个能力可按管道方式组合，实现复杂业务流程

### 11.2 角色类型

- **server**：服务器执行者（指令处理器、媒体库管理、定时任务）
- **display**：显示端执行者（画面渲染、语音播报）
- **control**：控制端执行者（媒体上传、控制指令）

### 11.3 能力等级

- **L1 基础级**：简单的消息处理和转发
- **L2 标准级**：单一功能实现
- **L3 进阶级**：多功能组合
- **L4 高级**：复杂业务逻辑
- **L5 专家级**：系统核心能力

### 11.4 命名约定

| 类型 | 命名风格 | 示例 |
|------|----------|------|
| 执行者类 | PascalCase + Actor 后缀 | `ChatActor` |
| 执行者文件 | kebab-case + -actor 后缀 | `chat-actor.js` |
| 能力ID | kebab-case | `voice-recognition` |
| 消息主题 | 点分隔 | `media.control` |

### 11.5 详细文档

详细设计见 `docs/design/aasc.md`，实现细节见 `docs/spec/aasc.md`
