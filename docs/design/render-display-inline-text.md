# render-display 覆盖层文字内嵌 + GPU/显存第二行 设计文档

## 概述

对 render-display 监控覆盖层（`res/tasks/render-display/render.js`）做**纯前端布局优化**，目标是在不改变数据来源的前提下减少覆盖层的水平占用空间：

1. **条内浮层文字**：把「利用率百分比 + 温度/显存/功耗后缀」从进度条右侧的独立文字，改为**叠加在进度条内部水平居中**的浮层文字；进度条宽度不变。
2. **GPU/显存第二行**：有 GPU 数据的来源（PC 端）改为两行——第一行放 CPU/MEM 条，第二行（右缩进对齐）放 **GPU 利用率条 + 独立显存条**。

**APK 温度采集本次不补**：APK 显示端自身的 `getSystemStats` 不返回温度（保持现状），其来源仅显示 CPU/MEM 条、条内文字只含利用率。

## 需求背景

### 现状问题

当前每个指标 = 标签 + 填充条 + **条右侧独立数值文字**（`min-width` 70~90px）。CPU 一项就占「设备名 + CPU 条 + 利用率 + 温度」4 个元素；GPU 一项占「GPU 条 + 利用率 + 温度 + 显存 + 功耗」5 个元素。行宽被右侧文字明显拉长。

### 目标

- 去掉所有指标条右侧的独立文字，改为条内居中浮层文字 → 每行仅由「标签位 + 进度条」构成，水平占位显著缩短。
- 有 GPU 的来源两行显示：第一行 CPU/MEM，第二行 GPU 利用率 + 独立显存条（显存不再以文字后缀形式挤在 GPU 条后）。
- 进度条宽度/高度/渐变配色保持不变。

### 约束

- **仅改 `res/tasks/render-display/render.js`**，不改 Kotlin（NativeBridge）、不改采集任务（win-monitor）、不改 render.html 覆盖层结构。
- 数据字段语义不变：`cpuPercent/cpuTemp/memPercent/memUsed/memTotal/gpuPercent/gpuTemp/gpuMemUsed/gpuMemTotal/gpuPower`。
- 保持现有 `var` 风格、中文注释、无 ES6 箭头函数（注入 display.html 兼容性）。
- 不产生一大段 if-else-else if 链（AASC 规则）。
- 保留 `applyRotationStyle()` 旋转适配、本地轮询自清理、`getLayout()` 紧凑模式逻辑。

## 布局设计

### 第一行（所有来源）

```
Pixel 6   ▓▓▓▓▓▓[62%]                M ▓▓▓░░[38% 3.1/8G]
PC-1      ▓▓▓▓▓▓[62% 45°C]           M ▓▓▓░░[38% 6.4/32G]
```

- 设备名仍作为 CPU 条的标签位（固定宽 `deviceNameW`，左对齐）。
- CPU 条、MEM 条并排，条宽 `trackW` 不变。
- 利用率 + 后缀文字叠加在**条内水平居中**（`left:50%` + `translate(-50%,-50%)`，垂直居中）。

### 第二行（仅来源有 GPU 数据时）

```
PC-1      ▓▓▓▓▓▓[62% 45°C]           M ▓▓▓░░[38% 6.4/32G]
          GPU ▓▓░░[12% 52°C 180W]    VRAM ▓░░[23% 6/24G]
```

- 第二行前面放**等宽占位**（宽 = `deviceNameW + barGap + trackW`；行内 flex `gap:rowGap` 使 GPU 条起点 = 占位宽 + rowGap = `deviceNameW + barGap + trackW + rowGap`，恰与第一行 MEM 条标签起点对齐），使 GPU/VRAM 条与第一行 MEM 条起始位置对齐。
- GPU 条：填充 = `gpuPercent`，条内文字 = 利用率 + 温度 + 功耗。
- VRAM 条：填充 = `gpuMemUsed / gpuMemTotal * 100`，条内文字 = 已用百分比 + `已用GB/总量GB`；仅在显存字段有效且总量 > 0 时渲染。
- 来源行从单行改为 flex 纵向两段（第一段 CPU/MEM，第二段 GPU/VRAM），行内纵向间距用小值（约 2px）。

