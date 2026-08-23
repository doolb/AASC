# 动态画面填充模式实现说明

## 默认配置与状态

```text
动态填充默认配置 = {
    transitionSeconds: 3,
    holdSeconds: 2
}

显示端状态增加:
    dynamicFitConfig: 动态填充默认配置
    fit: contain | cover | height | width | crop | dynamic
```

## 动态阶段控制器

```text
DynamicFitController(options):
    transitionMs = 正数(options.transitionMs, 3000)
    holdMs = 正数(options.holdMs, 2000)
    schedule = options.schedule 或 setTimeout
    cancel = options.cancel 或 clearTimeout
    onPhase = options.onPhase

start():
    stop当前定时器
    running = true
    onPhase({ mode: 'contain', transitionMs: 0 })
    schedule(进入铺满过渡, holdMs)

进入铺满过渡():
    若 running=false: 返回
    onPhase({ mode: 'cover', transitionMs })
    schedule(铺满停留, transitionMs)

铺满停留():
    若 running=false: 返回
    onPhase({ mode: 'cover', transitionMs: 0 })
    schedule(进入适应过渡, holdMs)

进入适应过渡():
    若 running=false: 返回
    onPhase({ mode: 'contain', transitionMs })
    schedule(适应停留, transitionMs)

适应停留():
    若 running=false: 返回
    onPhase({ mode: 'contain', transitionMs: 0 })
    schedule(进入铺满过渡, holdMs)

stop():
    running = false
    cancel当前定时器
```

## 服务端控制协议

```text
收到 control(action='dynamicFitConfig', value):
    config = normalizeDynamicFitConfig(value)
    displayData.state.dynamicFitConfig = config
    persistDisplayState(displayData, { dynamicFitConfig: config })
    sendToDisplay(displayId, { type: 'control', action, value: config })

收到 control(action='fit', value='dynamic'):
    displayData.state.fit = 'dynamic'
    persistDisplayState(displayData, { fit: 'dynamic' })
    转发 fit 到显示端
```

## 控制端

```text
输入过渡/停留秒数:
    读取两个 number 输入
    规范化为正数
    更新当前页面显示值
    sendControl('dynamicFitConfig', config)

点击动态:
    高亮 data-fit='dynamic'
    sendControl('dynamicFitConfig', 当前配置)
    sendControl('fit', 'dynamic')

收到 displayState:
    填充 dynamicFitConfig 输入框
    按 state.fit 恢复动态按钮高亮
```

## 显示端尺寸动画

```text
applyFit('dynamic'):
    currentFit = 'dynamic'
    停止旧 DynamicFitController
    创建控制器:
        onPhase(phase) => applyDynamicGeometry(phase.mode, phase.transitionMs)
    启动控制器

applyDynamicGeometry(mode, transitionMs):
    使用现有 contain/cover 的旋转、容器比例和媒体原始比例计算目标宽高
    设置 width/height 的 CSS transition 为 transitionMs
    transitionMs > 0 时读取 media.offsetWidth 刷新布局
    下一帧保留当前 width/height，写入目标宽高和 maxWidth/maxHeight

切换到非 dynamic 模式:
    停止控制器
    清除宽高过渡
    按原有模式执行 applyCrop()
```

## 过渡回归修复

动态过渡不能在同一帧先清空宽高再写入目标宽高，否则浏览器会直接显示最终尺寸。显示端动态帧调用 `applyCrop({ preserveMediaSize: true })`，只清理定位和最大尺寸约束，保留旧宽高作为 CSS transition 的起点。
