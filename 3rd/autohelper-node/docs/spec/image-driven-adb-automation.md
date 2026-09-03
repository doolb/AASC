# 图片驱动 ADB 自动化实现伪代码

## 当前状态

基础工程、ADB Client、预编译 OpenCV.js 匹配器、动作选择、自动循环、OCR 辅助和 CLI 已实现；实际游戏图片流程仍需在目标画面就绪后采集。

## 启动

```text
启动(args):
  解析 start/capture/record/inspect 子命令
  校验 device、flow、flowsRoot
  通过 ADB 查询目标设备状态
  FlowLoader 加载 activeFlowId 目录中的 png/bmp
  根据 matcher 参数初始化 OpenCV 匹配器
  初始化 OCR Client；读取 --ocr-url、--ocr-short-side 和 AASC_* 环境变量，显示器由服务端调度
  启动 AutomationLoop
```

## OpenCV.js 运行时和图片匹配

```text
getOpenCv():
  通过 createRequire 加载 @techstark/opencv-js 的 CommonJS/WASM 主入口
  等待 Emscripten Promise 完成
  共享同一个已初始化的 OpenCV.js runtime

match(frameBuffer, template, method):
  解码 frameBuffer 和模板为 RGBA 像素
  转换为 CV_8UC1 灰度 Mat
  如果 method == template:
    执行 matchTemplate(..., TM_CCOEFF_NORMED)
    读取 minMaxLoc 的最大值和位置
  如果 method == orb:
    执行 ORB 特征提取和 BFMatcher
    用高质量特征的中位位移估算模板位置
  分数低于 threshold 时 matched=false 且 rect=null
  释放本轮临时 Mat，不执行点击
```

## 图片文件名解析

```text
解析图片描述(flowId, filePath):
  stem = 去除最后一个图片扩展名
  tokens = stem 按逗号分割
  descriptor.name = stem
  对每个 token:
    按第一个 @ 分割 key/value
    如果 key 是数字或 ~数字：设置 queue
    否则如果 key 是已知参数：设置对应字段
    否则如果 value 是有限数字：设置 threshold
  校验 clickpoint 在 0 到 1 之间
  校验 delay 非负
  校验 gotoFlow 是安全的 Flow ID
  返回 ImageDescriptor
```

实际接口：

```text
parseImageDescriptor(flowId, filePath) -> ImageDescriptor
  ImageDescriptor.name = 去除扩展名后的完整文件名 stem
  ImageDescriptor.flowId = 当前 Flow ID
  ImageDescriptor.queue 默认 0
  ImageDescriptor.threshold 默认 0.9
  ImageDescriptor.clickPoint 默认 { x: 0.5, y: 0.5 }
  识别 clickpoint、clickpoint_ab、delay、loop、wait、default、select、goto、ocr
  如果 token 的 key == ocr：要求 value 非空，并保存为 ocrText
  gotoFlow 只允许安全的一级 Flow ID
```

## OCR Client

```text
OcrClient({ baseUrl, shortSide?, timeoutMs?, rejectUnauthorized? }):
  baseUrl 未传入时读取 AASC_URL，默认 https://127.0.0.1:8081
  shortSide 只在配置存在时写入请求 JSON，显示器不由客户端指定
  timeoutMs 未传入时读取 AASC_TIMEOUT_SECONDS，默认 30 秒

recognize(frameBuffer):
  body = {
    imageBase64: frameBuffer 转 base64,
    shortSide: 如果配置存在则写入
  }
  POST baseUrl + /api/vision/ocr，Content-Type 为 application/json
  HTTP 非 2xx 或 payload.status == error：抛出带服务端 message 的错误
  解析 payload.boxes；保留 text、score 和规范化后的 points
  返回 { boxes, imageWidth?, imageHeight? }
```

## OCR 条件筛选

```text
requiresOcr(context):
  如果当前 Flow 任意模板存在 ocrText：返回 true

satisfiesOcr(descriptor, ocrResult):
  如果 descriptor.ocrText 不存在：返回 true
  如果 ocrResult 不存在：返回 false
  如果任意 box.text 包含 descriptor.ocrText：返回 true
  否则返回 false

selectAction(candidates, allMatches, ocrResult?):
  过滤图片匹配成功、队列非负、select 条件成立且 satisfiesOcr 的候选
  继续按 default、queue、score 和 name 规则选择
```

## 自动循环

```text
tick():
  frame = adb.screenshot()
  context = loader.current()
  如果 context 存在 OCR 条件：
    尝试使用同一 frame 调用 OCR Client 一次
    如果 OCR 失败：返回 { clicked: false, reason: "ocr-error" }
  matches = matcher.matchAll(frame, context.templates)
  candidates = selector.filterAndRank(matches, ocrResult)
  action = selector.choose(candidates)
  如果 action 不存在：返回 no-match
  如果 action.wait：记录 wait，不点击，不跳转
  否则：
    point = selector.resolveClickPoint(action, frame.size)
    如果 dryRun：记录拟点击，不调用 adb.tap，也不执行 goto
    否则：调用 adb.tap(point.x, point.y)
    记录动作
    等待 action.delayMs
    如果成功点击且 action.gotoFlow 存在：
      loader.switchTo(action.gotoFlow)
  返回 TickResult
```

非 `loop` 图片在点击后会被暂时抑制，直到它不再匹配；`loop` 图片允许下一轮继续执行。每次成功切换 Flow 都增加 transition 计数，超过上限立即停止。

## ADB Client

```text
AdbClient({ serial, runner }):
  serial 必须非空
  runner 默认使用 spawn(adb)，禁止 shell 重定向

assertConnected():
  执行 adb devices
  只有目标 serial 的状态为 device 才通过
  否则抛出 ADB device is not ready

screenshot():
  执行 adb -s serial exec-out screencap -p
  返回二进制 PNG Buffer

tap(x, y):
  校验 x、y 是非负整数
  执行 adb -s serial shell input tap x y
```

## Flow Loader

```text
new FlowLoader({ flowsRoot, parseDescriptor, loadTemplate })
  flowsRoot = resolve(flowsRoot)
  templateCache = TemplateCache(loadTemplate 或读取文件内容)

load(flowId):
  校验 flowId 是安全的一级目录名
  校验 flowsRoot/flowId 存在且是目录
  读取当前目录的 png/bmp 文件并按路径排序
  解析 ImageDescriptor
  通过 TemplateCache 加载模板
  替换 activeContext
  返回 FlowContext

switchTo(flowId):
  调用 load(flowId)

current():
  没有 activeContext 时抛出错误
  返回当前 FlowContext
```

## 安全处理

```text
switchTo(flowId):
  拒绝 .、..、路径分隔符和绝对路径
  解析 flowsRoot/flowId
  确认解析后的父目录是 flowsRoot
  确认目标目录存在
  只加载目标目录图片
  替换 current context
```