### 布局参数（getLayout）

- 移除不再使用的 `valMin`（条右侧文字最小宽）。
- `deviceNameW / lblW / trackW / trackH / barGap / rowGap` 保留，紧凑模式（旋转 90°/270° 或来源数 ≥3）逻辑不变。
- 第二行占位宽按当前布局参数实时计算，随紧凑模式联动。

## 条内浮层文字

- 进度条 track 改 `position:relative`；填充段包一层 **fillWrap**（绝对定位 top/left 0，height 100%，width pct%，`overflow:hidden` + `border-radius:trackH/2`）裁出与现状一致的圆角填充段；fill 本身 `height/width 100%`。文字 span 与 fillWrap 平级，绝对定位水平垂直居中（`left:50%`+`translate(-50%,-50%)`），**不受 track 裁切**。
- 文字样式：白色、`white-space:nowrap`、加 `text-shadow` 深色描边（如 `0 0 4px rgba(0,0,0,0.9)`），保证填充颜色深浅变化时文字清晰。
- 文字字号 **40px**（标签仍为 45px），可略高出条身（条高 30~36px）；最长文案（如 `12% 52°C 180W`）在紧凑模式 280px 条宽内可能略超条宽，但文字与 fillWrap 平级不受 track 裁切，仍完整可读
- 填充段右缘圆角与现状一致（fillWrap 裁切，非方形）。

## 数据字段合并规则

| 条 | 填充百分比 | 条内浮层文字 |
|----|-----------|--------------|
| CPU（标签=设备名） | `cpuPercent` | `round%`；`cpuTemp` 有效 → 拼 `  temp°C` |
| MEM | `memPercent` | `round%` + `  used/total G` |
| GPU | `gpuPercent` | `round%`；`gpuTemp` 有效 → 拼 `  temp°C`；`gpuPower` 有效 → 拼 `  powerW` |
| VRAM | `gpuMemUsed/gpuMemTotal*100` | `round%` + `  used/total G` |

## 边缘情况与降级

| 场景 | 处理 |
|------|------|
| 无温度来源（APK 本地 / PC 无 cpuTemp） | 条内只显示利用率，无空后缀 |
| GPU 无数据（无 nvidia-smi） | 不渲染第二行，仅单行 CPU/MEM |
| 显存字段 N/A 或总量 0 | 不渲染 VRAM 条，第二行仅 GPU 条 |
| 紧凑模式（旋转/多来源） | 条宽 280px，第二行占位随之缩小，右缘不越界 |
| 浏览器显示端（无 NativeDisplay） | 仅布局变化，不轮询，行为不变 |

## 改动文件

| 文件 | 改动 |
|------|------|
| `res/tasks/render-display/render.js` | `makeBar()` 改为条内居中浮层文字（去右侧 val）；来源行改两段式（第一行 CPU/MEM，第二行 GPU/VRAM + 等宽占位对齐）；`getLayout()` 移除 valMin；字段合并规则按上表 |
| `docs/spec/monitor-system.md` | 更新 render-display 横条渲染伪代码（条内文字、两行 GPU/显存） |
| `docs/todo.md` / `changelog.md` / `docs/task/*.md` | 按项目规范更新 |

## 测试计划

1. `node --check res/tasks/render-display/render.js` 语法通过
2. **APK 真机**：覆盖层单行显示 CPU/MEM 条，条内文字居中、数值随负载刷新，无 JS 报错
3. **PC 来源回归**：两行显示，CPU 条内含温度、第二行 GPU/VRAM 条对齐正确、显存文字为 `已用/总量 G`
4. **多来源 / 旋转**：紧凑模式下两行布局正确，右缘不越界
5. **task:stop**：覆盖层移除，无定时器泄漏（本地轮询自清理逻辑未动）

## 预计工时

- render.js 改造（条内文字 + 两行 GPU/VRAM）：1h
- 文档更新（spec/task/changelog）：0.5h
- 真机自测：0.5h
- 合计：**2h**
