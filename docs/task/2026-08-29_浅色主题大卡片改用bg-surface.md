# 浅色主题大卡片改用 bg-surface

## 任务状态

- ✅已完成 [2026-08-29][2026-08-29]

## 任务描述

将浅色主题大卡片改用略微调深后的 `bg-surface`，避免大面积背景过白，同时保留大小卡片的颜色层级。

## Design 需求

- `.section` 大卡片使用 `bg-surface`。
- 浅色主题 `bg-surface` 透明度比原值略低，降低白色覆盖感。
- `.control-item` 小卡片继续使用 `card-background`。
- 弹窗继续使用 `bg-surface-strong`，深色主题不变。

## Spec 设计

```text
浅色主题:
    .section.background = bg-surface
    .control-item.background = card-background
    modal-content.background = bg-surface-strong
    bg-surface.alpha = 原值 - 约 0.08

主题切换:
    通过根节点变量更新颜色
    不改变控件结构、交互和主题同步协议
```

## 受影响的功能模块和代码

- `src/apps/web-mediacenter/ui/public/css/theme.css`：调整浅色主题 `bg-surface` 值和 `.section` 引用。
- `tests/ui-theme-card-contrast.test.js`：验证大卡片使用 `bg-surface` 且透明度降低。
- `docs/design/control-ui-theme.md`：更新大卡片配色设计。
- `docs/spec/ui-theme.md`：同步主题伪代码。

## 自测用例

1. 浅色主题 `.section` 使用 `var(--bg-surface)`。
2. 浅色主题 `bg-surface` 使用降低后的透明度。
3. `.control-item` 仍使用 `var(--card-background)`。
4. 弹窗仍使用 `var(--bg-surface-strong)`。
5. 运行主题回归测试并执行 `git diff --check`。

## 兼容性测试

- 15 套主题继续使用现有根节点变量。
- 深色主题 `bg-surface` 不变。
- 不修改 HTML、JavaScript 和服务端主题协议。

## 性能测试

- 仅改变 CSS 变量值和引用，不增加运行时计算或网络请求。

## 风险评估

- 低风险：仅调整浅色主题表面颜色，保留小卡片、弹窗和文字对比度规则。
