'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('同实例恢复20次时先释放旧计时器/监听/DOM，停止后没有残留', () => {
    const html = fs.readFileSync(path.join(__dirname, '../src/apps/web-mediacenter/ui/public/display.html'), 'utf8');
    const start = html.indexOf('        function disposeRenderTask(instanceId) {');
    const end = html.indexOf('\n        /**', start);
    assert.ok(start > 0 && end > start);
    const nodes = new Map(); const timers = new Set(); const listeners = new Set();
    let sequence = 0;
    const context = { console: { log() {}, warn() {}, error() {} },
        base64ToUtf8: value => Buffer.from(value, 'base64').toString('utf8'),
        sendTaskResult() {}, setInterval: () => { const id = ++sequence; timers.add(id); return id; }, clearInterval: id => timers.delete(id),
        document: { getElementById: id => nodes.get(id), createElement: () => ({ remove() { nodes.delete(this.id); } }),
            body: { appendChild(element) { nodes.set(element.id, element); } }, head: { appendChild(element) { nodes.set(element.id, element); } } },
        window: { addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) } };
    vm.createContext(context); vm.runInContext(html.slice(start, end), context);
    const code = 'const timer = setInterval(() => {}, 1000); const listener = () => {}; window.addEventListener("resize", listener); api.onCleanup(() => window.removeEventListener("resize", listener)); return data => { if (data._stop) clearInterval(timer); };';
    const encode = (name, content) => ({ name, data: Buffer.from(content).toString('base64') });
    const payload = { taskName: 'render-display', instanceId: 'one', files: [encode('render.html', '<div>new</div>'), encode('render.css', '* {}'), encode('render.js', code)] };
    for (let iteration = 0; iteration < 20; iteration++) {
        context.executeRenderTask(payload);
        assert.equal(timers.size, 1); assert.equal(listeners.size, 1); assert.equal(nodes.size, 2);
        assert.equal(Object.keys(context.window._renderTaskUpdates).length, 1);
    }
    context.disposeRenderTask('one'); context.disposeRenderTask('one');
    assert.equal(timers.size, 0); assert.equal(listeners.size, 0); assert.equal(nodes.size, 0);
});
