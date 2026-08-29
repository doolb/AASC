var container = api.container;

var rotation = window.currentRotation || 0;
var overlay = container.querySelector('#monitorOverlay');
var gaugeContainer = overlay.querySelector('#gaugeContainer');

function shiftOverlay(axis, delta) {
    if (!delta) return;
    var startProperty = axis === 'x' ? 'left' : 'top';
    var endProperty = axis === 'x' ? 'right' : 'bottom';
    if (overlay.style[startProperty] && overlay.style[startProperty] !== 'auto') {
        var startValue = parseFloat(overlay.style[startProperty]) || 0;
        overlay.style[startProperty] = (startValue + delta) + 'px';
        return;
    }
    if (overlay.style[endProperty] && overlay.style[endProperty] !== 'auto') {
        var endValue = parseFloat(overlay.style[endProperty]) || 0;
        overlay.style[endProperty] = (endValue - delta) + 'px';
    }
}

// 旋转后覆盖层与媒体名共用角落，按实际包围盒保留 0°时的上侧相对层级。
function avoidFileNameOverlap(rot) {
    if (!overlay || (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) || overlay.offsetWidth === 0 || overlay.offsetHeight === 0) return;
    if (typeof document.getElementById !== 'function') return;
    var fileName = document.getElementById('fileNameDisplay');
    if (!fileName || fileName.offsetWidth === 0 || fileName.offsetHeight === 0) return;

    var overlayRect = overlay.getBoundingClientRect();
    var fileNameRect = fileName.getBoundingClientRect();
    var viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    var viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    var gap = 24;

    // 90°时把 0°的“上侧”关系转换为媒体名右侧，270°转换为媒体名左侧。
    if (rot !== 0 && rot !== 180) {
        var minLeft = gap;
        var maxLeft = Math.max(minLeft, viewportWidth - gap - overlayRect.width);
        var targetLeft = rot === 90
            ? fileNameRect.right + gap
            : fileNameRect.left - gap - overlayRect.width;
        targetLeft = Math.min(maxLeft, Math.max(minLeft, targetLeft));
        shiftOverlay('x', targetLeft - overlayRect.left);
    }

    // 覆盖层高度随来源数量变化，始终把旋转后的上下包围盒限制在视口内。
    var minTop = gap;
    var maxTop = Math.max(minTop, viewportHeight - gap - overlayRect.height);
    var targetTop = rot === 0
        ? fileNameRect.top - gap - overlayRect.height
        : rot === 180
            ? fileNameRect.bottom + gap
            : overlayRect.top;
    targetTop = Math.min(maxTop, Math.max(minTop, targetTop));
    shiftOverlay('y', targetTop - overlayRect.top);
}

function applyRotationStyle(rot) {
    if (!overlay) return;
    overlay.style.transform = '';
    overlay.style.top = '';
    overlay.style.right = '';
    overlay.style.bottom = '';
    overlay.style.left = '';
    overlay.style.transformOrigin = '';

    if (rot === 0 || !rot) {
        overlay.style.top = 'auto';
        overlay.style.right = 'auto';
        overlay.style.bottom = '80px';
        overlay.style.left = '0';
    } else if (rot === 90) {
        var w = overlay.offsetWidth;
        var h = overlay.offsetHeight;
        overlay.style.left = (-w/2 + h/2) + 'px';
        overlay.style.top = (-h/2 + w/2) + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        overlay.style.transform = 'rotate(90deg)';
        overlay.style.transformOrigin = 'center center';
    } else if (rot === 180) {
        overlay.style.top = '0';
        overlay.style.right = '0';
        overlay.style.bottom = 'auto';
        overlay.style.left = 'auto';
        overlay.style.transform = 'rotate(180deg)';
        overlay.style.transformOrigin = 'center center';
    } else if (rot === 270) {
        var w = overlay.offsetWidth;
        var h = overlay.offsetHeight;
        overlay.style.right = (h/2 - w/2) + 'px';
        overlay.style.bottom = (w/2 - h/2) + 'px';
        overlay.style.top = 'auto';
        overlay.style.left = 'auto';
        overlay.style.transform = 'rotate(-90deg)';
        overlay.style.transformOrigin = 'center center';
    }
    avoidFileNameOverlap(rot);
}
applyRotationStyle(rotation);

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

