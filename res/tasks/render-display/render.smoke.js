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
        appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
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
assert.ok(getBarText(line2.children[2]).indexOf('6.0/24.0') > 0, 'VRAM 条内文字含已用/总量');

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

// GPU 数据消失（gpuPercent='N/A'）：第二行移除，来源恢复单行
update({
    hostname: 'PC-1', cpuPercent: 30, cpuTemp: '45',
    memPercent: 20, memUsed: 6.0, memTotal: 32,
    gpuPercent: 'N/A'
});
const rowAfter = gauge.children[0];
assert.strictEqual(rowAfter.children.length, 1, 'GPU 消失后应移除第二行');

console.log('render.smoke.js OK：条内文字 + 两行 GPU/VRAM 结构校验通过');
