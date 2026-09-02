# 图片驱动 ADB 自动化实现伪代码

## 当前状态

基础工程已创建，业务模块尚未全部实现。本文档会随着实现同步更新。

## 启动

```text
启动(args):
  解析 start/capture/record/inspect 子命令
  校验 device、flow、flowsRoot
  通过 ADB 查询目标设备状态
  FlowLoader 加载 activeFlowId 目录中的 png/bmp
  根据 matcher 参数初始化 OpenCV 匹配器
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
  识别 clickpoint、clickpoint_ab、delay、loop、wait、default、select、goto
  gotoFlow 只允许安全的一级 Flow ID
```

## 自动循环

```text
tick():
  frame = adb.screenshot()
  context = loader.current()
  matches = matcher.matchAll(frame, context.templates)
  candidates = selector.filterAndRank(matches)
  action = selector.choose(candidates)
  如果 action 不存在：返回 no-match
  如果 action.wait：记录 wait，不点击，不跳转
  否则：
    point = selector.resolveClickPoint(action, frame.size)
    如果 dryRun：记录拟点击，不调用 adb.tap
    否则：调用 adb.tap(point.x, point.y)
    记录动作
    等待 action.delayMs
    如果成功点击且 action.gotoFlow 存在：
      loader.switchTo(action.gotoFlow)
  返回 TickResult
```

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
