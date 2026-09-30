# 显示端背景光晕实现文档

## 配置与默认值

```text
DEFAULT_DISPLAY_BACKGROUND_GLOW = {
    color: '#8FA8D5',
    centerRange: 10,
    spread: 58
}

normalizeDisplayBackgroundGlow(input, fallback):
    若 input 不是普通对象，则使用空对象
    color = input.color 为 #RRGGBB 时转为大写；否则使用 fallback.color
    centerRange = 有限数值取整并限制在 0..20；缺失时使用 fallback.centerRange
    spread = 有限数值取整并限制在 25..90；缺失时使用 fallback.spread
    返回仅含 { color, centerRange, spread } 的对象

validateDisplayBackgroundGlow(payload, fallback):
    若 payload 不是对象，返回错误
    若 color 存在但不是 #RRGGBB，返回错误
    若 centerRange 或 spread 存在但不是有限数值，返回错误
    返回 { ok: true, config: normalizeDisplayBackgroundGlow(payload, fallback) }
```

## 控制端设置

```text
初始化“系统设置 → 界面主题”:
    读取中心颜色选择器、中心亮度范围滑块和扩散范围滑块
    未收到服务端配置时应用 DEFAULT_DISPLAY_BACKGROUND_GLOW

颜色或滑块输入:
    读取 { color, centerRange, spread }
    更新颜色值和两个百分比
    将预览值应用到当前控制端页面

颜色或滑块提交:
    send({
        type: 'setDisplayBackgroundGlowConfig',
        config: { color, centerRange, spread }
    })

收到 displayBackgroundGlowConfig(config):
    normalized = normalizeDisplayBackgroundGlow(config, 默认值)
    保存 normalized 为最后确认值
    更新颜色选择器、滑块、数值和页面预览

收到 displayBackgroundGlowConfigError(config):
    恢复服务端回传的权威 config
    显示错误提示
```

## 服务端 WebSocket 配置

```text
服务启动:
    displayBackgroundGlow = normalizeDisplayBackgroundGlow(
        config.get('ui.displayBackgroundGlow'),
        DEFAULT_DISPLAY_BACKGROUND_GLOW
    )

控制端连接或显示端连接:
    发送 displayBackgroundGlowConfig(displayBackgroundGlow)

收到 setDisplayBackgroundGlowConfig:
    validation = validateDisplayBackgroundGlow(message.config, 当前权威值)
    若 validation.ok 为 false:
        回送 displayBackgroundGlowConfigError(当前权威值)
        结束
    config.set('ui.displayBackgroundGlow', validation.config)
    若持久化失败:
        回送 displayBackgroundGlowConfigError(保存前的权威值)
        结束
    更新服务端当前值
    向所有控制端和在线显示端广播 displayBackgroundGlowConfig(validation.config)
```

## 显示端和控制端预览

```text
默认媒体画布背景:
    中心位置 = 水平 50%、垂直 42%
    中心色 = #8FA8D5
    完整中心色终点 = 10%
    混合色 = 中心色与 #20232E 按 45% 混合
    混合色位置 = 58%
    外围色 = #101116，位置 = 100%

收到 displayBackgroundGlowConfig(config) 或滑块/颜色输入:
    normalized = normalizeDisplayBackgroundGlow(config, 默认值)
    将 color 写入 --display-background-glow-center-color
    将 centerRange% 写入 --display-background-glow-center-range
    计算混合色并写入 --display-background-glow-middle-color
    将 spread% 写入 --display-background-glow-spread

径向渐变色阶:
    center-color 0%
    center-color centerRange%
    middle-color spread%
    #101116 100%

媒体元素继续覆盖背景；睡眠遮罩仍覆盖为黑色。
```

## 状态栏控制位置

```text
设备树和设备列表行:
    不渲染状态栏复选框

VAD 面板:
    读取当前选中 displayId
    在该显示端 VAD 卡片顶部渲染 showStatusBar 复选框
    change 时继续使用 setDisplayStatusBarConfig
    保持已有按 displayId 持久化、权威回传和重连恢复流程
```

## 控制端竖屏导航

```text
当视口为竖屏:
    sidebar 固定到视口底部并占满宽度
    sidebar-nav 横向排列、横向滚动
    nav-item 横向均分可见区域并保持图标/文字纵向显示
    content 清除左侧边距并预留底部导航高度
    导航拖动滚动使用横向指针位移

当视口为横屏:
    sidebar 固定在左侧并纵向排列
    sidebar-nav 纵向滚动
    content 保留左侧导航边距
```

## 兼容性与性能

- 缺少配置时采用中心色 `#8FA8D5`、中心范围 10%、扩散 58%；旧配置中的 brightness 不作为透明度使用。
- 断线时不影响媒体播放；新显示端连接后接收服务端当前全局配置。
- 只在连接初始化和用户修改参数时发送消息，不引入轮询或渲染循环。
- 使用 CSS 自定义属性更新背景，不修改媒体节点尺寸或播放状态；导航仅按视口方向切换位置与滚动轴。
