# Android APK 自身资源监控 + render-display 横条化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** APK 显示端可获取并展示自身 CPU/内存（本地来源），render-display 监控覆盖层从圆形仪表改为单行内联横条。

**Architecture:** NativeBridge 新增 `getSystemStats()`（/proc/stat CPU 采样 + ActivityManager 内存）同步返回 JSON；render.js 检测到 NativeDisplay 时定时轮询，把 APK 设备作为监控覆盖层里的独立来源，与 PC 端 system-stats 推送共用同一套单行横条渲染。

**Tech Stack:** Kotlin（Android 7+）、原生 JS（var 风格，遵循现有代码）、DOM/CSS 渲染（无 canvas、无框架）。

## Global Constraints

- 数据格式对齐 PC 端 `win-monitor`：`cpuPercent`/`memPercent`（%）、`memTotal`/`memUsed`（GB，1 位小数）
- render.js 遵循现有 var 风格、中文注释、无 ES6 箭头函数（注入到 display.html，兼容性）
- 覆盖层维持现有细边框样式（`border:1px solid rgba(255,255,255,0.06)`），不加面板框/每行独立框
- 保留现有 `applyRotationStyle()` 旋转适配与左下角定位
- 不产生一大段 if-else-else if 链（AASC 规则）
- 修改前已在设计阶段获用户确认（docs/design/android-display-stats.md）
- 每任务完成后按 CLAUDE.md 规范更新 todo/spec/changelog 文档

---

### Task 1: NativeBridge 新增 getSystemStats()

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`（新增方法 + 两个字段）

**Interfaces:**
- Produces: `NativeBridge.getSystemStats(): String` — 同步返回 JSON，格式 `{"hostname":"Pixel 6","cpuPercent":62.5,"memPercent":38.2,"memTotal":8.0,"memUsed":3.1}`

- [ ] **Step 1: 添加 import 与 CPU 采样状态字段**

在 `NativeBridge.kt` 文件顶部 import 区（现有 `org.json.JSONObject` 等之后）追加：

```kotlin
import android.app.ActivityManager
import android.os.Build
import java.io.RandomAccessFile
```

在类体开头（`private val webView` 之后、`isAvailable()` 之前）添加 CPU 采样状态字段：

```kotlin
    private var lastCpuIdle: Long = -1
    private var lastCpuTotal: Long = -1

    // 读取 /proc/stat cpu 行两次采样差值，计算 CPU 使用率（%），1 位小数
    private fun readCpuPercent(): Double {
        val idle: Long
        val total: Long
        try {
            RandomAccessFile("/proc/stat", "r").use { raf ->
                raf.readLine() // 跳过首个 cpu 汇总行前的非 cpu 行（实际首行即 cpu 汇总）
                raf.readLine() // 现在读取的是 cpu 汇总行
            }
        } catch (_: Exception) {
            return 0.0
        }
        // 占位——Step 3 会替换此实现
        return 0.0
    }
```

> 说明：Step 3 提供完整实现。此处仅先建立字段与导入，便于逐步推进。

- [ ] **Step 2: 新增 getSystemStats() 桥方法**

在 `injectText` 方法之后（类末尾）添加：

```kotlin
    @JavascriptInterface
    fun getSystemStats(): String {
        val cpuPercent = readCpuPercent()
        val am = webView.context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        val totalBytes = mi.totalMem
        val availBytes = mi.availMem
        val usedBytes = (totalBytes - availBytes).coerceAtLeast(0)
        val gb = 1024.0 * 1024.0 * 1024.0
        val memUsedGb = usedBytes / gb
        val memTotalGb = totalBytes / gb
        val memPercent = if (totalBytes > 0) (usedBytes * 100.0 / totalBytes) else 0.0
        val model = Build.MODEL
        val hostname = if (model.isNotBlank()) model else "${Build.MANUFACTURER} ${Build.MODEL}"
        return JSONObject()
            .put("hostname", hostname)
            .put("cpuPercent", (Math.round(cpuPercent * 10) / 10.0))
            .put("memPercent", (Math.round(memPercent * 10) / 10.0))
            .put("memTotal", (Math.round(memTotalGb * 10) / 10.0))
            .put("memUsed", (Math.round(memUsedGb * 10) / 10.0))
            .toString()
    }
