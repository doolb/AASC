const assert = require('assert');
const LogBuffer = require('./log-buffer');

console.log('=== LogBuffer 扩展自测 ===\n');

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

// ==========================================
// 1. 新增字段
// ==========================================
console.log('--- 1. 新增字段 ---\n');

test('不传新字段时 entry 默认值为 null', () => {
    const lb = new LogBuffer();
    const entry = lb.add('系统', 'test message');
    assert.strictEqual(entry.correlationId, null);
    assert.strictEqual(entry.scope, null);
    assert.strictEqual(entry.source, null);
    assert.strictEqual(entry.targetId, null);
});

test('传入 correlationId 后 entry 包含该值', () => {
    const lb = new LogBuffer();
    const entry = lb.add('系统', 'test', { correlationId: 'corr-123' });
    assert.strictEqual(entry.correlationId, 'corr-123');
});

test('传入 scope 后 entry 包含 scope', () => {
    const lb = new LogBuffer();
    const entry = lb.add('系统', 'test', { scope: 'group' });
    assert.strictEqual(entry.scope, 'group');
});

test('同时传入多个新字段', () => {
    const lb = new LogBuffer();
    const entry = lb.add('系统', 'test', {
        correlationId: 'corr-456',
        scope: 'single',
        source: 'display-1',
        targetId: 'control-1'
    });
    assert.strictEqual(entry.correlationId, 'corr-456');
    assert.strictEqual(entry.scope, 'single');
    assert.strictEqual(entry.source, 'display-1');
    assert.strictEqual(entry.targetId, 'control-1');
});

// ==========================================
// 2. 向后兼容
// ==========================================
console.log('\n--- 2. 向后兼容 ---\n');

test('不传 extra 时不报错', () => {
    const lb = new LogBuffer();
    const entry = lb.add('系统', 'no extra');
    assert.ok(entry.id);
    assert.strictEqual(entry.correlationId, null);
});

test('现有字段不受影响', () => {
    const lb = new LogBuffer();
    const entry = lb.add('语音', 'voice test', { displayId: 'disp-1' });
    assert.strictEqual(entry.category, '语音');
    assert.strictEqual(entry.level, 'info');
    assert.strictEqual(entry.device, 'display');
    assert.strictEqual(entry.displayId, 'disp-1');
    assert.strictEqual(entry.message, 'voice test');
});

// ==========================================
// 3. onLogEntry 监听
// ==========================================
console.log('\n--- 3. onLogEntry 监听 ---\n');

test('onLogEntry 触发后 entry 包含新字段', () => {
    const lb = new LogBuffer();
    let received = null;
    lb.onLogEntry((entry) => { received = entry; });
    lb.add('系统', 'test', { correlationId: 'corr-789' });
    assert.ok(received, '监听器被调用');
    assert.strictEqual(received.correlationId, 'corr-789');
});

test('多个监听器全部收到新字段', () => {
    const lb = new LogBuffer();
    let received1 = null, received2 = null;
    lb.onLogEntry((e) => { received1 = e; });
    lb.onLogEntry((e) => { received2 = e; });
    lb.add('系统', 'multi', { scope: 'group' });
    assert.strictEqual(received1.scope, 'group');
    assert.strictEqual(received2.scope, 'group');
});

// ==========================================
// 4. getEntries 过滤与新字段无关
// ==========================================
console.log('\n--- 4. getEntries 过滤与新字段无关 ---\n');

test('getEntries 包含新字段值', () => {
    const lb = new LogBuffer();
    lb.add('系统', 'msg1', { correlationId: 'corr-a' });
    lb.add('系统', 'msg2', { correlationId: 'corr-b' });
    const entries = lb.getEntries();
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].correlationId, 'corr-a');
    assert.strictEqual(entries[1].correlationId, 'corr-b');
});

test('levels 过滤不受新字段影响', () => {
    const lb = new LogBuffer();
    lb.add('系统', 'info msg', { correlationId: 'c1' });
    lb.add('配置', 'debug msg', { correlationId: 'c2' });
    const filtered = lb.getEntries({ levels: ['info'] });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].correlationId, 'c1');
});

// ==========================================
// 5. 边界情况
// ==========================================
console.log('\n--- 5. 边界情况 ---\n');

test('correlationId 为空字符串时存储 null（空字符串为 falsy）', () => {
    const lb = new LogBuffer();
    const entry = lb.add('系统', 'test', { correlationId: '' });
    assert.strictEqual(entry.correlationId, null);
});

test('maxSize 限制不受新字段影响', () => {
    const lb = new LogBuffer({ maxSize: 3 });
    lb.add('系统', '1', { correlationId: 'a' });
    lb.add('系统', '2', { correlationId: 'b' });
    lb.add('系统', '3', { correlationId: 'c' });
    lb.add('系统', '4', { correlationId: 'd' });
    assert.strictEqual(lb.size, 3);
    assert.strictEqual(lb.buffer[0].correlationId, 'b');
});

// ==========================================
// 结果
// ==========================================
console.log('\n=== 测试结果 ===\n');
console.log(`总计: ${testCount} 个测试`);
console.log(`通过: ${passCount} 个测试`);
console.log(`失败: ${testCount - passCount} 个测试`);

if (passCount === testCount) {
    console.log('\n✓ LogBuffer 自测全部通过！');
} else {
    console.log('\n✗ 存在失败的自测');
    process.exit(1);
}
