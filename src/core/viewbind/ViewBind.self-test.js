const assert = require('assert');
const { ViewBind, ViewBindList } = require('./index');

console.log('=== ViewBind 通信机制自测 ===\n');

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



// ============================================================
// 1. 基础通信模式
// ============================================================
console.log('\n--- 1. 基础通信模式 ---\n');

test('数据变更通知订阅者', () => {
    const channel = new ViewBind({ msg: 'hello' });
    const received = [];

    channel.bind((data) => received.push(data.msg));

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0], 'hello');

    channel.data = { msg: 'world' };
    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[1], 'world');
});

test('多订阅者全部收到通知', () => {
    const channel = new ViewBind({ count: 0 });
    let a = 0, b = 0;

    channel.bind(() => a++);
    channel.bind(() => b++);

    assert.strictEqual(a, 1);
    assert.strictEqual(b, 1);

    channel.data = { count: 1 };
    assert.strictEqual(a, 2);
    assert.strictEqual(b, 2);
});

test('取消订阅后不再收到通知', () => {
    const channel = new ViewBind({ x: 1 });
    let count = 0;

    const unsub = channel.bind(() => count++);
    unsub();

    channel.data = { x: 2 };
    assert.strictEqual(count, 1);
});

test('指定 key 订阅: 全量 data 替换触发所有 key, notify(key) 只触发对应 key', () => {
    const channel = new ViewBind({ a: 1, b: 1 });
    let aCount = 0, bCount = 0;

    channel.bind('a', () => aCount++);
    channel.bind('b', () => bCount++);

    assert.strictEqual(aCount, 1);
    assert.strictEqual(bCount, 1);

    channel.data = { a: 2, b: 1 };
    assert.strictEqual(aCount, 2, 'data 替换触发所有回调');
    assert.strictEqual(bCount, 2, 'data 替换触发所有回调');

    channel.notify('a');
    assert.strictEqual(aCount, 3, 'notify(key) 只触发对应 key');
    assert.strictEqual(bCount, 2, 'notify(key) 不触发其他 key');
});

// ============================================================
// 2. 生产-消费通信模式
// ============================================================
console.log('\n--- 2. 生产-消费通信模式 ---\n');

test('生产者推送数据，消费者接收', () => {
    const bus = new ViewBind({});

    function producer(data) {
        bus.data = data;
    }

    const received = [];
    bus.bind((data) => received.push(data));

    received.length = 0;
    producer({ type: 'play', payload: 'video.mp4' });
    assert.deepStrictEqual(received[0], { type: 'play', payload: 'video.mp4' });

    producer({ type: 'pause', payload: null });
    assert.deepStrictEqual(received[1], { type: 'pause', payload: null });
});

test('一对多通信: 一个数据源更新多个消费者，notify(key) 精准通知', () => {
    const state = new ViewBind({ status: 'idle', progress: 0 });

    const statusLog = [];
    const progressLog = [];

    state.bind('status', (data) => statusLog.push(data.status));
    state.bind('progress', (data) => progressLog.push(data.progress));

    statusLog.length = 0;
    progressLog.length = 0;

    state.data = { status: 'loading', progress: 0 };
    assert.deepStrictEqual(statusLog, ['loading'], 'data 替换触发所有 key');
    assert.strictEqual(progressLog.length, 1, 'data 替换触发所有 key');

    state.notify('status');
    assert.deepStrictEqual(statusLog, ['loading', 'loading'], 'notify(key) 只触发 status');
    assert.strictEqual(progressLog.length, 1, 'progress 不变');

    state.notify('progress');
    assert.strictEqual(progressLog.length, 2, 'notify(key) 触发 progress');
});

test('多对一通信: 多个生产者写入同一 channel', () => {
    const channel = new ViewBind({ value: 0 });

    const log = [];
    channel.bind((data) => log.push(data.value));

    log.length = 0;

    function setA(v) { channel.data = { value: v }; }
    function setB(v) { channel.data = { value: v }; }

    setA(1);
    setB(2);
    setA(3);

    assert.deepStrictEqual(log, [1, 2, 3]);
});

// ============================================================
// 3. 重入一致性（通知中的动态操作）
// ============================================================
console.log('\n--- 3. 重入一致性 ---\n');

