# 任务：render-display GPU 信息取消缩进

## 状态

- ✅ 已完成 [2026-09-11]

## 任务描述

`render-display` 的 GPU/VRAM 第二行当前通过过宽的固定占位缩进到第一行 MEM 条的位置。调整为保留小幅动态缩进，使 GPU 进度条对齐 CPU 进度条、VRAM 进度条对齐 MEM 进度条。

## Design 需求

- 将 GPU 第二行前的占位改为 `max(0, deviceNameW - lblW - rowGap)`。
- GPU 标签保留小幅缩进，GPU/VRAM 继续按现有 `rowGap` 排列并分别对齐 CPU/MEM 进度条。
- 不改变 CPU/MEM 行、条宽、条高、旋转适配、紧凑模式和数据格式。

## Spec 设计

```text
渲染来源的 GPU 第二行:
    清空 line2
    spacerWidth = max(0, deviceNameW - lblW - rowGap)
    追加宽度为 spacerWidth 的 spacer
    追加 GPU 条
    如果显存数据有效，追加 VRAM 条
```

## 受影响的功能模块和代码

- `res/tasks/render-display/render.js`
- `res/tasks/render-display/render.smoke.js`
- `docs/design/render-display-inline-text.md`
- `docs/spec/monitor-system.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

- GPU 数据存在时，第二行包含小占位、GPU 和 VRAM 三个条目，GPU/VRAM 进度条分别与 CPU/MEM 进度条对齐。
- 常规模式占位为 `42px`，紧凑模式占位为 `34px`。
- GPU 数据消失后第二行仍能正常移除。
- `node res/tasks/render-display/render.smoke.js`：通过。
- `node --check res/tasks/render-display/render.js`：通过。
- `node --test tests/render-display-theme-label.test.js tests/render-display-rotation.test.js`：3/3 通过。

## 兼容性测试

- APK 本地来源仍只显示 CPU/MEM 第一行。
- 旋转 90°/270° 和多来源紧凑布局不改变参数计算。
- GPU 无显存数据时仍只显示 GPU 条。

## 性能测试

- 不新增 DOM 层级、轮询或定时器；每次刷新仅调整一个占位元素的宽度。

## 风险评估

- 低风险：只调整 GPU 第二行的占位宽度，不改变数据采集、进度条计算和覆盖层旋转定位。

## 测试记录

- 结构冒烟测试：通过，确认常规和紧凑模式均保留小占位，并分别对齐 CPU/MEM 进度条。
- 旋转布局回归：通过，0°/90°/180°/270° 覆盖层位置和视口边界保持正常。
- 标签样式回归：通过。
- `git diff --check`：通过。