```

- [ ] **Step 3: 实现 readCpuPercent() 完整 CPU 采样**

用以下内容替换 Step 1 中 `readCpuPercent()` 的占位实现：

```kotlin
    private fun readCpuPercent(): Double {
        var idle = 0L
        var total = 0L
        try {
            RandomAccessFile("/proc/stat", "r").use { raf ->
                val line = raf.readLine() ?: return 0.0
                // "cpu  user nice system idle iowait irq softirq steal ..."
                val parts = line.trim().split(Regex("\\s+"))
                if (parts.size < 5 || parts[0] != "cpu") return 0.0
                var sum = 0L
                for (i in 1 until parts.size) {
                    val v = parts[i].toLongOrNull() ?: 0L
                    sum += v
                }
                idle = parts[4].toLongOrNull() ?: 0L
                total = sum
            }
        } catch (_: Exception) {
            return 0.0
        }
        if (lastCpuTotal < 0 || lastCpuIdle < 0) {
            lastCpuTotal = total
            lastCpuIdle = idle
            return 0.0 // 首次采样建立基线，返回 0
        }
        val dTotal = total - lastCpuTotal
        val dIdle = idle - lastCpuIdle
        lastCpuTotal = total
        lastCpuIdle = idle
        if (dTotal <= 0) return 0.0
        return (dTotal - dIdle).toDouble() * 100.0 / dTotal
    }
```

- [ ] **Step 4: 编译验证**

Run: `cd src/apps/android-display && ./gradlew compileDebugKotlin --offline 2>&1 | tail -20`
Expected: `BUILD SUCCESSFUL`（或编译通过，无报错）。若 `--offline` 依赖缺失，改用 `./gradlew compileDebugKotlin`。

- [ ] **Step 5: 提交**

```bash
git add src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt
git commit -m "feat: NativeBridge 新增 getSystemStats() 返回 APK 自身 CPU/内存"
```

---

### Task 2: render.js 单行横条渲染 + 本地轮询

**Files:**
- Modify: `res/tasks/render-display/render.js`（重写渲染部分）

**Interfaces:**
- Consumes: `NativeBridge.getSystemStats()`（Task 1 产出）；远端数据 `data`（含 `hostname/cpuPercent/memPercent/memTotal/memUsed/gpuPercent/gpuTemp/cpuTemp/gpuMemUsed/gpuMemTotal/gpuPower`）
- Produces: 返回 `update(data)` 函数（display.html 存入 `window._renderTaskUpdates[instanceId]`）

- [ ] **Step 1: 重写 render.js 渲染部分（保留旋转适配）**

用以下内容**整体替换** `render.js` 中从 `// 多源数据存储` 注释（`var sources = {};` 行）到文件末尾 `return update;` 之间的全部代码。文件开头 `var container = api.container;` 到 `applyRotationStyle(rotation);` 之间（含 `applyRotationStyle` 函数）保持不变。

