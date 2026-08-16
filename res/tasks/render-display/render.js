var container = api.container;

var rotation = window.currentRotation || 0;
var overlay = container.querySelector('#monitorOverlay');
var gaugeContainer = overlay.querySelector('#gaugeContainer');

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
