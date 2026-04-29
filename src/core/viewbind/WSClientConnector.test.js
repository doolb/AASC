const assert = require('assert');
const ViewBind = require('./ViewBind');

console.log('=== ViewBind connect 扩展自测 ===\n');

let testCount = 0;
let passCount = 0;

function test(name, fn) {
    testCount++;
    try {
        fn();
        passCount++;
        console.log(`✓ ${name}`);
    } catch (err) {
        console.log(`✗ ${name}`);
        console.log(`  错误: ${err.message}`);
    }
}

// mock transport 实现 // 模拟 TransportConnector 接口
function createMockTransport() {
    const sent = [];
    let onReceiveCb = null;
    let unsubscribed = false;

    return {
        sent,
        send(data) { sent.push(data); },
        close() { this.closed = true; },
        onReceive(callback) {
            onReceiveCb = callback;
            return () => { unsubscribed = true; onReceiveCb = null; };
        },
        receive(data) { if (onReceiveCb) onReceiveCb(data); },
        closed: false,
        unsubscribed: () => unsubscribed,
        get onReceiveCb() { return onReceiveCb; }
    };
}

// ==========================================
// 1. connect 字段基础行为
// ==========================================
console.log('--- 1. connect 字段基础行为 ---\n');

test('connect 默认值为 undefined', () => {
    const vb = new ViewBind({ key: 'value' });
    assert.strictEqual(vb.connect, null);
});

test('设置 connect 后 getter 返回 transport', () => {
    const vb = new ViewBind({});
    const transport = createMockTransport();
    vb.connect = transport;
    assert.strictEqual(vb.connect, transport);
});

test('重复设置 connect 自动断开旧连接', () => {
    const vb = new ViewBind({});
    const t1 = createMockTransport();
    const t2 = createMockTransport();
    vb.connect = t1;
    vb.connect = t2;
    assert.strictEqual(t1.closed, true, '旧 transport 已关闭');
    assert.strictEqual(vb.connect, t2);
});

test('设置 null 不报错', () => {
    const vb = new ViewBind({});
    vb.connect = null;
    assert.strictEqual(vb.connect, null);
});

// ==========================================
// 2. data setter 自动同步
// ==========================================
console.log('\n--- 2. data setter 自动同步 ---\n');

test('data 变化时自动调用 transport.send', () => {
    const vb = new ViewBind({ status: 'idle' });
    const transport = createMockTransport();
    vb.connect = transport;

    vb.data = { status: 'playing' };
    assert.strictEqual(transport.sent.length, 1, 'send 被调用一次');
    assert.deepStrictEqual(transport.sent[0], { status: 'playing' });
});

test('相同 data 不触发 transport.send', () => {
    const vb = new ViewBind({ key: 'value' });
    const transport = createMockTransport();
    vb.connect = transport;

    vb.data = { key: 'value' };
    assert.strictEqual(transport.sent.length, 0, '相同数据不发送');
});

test('多次变化全部发送', () => {
    const vb = new ViewBind({ count: 0 });
    const transport = createMockTransport();
    vb.connect = transport;

    vb.data = { count: 1 };
    vb.data = { count: 2 };
    vb.data = { count: 3 };
    assert.strictEqual(transport.sent.length, 3, '三次变化全部发送');
});

// ==========================================
// 3. onReceive 远端数据推送
// ==========================================
console.log('\n--- 3. onReceive 远端数据推送 ---\n');

test('transport.onReceive 收到数据后更新 ViewBind.data', () => {
    const vb = new ViewBind({ status: 'idle' });
    const transport = createMockTransport();
    vb.connect = transport;

    transport.receive({ status: 'playing' });
    assert.deepStrictEqual(vb.data, { status: 'playing' });
});

test('远端推送触发本地绑定回调', () => {
    const vb = new ViewBind({ value: 0 });
    const transport = createMockTransport();
    vb.connect = transport;

    let callbackData = null;
    vb.bind('value', (data) => { callbackData = data.value; });

    transport.receive({ value: 42 });
    assert.strictEqual(callbackData, 42);
});

test('远端推送 null/undefined 不报错', () => {
    const vb = new ViewBind({});
    const transport = createMockTransport();
    vb.connect = transport;

    transport.receive(null);
    transport.receive(undefined);
    assert.ok(true, 'null/undefined 不导致崩溃');
});

// ==========================================
// 4. disconnect
// ==========================================
console.log('\n--- 4. disconnect ---\n');