```javascript
// 多源数据存储
var sources = {};
var sourceInstanceMap = {};  // sourceInstanceId -> hostname
var localTimer = null;

function pctColor(pct, baseR, baseG, baseB) {
    var t = Math.min(Math.max(pct, 0), 100) / 100;
    var r, g, b;
    if (t <= 0.5) {
        var s = t / 0.5;
        r = Math.round(baseR + (255 - baseR) * s);
        g = Math.round(baseG + (200 - baseG) * s);
        b = Math.round(baseB - baseB * s);
    } else {
        var s = (t - 0.5) / 0.5;
        r = Math.round(255 - (255 - 220) * s);
        g = Math.round(200 - (200 - 50) * s);
        b = Math.round(0 + 50 * s);
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function fmtGb(v) {
    if (v === undefined || v === null || isNaN(v)) return '--';
    return Number(v).toFixed(1);
}

// 构建单个指标条（标签 + 填充条 + 数值文字）
function makeBar(label, pct, color, suffix) {
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:15px;white-space:nowrap';

    var lbl = document.createElement('span');
    lbl.style.cssText = 'width:38px;color:rgba(255,255,255,0.7);text-align:right';
    lbl.textContent = label;

    var track = document.createElement('div');
    track.style.cssText = 'width:120px;height:12px;border-radius:6px;background:rgba(255,255,255,0.08);overflow:hidden';
    var fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:' + Math.min(100, Math.max(0, pct || 0)) + '%;border-radius:6px;background:' + color;
    track.appendChild(fill);

    var val = document.createElement('span');
    var valText = Math.round(pct || 0) + '%';
    if (suffix) valText += '  ' + suffix;
    val.style.cssText = 'color:#fff;min-width:30px';
    val.textContent = valText;

    bar.appendChild(lbl);
    bar.appendChild(track);
    bar.appendChild(val);
    return bar;
}

// 单个来源单行：来源名 + 各指标条
function ensureSourceRow(hostname) {
    if (sources[hostname] && sources[hostname]._row) return sources[hostname]._row;

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:14px;padding:3px 0;white-space:nowrap';

    var name = document.createElement('span');
    name.style.cssText = 'min-width:110px;max-width:180px;overflow:hidden;text-overflow:ellipsis;font-size:15px;color:#fff';
    name.textContent = hostname;

    var metrics = document.createElement('div');
    metrics.style.cssText = 'display:flex;align-items:center;gap:14px';
    row.appendChild(name);
    row.appendChild(metrics);

    gaugeContainer.appendChild(row);
    if (!sources[hostname]) sources[hostname] = {};
    sources[hostname]._row = { row: row, metrics: metrics };
    return sources[hostname]._row;
}

function removeSource(hostname) {
    var g = sources[hostname];
    if (g && g._row && g._row.row && g._row.row.parentNode) {
        g._row.row.parentNode.removeChild(g._row.row);
    }
    delete sources[hostname];
    for (var sid in sourceInstanceMap) {
        if (sourceInstanceMap[sid] === hostname) delete sourceInstanceMap[sid];
    }
}

function update(data) {
    if (!data) return;

    // 源任务已停止，移除该源
    if (data._stop) {
        var sid = data._sourceInstanceId;
        if (sid && sourceInstanceMap[sid]) removeSource(sourceInstanceMap[sid]);
        return;
    }

    var curRot = window.currentRotation || 0;
    if (curRot !== rotation) rotation = curRot;
    applyRotationStyle(rotation);

    var hostname = data.hostname || 'unknown';
    if (data.cpuPercent !== undefined || data.memPercent !== undefined) {
        sources[hostname] = sources[hostname] || {};
        // 保留 _row 引用，其余数据字段覆盖更新
        for (var k in data) if (k !== '_row') sources[hostname][k] = data[k];
        if (data._sourceInstanceId) sourceInstanceMap[data._sourceInstanceId] = hostname;
    } else if (!sources[hostname]) {
        return;  // 无数据且无历史源，跳过渲染
    }

    // 重新渲染所有源为单行横条
    for (var h in sources) {
        var d = sources[h];
        var entry = ensureSourceRow(h);  // 获取或创建该来源的行
        entry.metrics.innerHTML = '';

        var cpuPct = parseFloat(d.cpuPercent) || 0;
        var memPct = parseFloat(d.memPercent) || 0;

        var cpuSuffix = '';
        if (d.cpuTemp && d.cpuTemp !== 'N/A') cpuSuffix = d.cpuTemp + '°C';
        entry.metrics.appendChild(makeBar('CPU', cpuPct, pctColor(cpuPct, 76, 175, 80), cpuSuffix));

        var memSuffix = fmtGb(d.memUsed) + '/' + fmtGb(d.memTotal) + 'G';
        entry.metrics.appendChild(makeBar('MEM', memPct, pctColor(memPct, 63, 81, 181), memSuffix));

        var hasGpu = d.gpuPercent !== undefined && d.gpuPercent !== null && d.gpuPercent !== 'N/A';
        if (hasGpu) {
            var gpuPct = parseFloat(d.gpuPercent) || 0;
            var gpuSuffix = '';
            if (d.gpuTemp && d.gpuTemp !== 'N/A') gpuSuffix += d.gpuTemp + '°C ';
            if (d.gpuMemUsed !== undefined && d.gpuMemTotal !== undefined) {
                var vramPct = parseFloat(d.gpuMemTotal) > 0 ? (parseFloat(d.gpuMemUsed) / parseFloat(d.gpuMemTotal)) * 100 : 0;
                gpuSuffix += Math.round(vramPct) + '%VRAM';
            }
            if (d.gpuPower && d.gpuPower !== 'N/A') gpuSuffix += ' ' + String(d.gpuPower).replace(' W', '') + 'W';
            entry.metrics.appendChild(makeBar('GPU', gpuPct, pctColor(gpuPct, 206, 147, 216), gpuSuffix));
        }
    }
}

// APK 本地来源轮询：检测 NativeDisplay 存在则每 800ms 拉取自身 CPU/内存
if (window.NativeDisplay && window.NativeDisplay.isAvailable) {
    var instanceId = api.instanceId;
    localTimer = setInterval(function () {
        // 覆盖层已被 task:stop 移除则停止轮询，避免泄漏
        if (!window._renderTaskUpdates || !window._renderTaskUpdates[instanceId]) {
            clearInterval(localTimer);
            return;
        }
        try {
            var raw = window.NativeDisplay.getSystemStats();
            if (raw) {
                var stats = JSON.parse(raw);
                if (stats && stats.hostname) {
                    stats._sourceInstanceId = 'local-' + instanceId;
                    update(stats);
                }
            }
        } catch (e) {
            // 解析失败跳过本次，下轮继续
        }
    }, 800);
}

update({});

return update;
```

