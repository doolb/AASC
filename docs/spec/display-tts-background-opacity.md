# 显示端 TTS 字幕背景透明度实现伪代码

```text
DEFAULT_TTS_BACKGROUND_OPACITY = 0.2

normalizeOpacity(value, fallback):
  有限数值限制在 0..0.2
  缺失或非数值时返回规范化 fallback

控制端“界面主题”卡片:
  在显示端背景光晕设置之后显示 TTS 背景透明度滑块
  min=0, max=0.2, step=0.01, value=0.2
  input -> 更新百分比文字
  change -> send({ type: 'setDisplayTtsBackgroundOpacityConfig', opacity })

服务端收到 setDisplayTtsBackgroundOpacityConfig:
  确认消息来自控制端
  validation = validateOpacity(message.opacity, 当前权威值)
  validation 失败 -> 回送错误和当前权威值并结束
  config.set('ui.displayTtsBackgroundOpacity', validation.opacity)
  保存失败 -> 回送错误和当前权威值，不广播
  保存成功 -> 广播 { type: 'displayTtsBackgroundOpacityConfig', opacity }
    给所有控制端和在线显示端

控制端连接 / 显示端连接:
  读取持久化值或 DEFAULT_TTS_BACKGROUND_OPACITY
  发送 displayTtsBackgroundOpacityConfig(规范化值)

控制端收到 displayTtsBackgroundOpacityConfig:
  更新滑块、百分比标签和当前设置值
显示端收到 displayTtsBackgroundOpacityConfig:
  opacity = normalizeOpacity(message.opacity, 0.2)
  documentElement.style.setProperty('--tts-subtitle-background-opacity', opacity)

TTS字幕CSS:
  渐变色阶 = alpha0 -> alpha变量 -> alpha变量 -> alpha0
  保持既有背景模糊、文字样式及字幕生命周期
```
