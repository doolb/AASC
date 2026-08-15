# 控制模式设计文档

## 概述

控制端显示面板裁剪区域新增「控制模式」开关，开启后把控制端的鼠标点击、滚轮、键盘输入转发到显示端的 html 网页，显示端每秒回传一次网页截图（上限 720p），实现类似远程桌面操作网页的能力。控制模式与现有自动滚动播放互斥（开关切换）。

## 需求背景

显示端 html 播放目前只有自动滚动（分页/平滑/循环）模式，控制端只能通过进度条控制滚动，无法点击链接、填写表单、操作网页交互。部分场景（如操作员远程操作显示端上的网页应用）需要完整的输入转发 + 实时画面反馈。

## 截图技术选型

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| html-to-image（采用） | SVG foreignObject 序列化 DOM 到 canvas | 零授权、无人值守可用、体积小（~30KB）、渲染准确 | 跨域 iframe 无法读取（canvas 污染） |
| getDisplayMedia（采用，跨域降级） | 屏幕捕获 API，真实像素 | 跨域/视频/WebGL 都能截 | 首次需授权弹窗；页面刷新需重新授权；部分电视浏览器不支持 |
| html2canvas（不采用） | 逐节点重绘 DOM | 生态老、示例多 | 体积大（~100KB）、渲染准确度差于 html-to-image |

### 截图降级链

```
同源/srcdoc 内容 → html-to-image 截 iframe 可见区域
跨域 URL       → getDisplayMedia（懒初始化，授权一次本页会话复用）
                 ├─ 授权失败/不支持 → 尝试 html-to-image（兜底，跨域通常仍失败）
                 └─ 全部失败 → mode:'none' 降级提示"无画面，操作仍生效"
```

### 分辨率

截图统一限制最大 **1280×720**（720p）：
- html-to-image：目标 canvas 宽高按比例缩至 ≤720p，再 toJpeg
- getDisplayMedia：取帧后 drawImage 缩放至 ≤720p
- JPEG 质量 q0.7，1080p→720p 后每帧约 50-150KB，局域网可接受

## 消息协议

新增 3 类消息（复用现有 WebSocket 通道，服务端中转）：

### 控制端 → 服务端 → 显示端

复用现有 `control` 消息通道，`handleControlMessageFallback` 的 control 分支新增 action：

```
{ type: 'control', action: 'controlMode', value: true|false }
{ type: 'control', action: 'controlInput',
  event: 'mousedown'|'mouseup'|'click'|'contextmenu'|'wheel'|'keydown'|'keyup'|'text',
  x, y:        裁剪框内相对百分比（0~100，鼠标事件）
  button:      鼠标按键（0/1/2）
  deltaX, deltaY: 滚轮像素位移
  key, code, keyCode, altKey, ctrlKey, shiftKey, metaKey: 键盘事件
  char:        单字符 key（无 Ctrl/Alt/Meta 时附带，供 insertText）
  text:        文本注入内容（event:'text'）
}
```

### 显示端 → 服务端 → 控制端

```
{ type: 'controlScreenshot', mode: 'html-to-image'|'gdm'|'none',
  dataUrl: JPEG base64, width, height }
```

服务端 `displayTypes` 白名单加 `controlScreenshot`，`handleDisplayMessageFallback` 加分支广播到控制端（参照 htmlProgress 分支）。

## 显示端实现（display.html）

### 控制模式状态机

```
controlMode off（默认）：
  ├─ 现有 html 播放 + 自动滚动（分页/平滑）逻辑不变
  └─ htmlProgress 每秒上报不变

controlMode on：
  ├─ stopHtmlScroll() 暂停自动滚动（播放状态记忆保留）
  ├─ 截图定时器 1s：上一帧未完成则跳过（防堆积）
  │    └─ 按降级链截图（720p）→ 发送 controlScreenshot
  ├─ iframe 事件合成监听：接收 controlInput → 派发合成事件
  └─ controlMode off：清除截图定时器与 GDM 流，
     用记忆的 currentHtmlScroll 恢复自动滚动
```

### 输入合成

- 坐标映射：控制端传裁剪框内百分比 (x%, y%) → 内容坐标
  `(crop.x + x*crop.width/100, crop.y + y*crop.height/100)` × iframe 内容尺寸。
  裁剪框本身定义在内容百分比坐标系，与 CSS transform 缩放无关，天然正确。
- 鼠标：`iframe.contentDocument.elementFromPoint(x, y)` 定位目标，
  依次派发 `mousedown` → `mouseup` → `click`（合成 MouseEvent，含 button）
- 滚轮：派发 `WheelEvent`，deltaX/deltaY 原样（deltaMode=0 像素）
- 键盘：target = `activeElement || body`，派发 `keydown`/`keyup`
  （KeyboardEvent 带 key/code/keyCode/修饰键）
