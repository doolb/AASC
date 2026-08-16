# render-display 文字内嵌 + GPU/显存第二行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 render-display 覆盖层的利用率/温度/显存/功耗文字从进度条右侧的独立文字改为**进度条内部水平垂直居中**的浮层文字；有 GPU 的来源改为**两行**（第一行 CPU/MEM，第二行 GPU 利用率条 + 独立显存条），减少水平占用空间。

**Architecture:** 纯前端布局优化，仅改 `res/tasks/render-display/render.js`。`makeBar()` 改为「标签 + 进度条（fillWrap 裁切填充段 + 居中浮层文字）」；来源行改为纵向两段（line1 = CPU/MEM，line2 = 占位 + GPU/VRAM，仅 GPU 数据存在时创建）；`getLayout()` 移除条右侧文字最小宽 `valMin`、新增第一/二行间距 `subRowGap`。不新增 DOM 依赖、不改数据字段语义、不改采集端/原生端。

**Tech Stack:** 原生 JS（var 风格、中文注释、无 ES6 箭头函数，注入 display.html 兼容）、Node.js（结构冒烟测试 + 语法校验）。

## Global Constraints

- 仅改 `res/tasks/render-display/render.js`（含新增同目录冒烟测试）；不改 Kotlin（NativeBridge）、不改采集任务（win-monitor）、不改 render.html 覆盖层结构
- 数据字段语义不变：`cpuPercent/cpuTemp/memPercent/memUsed/memTotal/gpuPercent/gpuTemp/gpuMemUsed/gpuMemTotal/gpuPower`
- render.js 遵循现有 var 风格、中文注释、无 ES6 箭头函数
- 不产生一大段 if-else-else if 链（AASC 规则）
- 保留 `applyRotationStyle()` 旋转适配、`getLayout()` 紧凑模式（旋转 90°/270° 或来源数 ≥3）、本地轮询自清理、`removeSource()`
- 进度条宽/高/渐变配色不变；条内文字字号 34px（标签 45px），白字 + `text-shadow` 深色描边
- 覆盖层维持现有细边框样式与半透明黑底
- 修改前已在设计阶段获用户确认（docs/design/render-display-inline-text.md）
- 每任务完成后按 CLAUDE.md 规范更新 todo/spec/changelog 文档

---

### Task 1: render.js 条内浮层文字 + 两行 GPU/VRAM 布局

**Files:**
- Modify: `res/tasks/render-display/render.js`
- Create: `res/tasks/render-display/render.smoke.js`（结构冒烟测试）

**Interfaces:**
- Consumes: `window.currentRotation`、`api.instanceId`、`window.NativeDisplay.getSystemStats()`（不新增消费）
- Produces: `update(data)`（display.html 存入 `window._renderTaskUpdates[instanceId]`）。`makeBar(label, pct, color, text, L, lblW)` 第四个参数由「后缀字符串」改为「完整条内文字」。`ensureSourceRow` 返回值改为 `{ row, line1, line2 }`（`line2` 初值 `null`，GPU 存在时由 `update()` 惰性创建并赋值回 `entry.line2`）。`getLayout()` 返回对象移除 `valMin`、新增 `subRowGap: 2`。

- [ ] **Step 1: 写失败的结构冒烟测试**

创建 `res/tasks/render-display/render.smoke.js`：