- [ ] **Step 2: 静态检查 JS 语法**

Run: `node --check res/tasks/render-display/render.js`
Expected: 无输出（语法通过，退出码 0）

- [ ] **Step 3: 提交**

```bash
git add res/tasks/render-display/render.js
git commit -m "feat: render-display 横条化 + APK 本地来源轮询"
```

---

### Task 3: render.html 覆盖层结构适配

**Files:**
- Modify: `res/tasks/render-display/render.html`

**Interfaces:**
- Consumes: `gaugeContainer` 元素（Task 2 的 `ensureSourceRow` 向其追加行）

- [ ] **Step 1: 调整内部容器**

用以下内容整体替换 `render.html`：

```html
<div id="monitorOverlay" style="position:fixed;display:flex;flex-direction:column;padding:8px 16px;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;border-radius:12px;border:1px solid rgba(255,255,255,0.06);">
  <div class="gauge-container" id="gaugeContainer" style="display:flex;flex-direction:column;gap:2px;align-items:flex-start">
  </div>
</div>
```

（填充 `padding:16px 20px` → `8px 16px`，`gap:12px` → `2px`，横条更紧凑。容器 ID `gaugeContainer` 保持不变，避免改 render.js 引用。）

- [ ] **Step 2: 浏览器/服务端冒烟验证**

启动服务端后，在控制端给显示端下发 render-display 任务，确认覆盖层以横条显示、无 JS 报错。（如无显示端环境，确认 display.html 可正常注入即视为通过。）

- [ ] **Step 3: 提交**

```bash
git add res/tasks/render-display/render.html
git commit -m "style: render-display 覆盖层内边距/间距适配横条"
```

---

### Task 4: 文档更新（spec + task + changelog）

**Files:**
- Modify: `docs/spec/android-display.md`（增补 getSystemStats 伪代码）
- Modify: `docs/spec/monitor-system.md`（横条渲染 + 本地来源伪代码）
- Create: `docs/task/2026-08-15_APK自身资源监控与横条化.md`
- Modify: `docs/todo.md`、`changelog.md`、`docs/design.md`

