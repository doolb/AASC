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