```javascript
// render.js 结构冒烟测试：最小 DOM 桩，校验条内文字 + 两行 GPU/VRAM 结构
// 运行：node res/tasks/render-display/render.smoke.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function makeEl() {
    // style 对象：cssText 赋值时解析出 width（render.js 通过 cssText 设条宽/占位宽）
    const style = { cssText: '' };
    Object.defineProperty(style, 'cssText', {
        get() { return this._cssText || ''; },
        set(v) {
            this._cssText = v;
            const m = /width:([^;]+);?/.exec(v);
            if (m) this.width = m[1].trim();
        }
    });
    return {
        style: style,
        children: [],
        _innerHTML: '',
        set innerHTML(v) { this._innerHTML = v; this.children = []; },
        get innerHTML() { return this._innerHTML; },
        appendChild(c) { this.children.push(c); return c; },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) this.children.splice(i, 1);
            return c;
        },
        parentNode: null,
        querySelector() { return null; }
    };
}

// 加载 render.js 并在桩环境中执行，返回 update 函数与 gaugeContainer 桩
function loadUpdate() {
    const code = fs.readFileSync(path.join(__dirname, 'render.js'), 'utf8');
    const gauge = makeEl();
    const overlay = makeEl();
    overlay.querySelector = (s) => (s === '#gaugeContainer' ? gauge : null);
    const container = makeEl();
    container.querySelector = (s) => (s === '#monitorOverlay' ? overlay : null);
    const doc = { createElement: makeEl };
    const win = { currentRotation: 0, _renderTaskUpdates: {}, NativeDisplay: null };
    const api = { container: container, instanceId: 'smoke' };
    return { update: new Function('api', 'window', 'document', code)(api, win, doc), gauge: gauge };
}

// bar = [lbl, track]，track = [fillWrap, val]
function getBarText(bar) { return bar.children[1].children[1].textContent; }

const { update, gauge } = loadUpdate();

// PC 来源：第一行 CPU/MEM + 第二行 GPU/VRAM
update({
    hostname: 'PC-1', cpuPercent: 34, cpuTemp: '45',
    memPercent: 21, memUsed: 6.4, memTotal: 32,
    gpuPercent: 12, gpuTemp: '52', gpuMemUsed: 6, gpuMemTotal: 24, gpuPower: '180 W'
});

assert.strictEqual(gauge.children.length, 1, '应有一个来源行');
const row = gauge.children[0];
assert.strictEqual(row.children.length, 2, 'PC 来源应为两行');
const line1 = row.children[0];
const line2 = row.children[1];

assert.strictEqual(line1.children.length, 2, '第一行应为 CPU/MEM 两条');
assert.strictEqual(getBarText(line1.children[0]), '34%  45°C', 'CPU 条内文字含温度');
assert.ok(getBarText(line1.children[1]).indexOf('21%') === 0, 'MEM 条内文字以利用率开头');
assert.ok(getBarText(line1.children[1]).indexOf('6.4/32') > 0, 'MEM 条内文字含已用/总量');

assert.strictEqual(line2.children.length, 3, '第二行应为 占位+GPU+VRAM');
assert.strictEqual(line2.children[0].style.width, '548px', '占位宽=deviceNameW+barGap+trackW=170+18+360');
assert.strictEqual(getBarText(line2.children[1]), '12%  52°C  180W', 'GPU 条内文字含温度+功耗');
assert.ok(getBarText(line2.children[2]).indexOf('25%') === 0, 'VRAM 条内文字以显存利用率开头');
assert.ok(getBarText(line2.children[2]).indexOf('6/24') > 0, 'VRAM 条内文字含已用/总量');

// APK 本地来源：仅第一行 CPU/MEM（无 GPU/温度）
update({
    hostname: 'Pixel 6', cpuPercent: 62, memPercent: 38, memUsed: 3.1, memTotal: 8
});
assert.strictEqual(gauge.children.length, 2, '应有第二个来源行');
const row2 = gauge.children[1];
assert.strictEqual(row2.children.length, 1, 'APK 来源仅第一行');
assert.strictEqual(getBarText(row2.children[0].children[0]), '62%', 'APK CPU 条内文字无温度后缀');

// 紧凑模式占位宽（来源数=3 触发）：deviceNameW=150, barGap=12, trackW=280
update({
    hostname: 'PC-2', cpuPercent: 5, memPercent: 5, memUsed: 1, memTotal: 16,
    gpuPercent: 3, gpuMemUsed: 1, gpuMemTotal: 8
});
const row3 = gauge.children[2];
assert.strictEqual(row3.children[1].children[0].style.width, '442px', '紧凑模式占位宽=150+12+280');

console.log('render.smoke.js OK：条内文字 + 两行 GPU/VRAM 结构校验通过');
```

