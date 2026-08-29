# 任务：render-display 设备名左对齐

## 状态

- ✅ 已完成 [2026-08-29]

## 任务描述

`render-display` 的 CPU 条设备名标签使用固定宽度右对齐，导致 `arch0` 前方出现视觉空白，并与较长的 `SM-N...` 名称左边缘不一致。

## Design 需求

- 保留设备名标签固定宽度和进度条位置。
- 设备名及其他条外标签统一左对齐。
- 不添加或删除设备名实际文本中的字符。

## Spec 设计

```text
makeBar(label, ...):
    labelWidth = lblW 或布局默认标签宽度
    label.style.width = labelWidth
    label.style.textAlign = 'left'
    label.textContent = label
```

## 受影响的功能模块和代码

- `res/tasks/render-display/render.js`
- `tests/render-display-theme-label.test.js`
- `docs/design/render-display-inline-text.md`
- `docs/spec/monitor-system.md`
- `docs/task/2026-08-29_render-display设备名左对齐.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

- render-display 标签样式测试：2/2 通过。
- render-display 旋转布局测试：1/1 通过。
- `node --check res/tasks/render-display/render.js` 通过。
- `git diff --check` 通过。

## 风险评估

- 只改变标签文字在固定宽度内的水平对齐，不改变进度条宽度、间距、旋转定位或数据格式。
