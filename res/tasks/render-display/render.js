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
var gaugeMap = {};
var sourceInstanceMap = {};  // sourceInstanceId -> hostname

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

function drawDualGauge(ctx, outerPct, innerPct, outerBase, innerBase, lines) {
    if (!ctx) return;
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;
    var cx = w / 2;
    var cy = h / 2;
    var outerR = Math.min(w, h) / 2 - 18;
    var innerR = Math.min(w, h) / 2 - 48;
    var lw = 16;

    ctx.clearRect(0, 0, w, h);

    // 外圈背景
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = lw;
    ctx.stroke();

    // 内圈背景
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = lw;
    ctx.stroke();

    // 外圈数值
    var op = Math.min(100, Math.max(0, parseFloat(outerPct) || 0));
    var oa = (op / 100) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, -Math.PI / 2, oa);
    ctx.strokeStyle = pctColor(op, outerBase[0], outerBase[1], outerBase[2]);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 内圈数值
    var ip = Math.min(100, Math.max(0, parseFloat(innerPct) || 0));
    var ia = (ip / 100) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, -Math.PI / 2, ia);
    ctx.strokeStyle = pctColor(ip, innerBase[0], innerBase[1], innerBase[2]);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 中间多行文字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lh = 44;
    var sy = cy - ((lines.length - 1) * lh) / 2;
    for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (ln.bold) {
            ctx.font = 'bold 52px sans-serif';
            ctx.fillStyle = ln.color || '#fff';
        } else {
            ctx.font = '32px sans-serif';
            ctx.fillStyle = ln.color || '#fff';
        }
        ctx.fillText(ln.text, cx, sy + i * lh);
    }
}

function ensureGauges(hostname) {
    if (gaugeMap[hostname]) return gaugeMap[hostname];

    var safeId = hostname.replace(/[^a-zA-Z0-9_-]/g, '_');

    var wrapper = document.createElement('div');
    wrapper.className = 'source-gauges';
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';

    var label = document.createElement('div');
    label.style.cssText = 'font-size:24px;color:#fff;letter-spacing:1px;text-align:center';
    label.textContent = hostname;
    wrapper.appendChild(label);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:16px;align-items:center;justify-content:flex-start;width:100%';

    var cpuCol = document.createElement('div');
    cpuCol.style.cssText = 'text-align:center';
    var cpuCanvas = document.createElement('canvas');
    cpuCanvas.width = 260; cpuCanvas.height = 260;
    cpuCol.appendChild(cpuCanvas);
    row.appendChild(cpuCol);

    var gpuCol = document.createElement('div');
    gpuCol.style.cssText = 'text-align:center';
    var gpuCanvas = document.createElement('canvas');
    gpuCanvas.width = 260; gpuCanvas.height = 260;
    gpuCol.appendChild(gpuCanvas);
    row.appendChild(gpuCol);

    wrapper.appendChild(row);
    gaugeContainer.appendChild(wrapper);

    var entry = {
        cpuCtx: cpuCanvas.getContext('2d'),
        gpuCtx: gpuCanvas.getContext('2d'),
        gpuCol: gpuCol,
        wrapper: wrapper
    };
    gaugeMap[hostname] = entry;
    return entry;
}

function removeSource(hostname) {
    delete sources[hostname];
    for (var sid in sourceInstanceMap) {
        if (sourceInstanceMap[sid] === hostname) delete sourceInstanceMap[sid];
    }
    var g = gaugeMap[hostname];
    if (g && g.wrapper && g.wrapper.parentNode) {
        g.wrapper.parentNode.removeChild(g.wrapper);
    }
    delete gaugeMap[hostname];
}

function update(data, sourceInstanceId) {
    if (!data) return;

    // 源任务已停止，移除该源
    if (data._stop) {
        var sid = data._sourceInstanceId || sourceInstanceId;
        if (sid && sourceInstanceMap[sid]) removeSource(sourceInstanceMap[sid]);
        return;
    }

    var curRot = window.currentRotation || 0;
    if (curRot !== rotation) {
        rotation = curRot;
    }
    applyRotationStyle(rotation);

    // 只添加有实际监控数据的源，跳过初始空数据
    var hostname = data.hostname || 'unknown';
    if (data.cpuPercent !== undefined || data.memPercent !== undefined) {
        sources[hostname] = data;
        if (sourceInstanceId) sourceInstanceMap[sourceInstanceId] = hostname;
    } else if (!sources[hostname]) {
        return;  // 无数据且无历史源，跳过渲染
    }

    // 重新渲染所有源
    for (var h in sources) {
        var d = sources[h];
        var g = ensureGauges(h);

        var cpuPct = parseFloat(d.cpuPercent) || 0;
        var memPct = parseFloat(d.memPercent) || 0;
        var hasGpu = d.gpuPercent !== undefined && d.gpuPercent !== null && d.gpuPercent !== 'N/A';
        var gpuPct = hasGpu ? parseFloat(d.gpuPercent) || 0 : 0;
        var gpuMemTotal = parseFloat(d.gpuMemTotal) || 0;
        var gpuMemUsed = parseFloat(d.gpuMemUsed) || 0;
        var gpuVRAMPct = gpuMemTotal > 0 ? (gpuMemUsed / gpuMemTotal) * 100 : 0;
        var gpuPowerTxt = (d.gpuPower && d.gpuPower !== 'N/A') ? d.gpuPower.replace(' W', '') + 'W' : '';

        g.gpuCol.style.display = hasGpu ? '' : 'none';

        // 温度更新
        var cpuTempTxt = (d.cpuTemp && d.cpuTemp !== 'N/A') ? d.cpuTemp + '°C' : '--°C';
        var gpuTempTxt = (d.gpuTemp && d.gpuTemp !== 'N/A') ? d.gpuTemp + '°C' : '--°C';

        drawDualGauge(g.cpuCtx, cpuPct, memPct, [76, 175, 80], [63, 81, 181], [
            { text: Math.round(cpuPct) + '%', bold: true, color: '#fff' },
            { text: Math.round(memPct) + '%', color: '#fff' },
            { text: cpuTempTxt, color: '#fff' }
        ]);

        if (hasGpu) {
            drawDualGauge(g.gpuCtx, gpuPct, gpuVRAMPct, [206, 147, 216], [255, 112, 67], [
                { text: Math.round(gpuPct) + '%', bold: true, color: '#fff' },
                { text: (gpuMemTotal > 0 ? Math.round(gpuVRAMPct) + '%' : '--') + (gpuPowerTxt ? '  |  ' + gpuPowerTxt : ''), color: '#fff' },
                { text: gpuTempTxt, color: '#fff' }
            ]);
        }
    }
}

update({});

return update;