- [ ] **Step 2: 运行冒烟测试确认失败**

Run: `node res/tasks/render-display/render.smoke.js`
Expected: `AssertionError`（当前 render.js 无 line2/占位/条内文字结构，`row.children.length === 1`，第 1 个断言即失败）。

- [ ] **Step 3: 改造 `getLayout()` 与 `makeBar()`**

在 `res/tasks/render-display/render.js` 中，将 `getLayout()`（现第 78-92 行）整体替换为：

```javascript
// 布局参数：随旋转角度与来源数量动态调整，旋转（90°/270°）或多设备（>=3）时更紧凑
function getLayout() {
    var count = 0;
    for (var h in sources) count++;
    var compact = (rotation === 90 || rotation === 270) || count >= 3;
    return {
        barGap: compact ? 12 : 18,        // 条内元素间距（标签-进度条）
        deviceNameW: compact ? 150 : 170, // CPU 条标签位（设备名）宽
        lblW: 96,                         // 其余指标（MEM/GPU/VRAM）标签宽
        trackW: compact ? 280 : 360,      // 进度条宽
        trackH: compact ? 30 : 36,        // 进度条高
        rowGap: compact ? 20 : 32,        // 行内条间距
        rowPad: compact ? 4 : 6,          // 行垂直内边距
        subRowGap: 2                      // 第一/第二行间垂直间距
    };
}
```

将 `makeBar()`（现第 95-120 行）整体替换为：

```javascript
// 构建单个指标条（标签 + 进度条，文字叠加在条内水平垂直居中）
// text 为完整条内文字（如 "34%  45°C"）；lblW 覆盖标签宽（缺省 L.lblW，设备名用 L.deviceNameW）
function makeBar(label, pct, color, text, L, lblW) {
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:' + L.barGap + 'px;font-size:45px;white-space:nowrap';

    var lbl = document.createElement('span');
    lbl.style.cssText = 'width:' + (lblW || L.lblW) + 'px;color:rgba(255,255,255,0.7);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    lbl.textContent = label;

    var track = document.createElement('div');
    track.style.cssText = 'position:relative;width:' + L.trackW + 'px;height:' + L.trackH + 'px;border-radius:' + (L.trackH / 2) + 'px;background:rgba(255,255,255,0.08)';

    // 填充段由 fillWrap 裁出圆角（与现状一致的填充外观），文字与 fillWrap 平级、不受裁切
    var fillWrap = document.createElement('div');
    fillWrap.style.cssText = 'position:absolute;top:0;left:0;height:100%;width:' + Math.min(100, Math.max(0, pct || 0)) + '%;overflow:hidden;border-radius:' + (L.trackH / 2) + 'px';
    var fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%;background:' + color;
    fillWrap.appendChild(fill);
    track.appendChild(fillWrap);

    var val = document.createElement('span');
    val.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font-size:34px;white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.9),0 0 2px rgba(0,0,0,0.9)';
    val.textContent = text;
    track.appendChild(val);

    bar.appendChild(lbl);
    bar.appendChild(track);
    return bar;
}
```

- [ ] **Step 4: 改造 `ensureSourceRow()` 为两行结构**

将 `ensureSourceRow()`（现第 123-141 行）整体替换为：