- 文本注入：键盘消息附 `char` 时（无 Ctrl/Alt/Meta 单字符），keydown 派发后
  对 input/textarea/contentEditable 执行 `document.execCommand('insertText', false, char)`；
  `event:'text'` 消息（中文粘贴）同样 insertText 注入

### 截图实现

- 同源检测：`try { iframe.contentDocument } catch { 跨域 }`
- html-to-image：`toJpeg(iframe.contentDocument.body, { width, height, pixelRatio })`，
  width/height = iframe.clientWidth × clientHeight（可见视口，非整页滚动高度），
  pixelRatio 按 720p 上限折算
- getDisplayMedia：`navigator.mediaDevices.getDisplayMedia({ video: true })` 懒初始化，
  成功复用同一 MediaStream（本页会话不再弹框）；video 元素取帧 drawImage 缩至 720p
- 旋转场景（90°/270°）：截图宽高随 CSS 变换后的可视区域互换
- 清理：WS 断开 / controlMode off / 页面卸载 → 停定时器、停流

### 依赖

- `html-to-image.min.js`（1.11.x，~30KB）下载放入 `ui/public/js/`，display.html 引用
- 跨域图片资源：默认需服务器 CORS 或 crossOrigin 配置，若截图出现空白图再补 useCORS 处理

## 控制端实现（crop.js / controls.js / websocket.js）

### UI（裁剪面板，html 模式时）

- 占位框右上角加「控制模式」开关按钮，开启后高亮
- 开启：发送 `controlMode on` → 收到首帧截图后作为预览底图
  （替代占位框，显示在容器中），裁剪框保持可拖拽
- 关闭：发送 `controlMode off` → 恢复占位框

### 事件捕获（开启后）

- 鼠标：裁剪容器监听 `mousedown/mouseup/click/contextmenu`，
  坐标换算裁剪框内百分比发送
- 滚轮：容器 `wheel` 事件，deltaX/deltaY 转发（节流 50ms）
- 键盘：`document` 级 `keydown/keyup` 监听（不限焦点），单字符无修饰键附 `char`；
  提供小输入框支持粘贴中文发送 `event:'text'`
- 裁剪框拖拽/缩放仍发 `crop` 消息，显示端实时缩放，截图画面随之变化

### 截图接收

- websocket.js 加 `controlScreenshot` 分支：更新裁剪面板底图；
  `mode:'none'` 时显示"跨域未授权，操作仍生效"提示
- 只处理当前选中 displayId 的截图

### 状态清理

切换显示端 / 离开页面 / 关闭面板 → 发送 `controlMode off`

## 服务端改动（server-app.js）

1. `displayTypes` 白名单加 `controlScreenshot`
2. `handleDisplayMessageFallback` 加分支：broadcastToControls 转发（参照 htmlProgress）
3. `handleControlMessageFallback` 的 control 分支加 `controlMode`/`controlInput` action，
   不更新 state，直接 `sendToDisplay(displayId, data)` 原样转发
4. controlInput 高频消息加入日志过滤（参照 cropDebug 机制），避免刷屏

## 限制与风险

| 限制 | 说明 |
|------|------|
| 合成 KeyboardEvent 无浏览器默认行为 | Tab 焦点切换、Enter 提交表单不触发（网页 JS 监听器正常收到）；后续如需可补 Tab 焦点手动实现 |
| 中文输入 | 通过粘贴框 + insertText 注入，无法走 IME 联想 |
| getDisplayMedia 授权 | 跨域内容首次需有人在显示端点一次；页面刷新后需重新授权 |
| 截图带宽 | 720p JPEG q0.7 ≈ 50-150KB/帧，1 帧/秒，局域网可接受 |
| 性能 | html-to-image 每秒 1 帧对复杂页面有瞬时 CPU 占用；上一帧未完成跳过防堆积 |
| 跨域截图失败 | 降级提示"无画面但操作生效"，操作本身不依赖截图 |
| 安全 | 控制模式允许远程操作显示端网页，仅限已认证控制端（沿用现有通道校验） |

## 测试计划

- 同源 html 开启控制模式：点击/滚轮/键盘/中文注入生效，截图 1 帧/秒回传且 ≤720p
- 跨域 URL：getDisplayMedia 授权流程正常；拒绝授权 → 降级链 → 提示
- 开关互斥：控制模式开 → 自动滚动暂停；关 → 恢复
- 坐标映射：缩放裁剪框后点击位置仍准确（裁剪框内百分比换算）
- 状态清理：控制端切换显示端、刷新页面、显示端断连均无残留定时器/流
- 兼容性：旋转 90°/270° 场景截图方向正确；显示端浏览器不支持 GDM 时降级不报错