test('通知中解绑: 已取消的回调不再触发', () => {
    const bind = new ViewBind({ value: 0 });
    const order = [];

    const unsubA = bind.bind(() => order.push('a'));
    bind.bind(() => {
        order.push('b');
        unsubA();
    });

    assert.deepStrictEqual(order, ['a', 'b']);

    bind.data = { value: 1 };
    assert.deepStrictEqual(order, ['a', 'b', 'b']);
});

test('通知中绑定: 新绑定立即补发一次', () => {
    const bind = new ViewBind({ value: 0 });
    let lateCount = 0;

    bind.bind(() => {
        if (bind.data.value === 1) {
            bind.bind('late', () => lateCount++);
        }
    });

    assert.strictEqual(lateCount, 0);

    bind.data = { value: 1 };
    assert.strictEqual(lateCount, 1);
});

test('通知中改数据: 补帧刷新', () => {
    const bind = new ViewBind({ value: 0 });
    const log = [];

    bind.bind(() => {
        log.push(bind.data.value);
        if (bind.data.value === 1) {
            bind.data = { value: 2 };
        }
    });

    bind.data = { value: 1 };
    assert.strictEqual(bind.data.value, 2);
    assert.deepStrictEqual(log, [0, 1, 2]);
});

test('通知中替换回调: 旧回调取消新回调注册', () => {
    const bind = new ViewBind({ value: 0 });
    const log = [];

    const oldCb = () => log.push('old');
    const newCb = () => log.push('new');

    bind.bind(oldCb);
    bind.bind(() => {
        if (bind.data.value === 1) {
            bind.unbind(oldCb);
            bind.bind(newCb);
        }
    });

    log.length = 0;
    bind.data = { value: 1 };
    assert.deepStrictEqual(log, ['old', 'new']);

    bind.data = { value: 2 };
    assert.deepStrictEqual(log, ['old', 'new', 'new']);
});

test('深层重入: 嵌套 setData 补帧刷新', () => {
    const bind = new ViewBind({ count: 0 });
    const log = [];

    bind.bind(() => {
        log.push(bind.data.count);
        if (bind.data.count < 3) {
            bind.data = { count: bind.data.count + 1 };
        }
    });

    assert.deepStrictEqual(log, [0, 1, 2, 3], 'bind() 注册时触发链 0→1→2→3');
    assert.strictEqual(bind.data.count, 3);

    log.length = 0;
    bind.data = { count: 1 };
    assert.deepStrictEqual(log, [1, 2, 3], 'setData 触发链 1→2→3');
    assert.strictEqual(bind.data.count, 3);
});

// ============================================================
// 4. 列表通信模式
// ============================================================
console.log('\n--- 4. 列表通信模式 ---\n');

test('列表新增元素通知', () => {
    const list = new ViewBindList(['a']);
    const log = [];

    list.bind((newList, oldList, newCount, oldCount) => {
        log.push({ newCount, oldCount });
    });

    log.length = 0;
    list.push('b');

    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].newCount, 2);
    assert.strictEqual(log[0].oldCount, 1);
});

test('列表删除元素通知', () => {
    const list = new ViewBindList([1, 2, 3]);
    const log = [];

    list.bind((newList, oldList, newCount, oldCount) => {
        log.push({ newCount, oldCount });
    });

    log.length = 0;
    list.remove(1);

    assert.strictEqual(log.length, 1);
    assert.strictEqual(log[0].newCount, 2);
    assert.strictEqual(log[0].oldCount, 3);
});

test('列表 setList 按 data 引用复用 ViewBind', () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const c = { id: 3 };
    const list = new ViewBindList([a, b, c]);

    const bindA = list.get(0);
    const bindB = list.get(1);
    const bindC = list.get(2);

    let aCount = 0;
    bindA.bind(() => aCount++);

    list.setList([c, a, b]);

    assert.strictEqual(list.get(0), bindC, 'c 应在索引 0');
    assert.strictEqual(list.get(1), bindA, 'a 应在索引 1');
    assert.strictEqual(list.get(2), bindB, 'b 应在索引 2');

    assert.strictEqual(aCount, 1, '排序后复用 ViewBind，不额外触发');
});

