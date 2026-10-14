# render-display 显示实现规格

> 本文使用伪代码描述 `res/tasks/render-display` 的实际渲染行为。

## 高 DPI 缩放与视口约束（2026-10-14）

```text
初始化覆盖层
  读取 window.devicePixelRatio；无效时使用 1
  baseScale = max(0.5, min(1, 1 / max(1, devicePixelRatio)))

过程 applyRotationStyle(rotation)
  清除上次的旋转位置和变换
  按 rotation 设置覆盖层锚点、旋转角与 transform-origin
  读取未缩放尺寸及视口尺寸
  如果 rotation 为 90 或 270
    交换未缩放尺寸的宽高作为旋转包围盒尺寸
  safeWidth = max(1, viewportWidth - 2 * gap)
  safeHeight = max(1, viewportHeight - 2 * gap)
  fitScale = min(1, safeWidth / rotatedWidth, safeHeight / rotatedHeight)
  finalScale = baseScale * fitScale
  应用 finalScale 与 rotation 的组合变换
  读取实际 getBoundingClientRect()
  按媒体名、旋转方向和 gap 调整覆盖层位置
  再将实际包围盒限制在可用视口内

布局和数据更新
  保持现有条宽、字号、颜色、数据映射及来源更新流程
  每次来源/旋转改变后调用 applyRotationStyle
  DPR 为 1 时保持原尺寸；高 DPR 时按反比例缩小
  不改变 Android WebView 缩放设置或控制页布局
```