// 构建单个指标条（标签 + 进度条，文字叠加在条内水平垂直居中）
// text 为完整条内文字（如 "34%  45°C"）；lblW 覆盖标签宽（缺省 L.lblW，设备名用 L.deviceNameW）
function makeBar(label, pct, color, text, L, lblW) {
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:' + L.barGap + 'px;font-size:45px;white-space:nowrap';

    var lbl = document.createElement('span');
    // 条外标签恢复固定白字和黑色阴影，主题色只用于正下方 2px 无模糊的半透明投影；不支持 color-mix 时退回纯色投影。
    lbl.style.cssText = 'width:' + (lblW || L.lblW) + 'px;color:#fff;text-shadow:0 2px 0 var(--accent-color,#00d2ff),2px 2px 8px rgba(0,0,0,0.8);text-shadow:0 2px 0 color-mix(in srgb,var(--accent-color,#00d2ff) 65%,transparent),2px 2px 8px rgba(0,0,0,0.8);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    lbl.textContent = label;

    var track = document.createElement('div');
    track.style.cssText = 'position:relative;width:' + L.trackW + 'px;height:' + L.trackH + 'px;border-radius:' + (L.trackH / 2) + 'px;background:rgba(255,255,255,0.18)';

    // 填充段由 fillWrap 裁出圆角（与现状一致的填充外观），文字与 fillWrap 平级、不受裁切
    var fillWrap = document.createElement('div');
    fillWrap.style.cssText = 'position:absolute;top:0;left:0;height:100%;width:' + Math.min(100, Math.max(0, pct || 0)) + '%;overflow:hidden;border-radius:' + (L.trackH / 2) + 'px';
    var fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%;background:' + color;
    fillWrap.appendChild(fill);
    track.appendChild(fillWrap);

    var val = document.createElement('span');
    val.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font-size:40px;white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.9),0 0 2px rgba(0,0,0,0.9)';
    val.textContent = text;
    track.appendChild(val);

    bar.appendChild(lbl);
    bar.appendChild(track);
    return bar;
}

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

    // 兼容 display.html 以第二参数传入 sourceInstanceId 的调用方式（fn(data.data, data.sourceInstanceId)）
    var srcSid = data._sourceInstanceId || (arguments.length > 1 ? arguments[1] : null);

    // 源任务已停止，移除该源
    if (data._stop) {
        if (srcSid && sourceInstanceMap[srcSid]) removeSource(sourceInstanceMap[srcSid]);
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
        if (srcSid) sourceInstanceMap[srcSid] = hostname;
    } else if (!sources[hostname]) {
        return;  // 无数据且无历史源，跳过渲染
    }

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
        entry.line1.appendChild(makeBar('M', memPct, pctColor(memPct, 63, 81, 181), memText, L));

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

    // 来源条目重建后覆盖层尺寸才稳定，此时重新计算旋转位置，避免使用旧尺寸导致上下偏移。
    applyRotationStyle(rotation);
}

// APK 本地来源轮询：检测 NativeDisplay 存在则每 800ms 拉取自身 CPU/内存
if (window.NativeDisplay && window.NativeDisplay.isAvailable) {
    var instanceId = api.instanceId;
    var localUpdate = update;  // 本次执行的 update 引用，识别定时器是否已过期
    localTimer = setInterval(function () {
        // 覆盖层已移除（key 被删除）或已被新执行的渲染任务覆盖（key 指向新函数）→ 停止轮询
        var cur = window._renderTaskUpdates && window._renderTaskUpdates[instanceId];
        if (!cur || cur !== localUpdate) {
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