```javascript
// 单个来源行：第一行 CPU/MEM，第二行 GPU/VRAM（有 GPU 数据时，前部等宽占位对齐 MEM 条标签起点）
// 行级样式每帧刷新，布局随旋转/来源数动态调整
function ensureSourceRow(hostname, L) {
    if (sources[hostname] && sources[hostname]._row) {
        var cached = sources[hostname]._row;
        cached.row.style.cssText = 'display:flex;flex-direction:column;gap:' + L.subRowGap + 'px;padding:' + L.rowPad + 'px 0;white-space:nowrap';
        cached.line1.style.cssText = 'display:flex;align-items:center;gap:' + L.rowGap + 'px';
        if (cached.line2) cached.line2.style.cssText = 'display:flex;align-items:center;gap:' + L.rowGap + 'px';
        return cached;
    }

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:' + L.subRowGap + 'px;padding:' + L.rowPad + 'px 0;white-space:nowrap';

    var line1 = document.createElement('div');
    line1.style.cssText = 'display:flex;align-items:center;gap:' + L.rowGap + 'px';
    row.appendChild(line1);

    gaugeContainer.appendChild(row);
    if (!sources[hostname]) sources[hostname] = {};
    sources[hostname]._row = { row: row, line1: line1, line2: null };
    return sources[hostname]._row;
}
```

- [ ] **Step 5: 改造 `update()` 渲染循环**

将 `update()` 中从 `// 重新渲染所有源为单行横条（布局随旋转/来源数动态）` 注释行到对应 `for` 循环结束（现第 180-210 行）整体替换为：

```javascript
    // 重新渲染所有源：第一行 CPU/MEM，第二行 GPU/VRAM（布局随旋转/来源数动态）
    var L = getLayout();
    for (var h in sources) {
        var d = sources[h];
        var entry = ensureSourceRow(h, L);  // 获取或创建该来源的行
        entry.line1.innerHTML = '';

        var cpuPct = parseFloat(d.cpuPercent) || 0;
        var memPct = parseFloat(d.memPercent) || 0;

        var cpuText = Math.round(cpuPct) + '%';
        if (d.cpuTemp && d.cpuTemp !== 'N/A') cpuText += '  ' + d.cpuTemp + '°C';
        // CPU 条标签位显示设备名（替代 "CPU" 文字），宽度用 deviceNameW
        entry.line1.appendChild(makeBar(h, cpuPct, pctColor(cpuPct, 76, 175, 80), cpuText, L, L.deviceNameW));

        var memText = Math.round(memPct) + '%  ' + fmtGb(d.memUsed) + '/' + fmtGb(d.memTotal) + 'G';
        entry.line1.appendChild(makeBar('MEM', memPct, pctColor(memPct, 63, 81, 181), memText, L));

        var hasGpu = d.gpuPercent !== undefined && d.gpuPercent !== null && d.gpuPercent !== 'N/A';
        if (hasGpu) {
            if (!entry.line2) {
                entry.line2 = document.createElement('div');
                entry.line2.style.cssText = 'display:flex;align-items:center;gap:' + L.rowGap + 'px';
                entry.row.appendChild(entry.line2);
            }
            entry.line2.innerHTML = '';

            // 等宽占位：使第二行 GPU/VRAM 条标签起点与第一行 MEM 条标签起点对齐
            var spacer = document.createElement('span');
            spacer.style.cssText = 'display:inline-block;width:' + (L.deviceNameW + L.barGap + L.trackW) + 'px';
            entry.line2.appendChild(spacer);

            var gpuPct = parseFloat(d.gpuPercent) || 0;
            var gpuText = Math.round(gpuPct) + '%';
            if (d.gpuTemp && d.gpuTemp !== 'N/A') gpuText += '  ' + d.gpuTemp + '°C';
            if (d.gpuPower && d.gpuPower !== 'N/A') gpuText += '  ' + String(d.gpuPower).replace(' W', '') + 'W';
            entry.line2.appendChild(makeBar('GPU', gpuPct, pctColor(gpuPct, 206, 147, 216), gpuText, L));

            var hasVram = d.gpuMemUsed !== undefined && d.gpuMemTotal !== undefined && d.gpuMemUsed !== 'N/A' && d.gpuMemTotal !== 'N/A' && parseFloat(d.gpuMemTotal) > 0;
            if (hasVram) {
                var vramPct = (parseFloat(d.gpuMemUsed) / parseFloat(d.gpuMemTotal)) * 100;
                var vramText = Math.round(vramPct) + '%  ' + fmtGb(d.gpuMemUsed) + '/' + fmtGb(d.gpuMemTotal) + 'G';
                entry.line2.appendChild(makeBar('VRAM', vramPct, pctColor(vramPct, 206, 147, 216), vramText, L));
            }
        } else if (entry.line2) {
            // 来源 GPU 数据消失时移除第二行，避免残留
            if (entry.line2.parentNode) entry.line2.parentNode.removeChild(entry.line2);
            entry.line2 = null;
        }
    }
```

