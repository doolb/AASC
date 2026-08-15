# 控制模式实现文档（伪代码）

> 与实现同步更新。设计文档见 `docs/design/control-mode.md`。

## 消息协议

```
控制端 → 服务端 → 显示端：
  control(controlMode: on)            开关控制模式（开启暂停自动滚动，关闭恢复）
  control(controlInput: 事件)          输入转发（鼠标/滚轮/键盘/文本）

显示端 → 服务端 → 控制端：
  controlScreenshot(mode, dataUrl, width, height)   1 帧/秒 720p 截图
```

### controlInput 事件字段

| 事件 | 字段 |
|------|------|
| mousedown/mouseup/click/contextmenu | x, y（裁剪框内百分比）, button |
| wheel | deltaX, deltaY（像素） |
| keydown/keyup | key, code, keyCode, altKey, ctrlKey, shiftKey, metaKey, char（单字符时） |
| text | text（中文粘贴注入） |

## 服务端（server-app.js）

```
displayTypes 白名单: + 'controlScreenshot'
handleDisplayMessageFallback:
  controlScreenshot → broadcastToControls({displayId, type, mode, dataUrl, width, height})

control 消息分支:
  action=controlMode / controlInput → 不更新 state，sendToDisplay 原样转发

日志过滤: control 的 crop/controlInput action 不打日志（防刷屏）
```

## 显示端（display.html）

```
setControlMode(on):
    if on:
        stopHtmlScroll()              # 暂停自动滚动（互斥）
        start 截图定时器(1s)            # 上一帧未完成跳过（防堆积）
    else:
        stop 截图定时器 + 停 GDM 流
        startHtmlScroll(当前模式)       # 恢复自动滚动

captureHtmlShot() 截图降级链:
    try 读 contentDocument:
        成功(同源) → htmlToImage 截 iframe 可见视口 → 缩 720p → JPEG0.7 → 回传
        失败(跨域) → getDisplayMedia 整屏（不裁剪，8s 授权超时）→ 缩 720p → JPEG0.7 → 回传
            授权失败/超时 → 兜底 htmlToImage → 再失败 → 回传 mode:'none'

dispatchControlInput(data) 输入合成:
    鼠标: contentPointFromCropBox(crop, x%, y%) → elementFromPoint
          → mousedown 时手动 focus（合成事件不触发原生 focus）→ dispatch MouseEvent
    滚轮: dispatch WheelEvent(deltaX, deltaY, deltaMode=0) + win.scrollBy
          （合成事件不触发原生滚动）
    键盘: dispatch KeyboardEvent(key, code, keyCode, 修饰键)
          单字符(keydown, 无修饰) → insertText 注入
    文本: insertText 注入 activeElement（input/textarea/contentEditable）

reportHtmlProgress: 跨域 iframe 时跳过上报（try-catch，防 SecurityError 刷屏）

断连/卸载: stopControlScreenshot() 清理定时器与 GDM 流
```

### 坐标换算（control-mode-utils.js，纯函数可单测）

```
contentPointFromCropBox(crop, px, py):
    x = crop.x + clamp(px,0,100) * crop.width / 100      # 裁剪框内% → 内容%
    y = crop.y + clamp(py,0,100) * crop.height / 100
    （裁剪框定义在内容坐标系，与 CSS transform 缩放无关）

contentPixelFromPercent(contentW, contentH, pct):
    x = round(contentW * pct.x / 100)                     # 内容% → 像素
    y = round(contentH * pct.y / 100)

fitSizeTo720p(w, h): 最长边 ≤1280 等比缩放（原尺寸小不放大）
clamp(v, min, max)
```

## 控制端（upload.html / crop.js / websocket.js）

```
setControlMode(on):                    # 开关切换
    on: 发送 controlMode on；截图作为预览底图（替代占位框）
    off: 发送 controlMode off；隐藏底图恢复占位框
    文本输入行随开关显示/隐藏

容器事件捕获（on 时）:
    mousedown/mouseup/click/contextmenu → 裁剪框内百分比 → controlInput
    wheel → 50ms 节流 → controlInput
    document keydown/keyup（捕获阶段 preventDefault，阻止控制端页面响应）→ controlInput
    （单字符无修饰附带 char；输入框粘贴中文 → event:'text'）

controlScreenshot 接收:
    displayId 不匹配 → 忽略
    mode='none' → 占位提示"跨域未授权，操作仍生效"
    否则 → previewImg 显示底图（object-fit: contain），裁剪框 overlay 保持可拖拽
```
