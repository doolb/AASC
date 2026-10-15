# Offline 显示端本机模型边缘把手

## 目标文件清单

- `src/apps/web-mediacenter/ui/public/css/display-mmd.css` // 调整 Offline 本机模型收起把手的水平露出量
- `src/apps/web-mediacenter/ui/public/js/self-test.js` // 只读检查收起把手半宽左移声明

## 范围约束

- 复用 `display.html` 现有 `displayOfflineModelsEntry`、`displayOfflineModelsExpand`、`displayOfflineModelsActions` 和原生模型列表按钮。
- 只改变收起状态把手的位置；入口容器、展开按钮组、安全区内缩、FPS 间距和模型原生桥行为保持现状。
- 收起把手宽 32 CSS px，向左移 16 CSS px，使显示舞台左边缘裁去一半把手，并让竖排文字约露出半个字。
- 不修改 Android 原生控制端按钮；其收起宽度 42 dp、左移 21 dp，作为半宽露出参考。

## 已有声明

- `displayOfflineModelsEntry`：位于 FPS 下方，按显示舞台安全区和键盘内缩计算纵向位置。
- `displayOfflineModelsExpand`：宽 32 CSS px、高 72 CSS px，包含竖排“模型”文字，初始显示。
- `displayOfflineModelsActions`：展开后显示本机模型列表按钮和单独的收起按钮，按左侧安全区内缩定位。
- 显示舞台层使用裁切边界，舞台外的把手部分不可见。
- Android `MainActivity` 收起控制端把手宽 42 dp、左移 21 dp。

## 操作流程

Offline 原生模型入口有可用模型时
  入口保持现有初始收起状态
  收起把手宽度 := 32 CSS px
  收起把手水平偏移 := 向左 16 CSS px
  显示舞台裁去左边界外部分，使约半个把手宽度和半个字留在屏幕内
  点击把手时沿用现有展开状态切换
  展开后只显示原有本机模型按钮和收起按钮，位置继续遵守安全区和键盘内缩

  点击本机模型按钮时调用既有 NativeDisplay.offlineShowModels()
  点击收起按钮时恢复上述半宽露出的边缘把手
否则
  隐藏整个入口容器

只读自测读取显示页与模型样式
  校验既有控件 ID 和 FPS/控制端避让声明
  校验收起把手宽 32 CSS px 且左移 16 CSS px
  校验展开入口仍使用原有左侧安全区内缩规则