test('列表通信: 插入和弹出', () => {
    const list = new ViewBindList([1, 2, 4]);
    let changeCount = 0;

    list.bind(() => changeCount++);

    changeCount = 0;
    list.insert(2, 3);
    assert.deepStrictEqual(list.list, [1, 2, 3, 4]);
    assert.strictEqual(changeCount, 1);

    const popped = list.pop();
    assert.strictEqual(popped, 4);
    assert.strictEqual(list.count, 3);
    assert.strictEqual(changeCount, 2);
});

test('列表通信: 更新指定元素触发对应 ViewBind', () => {
    const list = new ViewBindList([{ name: 'a' }, { name: 'b' }]);
    const itemBind = list.get(0);
    let itemCount = 0;

    itemBind.bind(() => itemCount++);

    itemCount = 0;
    list.update(0, { name: 'a_updated' });
    assert.strictEqual(itemCount, 1);
    assert.strictEqual(itemBind.data.name, 'a_updated');
});

// ============================================================
// 5. 链式通信（ViewBind 级联）
// ============================================================
console.log('\n--- 5. 链式通信 ---\n');

test('ViewBind 级联: 一个变化触发链式更新', () => {
    const source = new ViewBind({ value: 0 });
    const derived = new ViewBind({ doubled: 0 });

    source.bind((data) => {
        derived.data = { doubled: data.value * 2 };
    });

    let derivedResult = null;
    derived.bind((data) => {
        derivedResult = data.doubled;
    });

    source.data = { value: 5 };
    assert.strictEqual(derivedResult, 10);

    source.data = { value: 100 };
    assert.strictEqual(derivedResult, 200);
});

test('ViewBind 管道: 数据经过多个变换', () => {
    const raw = new ViewBind({ text: '' });
    const trimmed = new ViewBind({ text: '' });
    const uppercased = new ViewBind({ text: '' });

    raw.bind((data) => { trimmed.data = { text: data.text.trim() }; });
    trimmed.bind((data) => { uppercased.data = { text: data.text.toUpperCase() }; });

    let result = null;
    uppercased.bind((data) => { result = data.text; });

    raw.data = { text: '  hello world  ' };
    assert.strictEqual(result, 'HELLO WORLD');
});

test('ViewBindList + ViewBind 联动', () => {
    const list = new ViewBindList([]);
    const summary = new ViewBind({ count: 0, names: '' });

    list.bind((newList) => {
        summary.data = {
            count: newList.length,
            names: newList.map(item => item.name).join(', ')
        };
    });

    let summaryResult = null;
    summary.bind((data) => { summaryResult = data; });

    list.push({ name: 'Alice' });
    assert.strictEqual(summaryResult.count, 1);
    assert.strictEqual(summaryResult.names, 'Alice');

    list.push({ name: 'Bob' });
    assert.strictEqual(summaryResult.count, 2);
    assert.strictEqual(summaryResult.names, 'Alice, Bob');
});

// ============================================================
// 6. 边界情况
// ============================================================
console.log('\n--- 6. 边界情况 ---\n');

test('null 数据不触发变更', () => {
    const bind = new ViewBind(null);
    let count = 0;

    bind.bind(() => count++);
    assert.strictEqual(count, 1);

    bind.data = null;
    assert.strictEqual(count, 1);

    bind.data = { a: 1 };
    assert.strictEqual(count, 2);
});

test('完全相同的数据不重复通知', () => {
    const bind = new ViewBind({ x: 1, y: { z: 2 } });
    let count = 0;

    bind.bind(() => count++);

    bind.data = { x: 1, y: { z: 2 } };
    assert.strictEqual(count, 1);
});

test('unbindAll 清除全部订阅', () => {
    const bind = new ViewBind({ v: 0 });
    let a = 0, b = 0;

    bind.bind(() => a++);
    bind.bind('k', () => b++);

    bind.unbindAll();
    bind.data = { v: 1 };

    assert.strictEqual(a, 1);
    assert.strictEqual(b, 1);
});

test('unbindAll(key) 只清除指定 key', () => {
    const bind = new ViewBind({ v: 0 });
    let a = 0, b = 0;

    bind.bind('k1', () => a++);
    bind.bind('k2', () => b++);

    bind.unbindAll('k1');
    bind.data = { v: 1 };

    assert.strictEqual(a, 1);
    assert.strictEqual(b, 2);
});