**Interfaces:**
- Consumes: 本计划 Task 1-3 的所有产出

- [ ] **Step 1: 更新 `docs/spec/monitor-system.md` render-display 小节**

在 `### render-display (渲染任务)` 小节的表格后追加：

```markdown
#### 横条渲染（单行内联）

每个来源一行，纯 DOM/CSS（无 canvas）：

```
[Pixel 6]   CPU ▓▓▓▓▓▓░░░░ 62%        MEM ▓▓▓░░░░░░░ 38%  3.1/8.0G
[PC-1]      CPU ▓▓▓░░░░░░░ 34%  45°C  MEM ▓▓░░░░░░░░ 21%  6.4/32G  GPU ▓▓░░ 12%
```

- 指标条 = 小标签 + 120px 填充条（`pctColor()` 渐变）+ 百分比文字
- 温度/显存/功耗为小字后缀，有数据才显示；GPU 条仅在有 GPU 数据时出现
- 内存文字格式：`memUsed/memTotal G`

#### APK 本地来源轮询

```
render.js 检测 window.NativeDisplay 存在
  → setInterval(800ms) 轮询 NativeDisplay.getSystemStats()
    → JSON.parse → update(stats)（_sourceInstanceId = 'local-' + instanceId）
  → 每次触发先检查 _renderTaskUpdates[instanceId] 是否存在
    → 不存在 clearInterval 退出（覆盖层移除时防泄漏）
```
```

- [ ] **Step 2: 更新 `docs/spec/android-display.md` 桥接口表格**

在桥接口表格中追加一行：

```markdown
| getSystemStats | `String (JSON)` | 同步返回 APK 自身资源：`{hostname, cpuPercent, memPercent, memTotal, memUsed}`；hostname=Build.MODEL，CPU 读 /proc/stat 两次采样差值，内存读 ActivityManager.getMemoryInfo()，GB 1 位小数 |
```

- [ ] **Step 3: 创建 task 文档**

创建 `docs/task/2026-08-15_APK自身资源监控与横条化.md`，内容包含：任务描述、design 引用（`docs/design/android-display-stats.md`）、spec 更新说明、受影响模块（NativeBridge/render-display）、自测用例（Task 列表中的验证项）、兼容性（浏览器显示端不受影响）、性能（800ms 轮询 /proc/stat 开销可忽略）、风险评估（getSystemStats 首次调用返回 0）、预计工时 3.5h。

- [ ] **Step 4: 更新 `docs/todo.md`、`changelog.md`、`docs/design.md`**

按项目任务记录格式在 changelog.md 追加完成项；从 todo.md 删除已完成任务；design.md 索引增加 `docs/design/android-display-stats.md`。

- [ ] **Step 5: 提交**

```bash
git add docs/spec/android-display.md docs/spec/monitor-system.md docs/task/2026-08-15_APK自身资源监控与横条化.md docs/todo.md changelog.md docs/design.md
git commit -m "docs: APK 自身资源监控与 render-display 横条化 spec/task/changelog"
```

---

## Self-Review 结果

- **Spec 覆盖**：设计文档全部条目已映射到任务（Task1=原生接口、Task2=横条渲染+本地轮询、Task3=HTML 结构、Task4=文档规范）。旋转适配在 Task 2 中保留。无遗漏。
- **类型一致性**：`getSystemStats()` 返回字段名（hostname/cpuPercent/memPercent/memTotal/memUsed）在 Task 1 定义、Task 2 消费，一致。`gaugeContainer`、`_sourceInstanceId`、`_renderTaskUpdates` 引用一致。
- **无占位符**：所有代码步骤含完整实现。
- **TDD 说明**：本项目 render.js 为注入式脚本（display.html 的 `new Function` 执行）、无 JS 测试框架；NativeBridge 无单元测试目录。故以 `node --check` 语法验证 + Gradle 编译验证 + 真机冒烟替代 TDD。
