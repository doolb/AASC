# 2026-08-16 render-display 文字内嵌与 GPU/显存第二行 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal（任务描述）：** 将 render-display 覆盖层的利用率/温度/显存/功耗文字从进度条右侧独立文字改为**进度条内部水平垂直居中**浮层文字；有 GPU 的来源改为两行（第一行 CPU/MEM，第二行 GPU 利用率条 + 独立显存条），减少水平占用空间。

**Design 引用：** 本任务由 `docs/design/render-display-inline-text.md` 设计文档支撑（条内浮层文字布局、GPU/显存第二行占位对齐公式、字段合并规则、边缘情况与降级、测试计划）。

**Architecture:** 纯前端布局优化，仅改 `res/tasks/render-display/render.js`：`makeBar()` 改为「标签 + 进度条（fillWrap 裁切填充段 + 居中浮层文字）」，来源行改纵向两段（line1=CPU/MEM，line2=占位+GPU/VRAM），`getLayout()` 移除 `valMin` 新增 `subRowGap`。不新增 DOM 依赖、不改数据字段语义。

**Tech Stack:** 原生 JS（var 风格、中文注释、无 ES6 箭头函数）、Node.js（结构冒烟测试 render.smoke.js + 语法校验）。

## 全局约束

- 仅改 render.js（含新增 render.smoke.js）；不改 Kotlin/win-monitor/render.html
- 数据字段语义不变；进度条宽/高/渐变配色不变；条内文字 34px + 描边，标签 45px
- 保留旋转适配、紧凑模式、本地轮询自清理；不产生大段 if-else 链
- 每任务完成后按 CLAUDE.md 规范更新 todo/spec/changelog

## 改动文件

| 文件 | 改动 |
|------|------|
| `res/tasks/render-display/render.js` | 条内居中浮层文字 + 两行 GPU/VRAM + getLayout 调整 |
| `res/tasks/render-display/render.smoke.js` | 新增：结构冒烟测试 |
| `docs/spec/monitor-system.md` | 横条渲染伪代码更新 |
| `docs/todo.md` / `changelog.md` / `docs/design.md` | 按规范更新 |

## 自测用例

| # | 用例 | 步骤 | 期望 |
|---|------|------|------|
| 1 | 结构冒烟测试 | `node res/tasks/render-display/render.smoke.js` | 输出 OK，退出码 0 |
| 2 | 语法校验 | `node --check res/tasks/render-display/render.js` | 无输出退出码 0 |
| 3 | APK 真机本地来源 | APK 启动 render-display 任务 | 单行 CPU/MEM 条，条内文字居中、数值随负载刷新，无 JS 报错 |
| 4 | PC 来源回归 | PC 端 system-stats 推送 | 两行显示：第一行 CPU（含温度）/MEM，第二行 GPU（含温度/功耗）+VRAM，占位对齐正确 |
| 5 | 多来源 / 旋转 | 3 来源或旋转 90°/270° | 紧凑模式条宽 280px，两行布局正确、右缘不越界 |
| 6 | task:stop | 控制端停止任务 | 覆盖层移除，无定时器泄漏（本地轮询自清理未动） |

## 性能测试

- 每帧 `line1/line2.innerHTML=''` 重建 DOM（与现状 `metrics.innerHTML=''` 一致），仅来源数级渲染，开销可忽略
- 无新增轮询/定时器；条内文字 34px 在紧凑模式 280px 条宽内不裁切

## 兼容性测试

- 浏览器显示端（无 NativeDisplay）：不轮询，仅布局变化，行为不变
- APK 本地来源无 GPU/温度：仅单行 CPU/MEM，条内文字只含利用率
- PC 来源无 GPU：仅单行，不渲染第二行
- 来源 GPU 数据消失：第二行移除，不残留

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 条内文字过宽被裁切 | 低 | 文字 34px + 与 fillWrap 平级不受 track 裁切；紧凑 280px 可容纳最长文案（约 220px） |
| 第二行占位对齐偏差 | 低 | 占位宽 = deviceNameW + barGap + trackW（flex gap 补 rowGap），冒烟测试断言 548px/442px |
| 覆盖层被 task:stop 移除后定时器泄漏 | 低 | 现有自清理逻辑未动 |

## 预计工时

- render.js 改造（条内文字 + 两行 GPU/VRAM）：1h
- 文档更新（spec/task/changelog）：0.5h
- 真机自测：0.5h
- 合计：**2h**

## 测试记录

（真机自测完成后填写）
- [ ] 用例 1-6 结果
- [ ] 发现的问题与修复