test('deepEqual 处理数组差异', () => {
    const bind = new ViewBind({ items: [1, 2, 3] });
    let count = 0;

    bind.bind(() => count++);

    bind.data = { items: [1, 2, 3] };
    assert.strictEqual(count, 1);

    bind.data = { items: [1, 2, 3, 4] };
    assert.strictEqual(count, 2);
});

test('notify 手动触发通知', () => {
    const bind = new ViewBind({ x: 1 });
    let count = 0;

    bind.bind(() => count++);

    bind.notify();
    assert.strictEqual(count, 2);

    bind.notify();
    assert.strictEqual(count, 3);
});

test('notify(key) 手动触发指定 key', () => {
    const bind = new ViewBind({ a: 1, b: 2 });
    let aCount = 0, bCount = 0;

    bind.bind('a', () => aCount++);
    bind.bind('b', () => bCount++);

    bind.notify('a');
    assert.strictEqual(aCount, 2);
    assert.strictEqual(bCount, 1);
});

test('set/get 嵌套属性操作', () => {
    const bind = new ViewBind({ config: { theme: 'dark' } });
    let count = 0;

    bind.bind(() => count++);

    assert.strictEqual(bind.get('config').theme, 'dark');

    bind.set('config', { theme: 'light' });
    assert.strictEqual(bind.get('config').theme, 'light');
    assert.strictEqual(count, 2);
});

test('update 批量修改', () => {
    const bind = new ViewBind({ a: 1, b: 2 });
    let count = 0;

    bind.bind(() => count++);

    bind.update((data) => {
        data.a = 10;
        data.b = 20;
    });

    assert.strictEqual(bind.data.a, 10);
    assert.strictEqual(bind.data.b, 20);
    assert.strictEqual(count, 2);
});

// ============================================================
// 7. 错误隔离
// ============================================================
console.log('\n--- 7. 错误隔离 ---\n');

test('一个回调出错不影响其他回调', () => {
    const bind = new ViewBind({ v: 0 });
    const log = [];

    bind.unbindAll();
    bind.bind(() => { if (bind.data.v > 0) throw new Error('模拟错误'); });
    bind.bind(() => { if (bind.data.v > 0) log.push('ok'); });

    log.length = 0;
    bind.data = { v: 1 };

    assert.deepStrictEqual(log, ['ok']);
});

test('错误回调后正常回调仍需触发', () => {
    const bind = new ViewBind({ v: 0 });
    const order = [];

    bind.unbindAll();
    bind.bind(() => { if (bind.data.v > 0) { order.push('a'); throw new Error('err'); } });
    bind.bind(() => { if (bind.data.v > 0) order.push('b'); });
    bind.bind(() => { if (bind.data.v > 0) { order.push('c'); throw new Error('err2'); } });
    bind.bind(() => { if (bind.data.v > 0) order.push('d'); });

    order.length = 0;
    bind.data = { v: 1 };

    assert.deepStrictEqual(order, ['a', 'b', 'c', 'd']);
});

// ============================================================
// 8. 通信可靠性
// ============================================================
console.log('\n--- 8. 通信可靠性 ---\n');

test('高频连续 setData 全部送达', () => {
    const bind = new ViewBind({ i: 0 });
    const log = [];

    bind.bind((data) => log.push(data.i));

    log.length = 0;
    for (let i = 1; i <= 20; i++) {
        bind.data = { i };
    }

    assert.strictEqual(log.length, 20, '20 次更新全部送达');
    assert.strictEqual(log[0], 1);
    assert.strictEqual(log[log.length - 1], 20);
});

test('大量订阅者全部收到通知', () => {
    const bind = new ViewBind({ v: 0 });
    const counts = [];

    for (let i = 0; i < 50; i++) {
        counts.push(0);
        bind.bind(() => counts[i]++);
    }

    bind.data = { v: 1 };

    const allReceived = counts.every(c => c === 2);
    assert.ok(allReceived, '50 个订阅者都应收到 2 次通知（初始 + 变更）');
});