- [ ] **Step 6: 运行冒烟测试确认通过**

Run: `node res/tasks/render-display/render.smoke.js`
Expected: 输出 `render.smoke.js OK：条内文字 + 两行 GPU/VRAM 结构校验通过`，退出码 0。

- [ ] **Step 7: 语法校验**

Run: `node --check res/tasks/render-display/render.js && node --check res/tasks/render-display/render.smoke.js`
Expected: 无输出，退出码 0。

- [ ] **Step 8: 提交**

```bash
git add res/tasks/render-display/render.js res/tasks/render-display/render.smoke.js
git commit -m "feat: render-display 条内居中浮层文字 + GPU/显存第二行布局"
```

---

### Task 2: 文档更新（spec + task + changelog + design 索引）

**Files:**
- Modify: `docs/spec/monitor-system.md`
- Create: `docs/task/2026-08-16_render-display-文字内嵌与GPU显存第二行.md`
- Modify: `docs/todo.md`、`changelog.md`、`docs/design.md`

**Interfaces:**
- Consumes: Task 1 的实现结果（render.js 布局与 `makeBar` 签名变更）

- [ ] **Step 1: 更新 `docs/spec/monitor-system.md` 横条渲染小节**

将 `docs/spec/monitor-system.md` 中「#### 横条渲染（单行内联）」（现第 49 行）到「#### APK 本地来源轮询」之前（现第 62 行）的整段替换为：

```markdown
#### 横条渲染（单行内联 + 两行 GPU/VRAM）

每个来源按数据分行，纯 DOM/CSS（无 canvas）。设备名占 CPU 条标签位（替代 "CPU" 文字），MEM/GPU/VRAM 标签保留：

第一行（所有来源）：

```
Pixel 6   ▓▓▓▓▓▓[62%]                MEM ▓▓▓░░[38% 3.1/8G]
PC-1      ▓▓▓▓▓▓[62% 45°C]           MEM ▓▓▓░░[38% 6.4/32G]
```

第二行（仅来源有 GPU 数据时，前部等宽占位对齐 MEM 条标签起点）：

```
PC-1      ▓▓▓▓▓▓[62% 45°C]           MEM ▓▓▓░░[38% 6.4/32G]
          GPU ▓▓░░[12% 52°C 180W]    VRAM ▓░░[23% 6/24G]
```

- 利用率/温度/显存/功耗文字叠加在**进度条内部水平垂直居中**（`left:50%` + `translate(-50%,-50%)`），字号 34px（标签 45px），白色 + `text-shadow` 深色描边，不受进度条裁切
- 填充段由 fillWrap（`overflow:hidden` + 圆角）裁出与现状一致的圆角填充；文字与 fillWrap 平级
- 布局参数由 `getLayout()` 动态计算：旋转 90°/270° 或来源数 ≥3 时紧凑模式（条宽 280px/条高 30px/间距收紧），否则常规模式（条宽 360px/条高 36px）；`update()` 每帧按当前 `rotation` 与来源数刷新行级样式
- 覆盖层整体半透明黑底 `background:rgba(0,0,0,0.25)`，底下内容隐约可见且文字清晰
- 内存/显存文字格式：`memUsed/memTotal G`；CPU 温度、GPU 温度/功耗仅在字段有效时并入条内文字
```