test('disconnect 后 transport.close 被调用', () => {
    const vb = new ViewBind({});
    const transport = createMockTransport();
    vb.connect = transport;

    vb.disconnect();
    assert.strictEqual(transport.closed, true, 'transport.close 被调用');
    assert.strictEqual(vb.connect, null, 'transport 引用已清除');
});

test('disconnect 后 data 变化不再同步', () => {
    const vb = new ViewBind({ count: 0 });
    const transport = createMockTransport();
    vb.connect = transport;

    vb.disconnect();
    vb.data = { count: 1 };
    assert.strictEqual(transport.sent.length, 0, '断开后不发送');
});

test('disconnect 后 onReceive 回调已取消', () => {
    const vb = new ViewBind({});
    const transport = createMockTransport();
    vb.connect = transport;

    vb.disconnect();
    transport.receive({ key: 'value' });
    assert.deepStrictEqual(vb.data, {}, '断开后远端推送不生效');
});

test('重复 disconnect 不报错', () => {
    const vb = new ViewBind({});
    const transport = createMockTransport();
    vb.connect = transport;

    vb.disconnect();
    vb.disconnect();
    assert.ok(true, '重复断开不崩溃');
});

// ==========================================
// 5. pauseSync / resumeSync
// ==========================================
console.log('\n--- 5. pauseSync / resumeSync ---\n');

test('pauseSync 后 data 变化不触发 send', () => {
    const vb = new ViewBind({ count: 0 });
    const transport = createMockTransport();
    vb.connect = transport;

    vb.pauseSync();
    vb.data = { count: 1 };
    vb.data = { count: 2 };
    assert.strictEqual(transport.sent.length, 0, '暂停期间不发送');
});

test('resumeSync 立即发送当前数据', () => {
    const vb = new ViewBind({ count: 0 });
    const transport = createMockTransport();
    vb.connect = transport;

    vb.pauseSync();
    vb.data = { count: 42 };
    vb.resumeSync();
    assert.strictEqual(transport.sent.length, 1, 'resumeSync 后立即发送一次');
    assert.deepStrictEqual(transport.sent[0], { count: 42 });
});

test('pauseSync → resumeSync 后继续同步', () => {
    const vb = new ViewBind({ count: 0 });
    const transport = createMockTransport();
    vb.connect = transport;

    vb.pauseSync();
    vb.data = { count: 1 };
    vb.resumeSync();
    transport.sent.length = 0;

    vb.data = { count: 2 };
    assert.strictEqual(transport.sent.length, 1, '恢复后继续同步');
});

// ==========================================
// 6. 综合场景
// ==========================================
console.log('\n--- 6. 综合场景 ---\n');

test('双向同步：本地改 → 远端收到，远端推 → 本地更新', () => {
    const vb = new ViewBind({ text: 'hello' });
    const transport = createMockTransport();
    vb.connect = transport;

    // 本地改 → 远端收到
    vb.data = { text: 'world' };
    assert.strictEqual(transport.sent.length, 1);
    assert.deepStrictEqual(transport.sent[0], { text: 'world' });

    // 远端推 → 本地更新
    transport.receive({ text: 'pushed' });
    assert.deepStrictEqual(vb.data, { text: 'pushed' });
});

test('多个 ViewBind 独立 connect 互不干扰', () => {
    const vb1 = new ViewBind({ id: 1 });
    const vb2 = new ViewBind({ id: 2 });
    const t1 = createMockTransport();
    const t2 = createMockTransport();

    vb1.connect = t1;
    vb2.connect = t2;

    vb1.data = { id: 1, val: 'a' };
    vb2.data = { id: 2, val: 'b' };

    assert.strictEqual(t1.sent.length, 1, 'vb1 发给 t1');
    assert.strictEqual(t2.sent.length, 1, 'vb2 发给 t2');
    assert.deepStrictEqual(t1.sent[0], { id: 1, val: 'a' });
    assert.deepStrictEqual(t2.sent[0], { id: 2, val: 'b' });
});

// ==========================================
// 结果
// ==========================================
console.log('\n=== 测试结果 ===\n');
console.log(`总计: ${testCount} 个测试`);
console.log(`通过: ${passCount} 个测试`);
console.log(`失败: ${testCount - passCount} 个测试`);

if (passCount === testCount) {
    console.log('\n✓ ViewBind connect 自测全部通过！');
} else {
    console.log('\n✗ 存在失败的自测');
    process.exit(1);
}