test('ViewBindList 高频 push 全部通知', () => {
    const list = new ViewBindList([]);
    let callCount = 0;

    list.bind(() => callCount++);

    callCount = 0;
    for (let i = 0; i < 30; i++) {
        list.push(i);
    }

    assert.strictEqual(callCount, 30);
    assert.strictEqual(list.count, 30);
});

test('解绑后不再泄漏回调', () => {
    const bind = new ViewBind({ v: 0 });
    let count = 0;

    const cb = () => count++;
    const unsub = bind.bind(cb);

    unsub();

    bind.unbind(cb);
    bind.unbindAll();

    assert.strictEqual(bind.bindCount, 0);
});

test('多次解绑相同回调不报错', () => {
    const bind = new ViewBind({ v: 0 });
    const cb = () => {};

    const unsub = bind.bind(cb);
    unsub();
    unsub();
    bind.unbind(cb);

    assert.strictEqual(bind.bindCount, 0);
});

// ============================================================
// 9. 完全解绑后不泄漏
// ============================================================
console.log('\n--- 9. 资源清理 ---\n');

test('ViewBind 全部解绑后 bindCount 归零', () => {
    const bind = new ViewBind({ v: 0 });
    bind.bind(() => {});
    bind.bind(() => {});

    bind.unbindAll();
    assert.strictEqual(bind.bindCount, 0);
});

test('ViewBindList 全部解绑后 bindCount 归零', () => {
    const list = new ViewBindList([1, 2]);
    list.bind(() => {});
    list.bind(() => {});

    list.unbindAll();
    assert.strictEqual(list.bindCount, 0);
});

test('ViewBindList clear 后 count 归零', () => {
    const list = new ViewBindList([1, 2, 3]);
    list.clear();
    assert.strictEqual(list.count, 0);
    assert.strictEqual(list.list.length, 0);
});

test('ViewBindList 空列表操作不报错', () => {
    const list = new ViewBindList([]);

    assert.strictEqual(list.pop(), undefined);
    assert.strictEqual(list.remove(0), false);
    assert.strictEqual(list.insert(1, 'x'), false);
    assert.strictEqual(list.update(0, 'x'), false);
    assert.strictEqual(list.get(0), null);
});

// ============================================================
// 10. 列表迭代方法
// ============================================================
console.log('\n--- 10. 列表迭代方法 ---\n');

test('forEach 遍历', () => {
    const list = new ViewBindList(['a', 'b', 'c']);
    const result = [];

    list.forEach((item, index, bind) => {
        result.push({ item, index, hasBind: bind instanceof ViewBind });
    });

    assert.strictEqual(result.length, 3);
    assert.ok(result[0].hasBind);
});

test('map 映射', () => {
    const list = new ViewBindList([1, 2, 3]);
    const result = list.map((item) => item * 10);

    assert.deepStrictEqual(result, [10, 20, 30]);
});

test('filter 过滤', () => {
    const list = new ViewBindList([1, 2, 3, 4, 5]);
    const result = list.filter((item) => item > 3);

    assert.deepStrictEqual(result, [4, 5]);
});

test('find 查找', () => {
    const list = new ViewBindList([{ id: 1 }, { id: 2 }]);
    const result = list.find((item) => item.id === 2);

    assert.deepStrictEqual(result, { id: 2 });
});

test('findIndex 查找索引', () => {
    const list = new ViewBindList([10, 20, 30, 40]);
    const idx = list.findIndex((item) => item === 30);

    assert.strictEqual(idx, 2);
});

// ============================================================
// 异步场景: 自测入口支持 async
// ============================================================
console.log('\n--- 异步综合场景 ---\n');

test('异步通信: 生产者延迟推送验证', () => {
    const channel = new ViewBind({ status: 'pending' });
    const received = [];

    channel.bind((data) => received.push(data.status));

    channel.data = { status: 'resolved' };
    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[1], 'resolved');
});

// ============================================================
// 结果
// ============================================================
console.log('\n=== 自测结果 ===\n');
console.log(`总计: ${testCount} 个测试`);
console.log(`通过: ${passCount} 个测试`);
console.log(`失败: ${testCount - passCount} 个测试`);

if (passCount === testCount) {
    console.log('\n✓ ViewBind 通信机制自测全部通过！');
} else {
    console.log('\n✗ 存在失败的自测');
    process.exit(1);
}

module.exports = { runTests: () => passCount === testCount };