「#### APK 本地来源轮询」小节及之后内容保持不变。

- [ ] **Step 2: 创建 task 文档**

创建 `docs/task/2026-08-16_render-display-文字内嵌与GPU显存第二行.md`：

```markdown
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
```

- [ ] **Step 3: 更新 `docs/todo.md`、`changelog.md`、`docs/design.md`**

**todo.md** — 在「## 功能完善」小节追加（在「重构ai开发流程」行之前插入）：

```markdown
- ✅已完成 [2026-08-16][2026-08-16] render-display 覆盖层文字内嵌 + GPU/显存第二行
  - 设计文档：docs/design/render-display-inline-text.md
  - 实施计划：docs/task/2026-08-16_render-display-文字内嵌与GPU显存第二行.md
  - 实现：res/tasks/render-display/render.js（条内居中浮层文字、第二行 GPU/VRAM 占位对齐）
  - 验证：node render.smoke.js（结构校验）+ node --check
```

**changelog.md** — 在「## [Unreleased]」的「### 优化」小节末尾追加：

```markdown
- ✅ [2026-08-16] render-display 覆盖层文字内嵌 + GPU/显存第二行
  - 利用率/温度/显存/功耗文字从条右侧独立文字改为进度条内部水平垂直居中叠加（字号 34px + text-shadow 描边），去掉条右侧 val 最小宽，水平占位显著缩短
  - 有 GPU 的来源改两行：第一行 CPU/MEM，第二行等宽占位对齐 + GPU 利用率条 + 独立显存条
  - 改动文件：res/tasks/render-display/render.js、res/tasks/render-display/render.smoke.js（新增结构冒烟测试）、docs/spec/monitor-system.md
```

**design.md** — 在「| Android显示端监控 | [android-display-stats.md]...」行之后追加：

```markdown
| render-display 文字内嵌 | [render-display-inline-text.md](design/render-display-inline-text.md) | 条内居中浮层文字、GPU/显存第二行占位对齐 |
```

- [ ] **Step 4: 提交**

```bash
git add docs/spec/monitor-system.md docs/task/2026-08-16_render-display-文字内嵌与GPU显存第二行.md docs/todo.md changelog.md docs/design.md
git commit -m "docs: render-display 文字内嵌与 GPU/显存第二行 spec/task/changelog"
```

---

## Self-Review 结果

- **Spec 覆盖**：设计文档全部条目已映射——条内浮层文字（Task1 Step3 makeBar）、两行 GPU/VRAM 与占位对齐（Task1 Step4-5）、getLayout 调整（Task1 Step3）、边缘情况（Step5 hasVram 判断 + line2 移除）、测试计划（Task1 Step1/6 + Task2 Step2 自测用例）。无遗漏。
- **类型一致性**：`makeBar(label, pct, color, text, L, lblW)` 第四参数语义（完整条内文字）在 Task1 定义、Task2 spec 引用一致；`ensureSourceRow` 返回值 `{row,line1,line2}` 在 Step4 定义、Step5 消费一致；`getLayout()` 移除 `valMin`、新增 `subRowGap`，冒烟测试占位宽公式（170+18+360=548 / 150+12+280=442）与 Step5 spacer 实现一致。`fmtGb` 返回 `toFixed(1)`（如 `32.0`），冒烟断言用前缀匹配规避。
- **无占位符**：所有代码步骤含完整实现与完整断言。
- **TDD 说明**：本项目 render.js 为注入式脚本（display.html 的 `new Function` 执行）、无 JS 测试框架；以结构冒烟测试（最小 DOM 桩，先失败后通过）+ `node --check` 语法验证替代完整 TDD，真机冒烟作为最终验收。
