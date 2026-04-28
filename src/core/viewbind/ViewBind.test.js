const assert = require('assert');
const ViewBind = require('./ViewBind');
const ViewBindList = require('./ViewBindList');

console.log('=== ViewBind 单元测试 ===\n');

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

console.log('--- ViewBind 测试 ---\n');

test('创建 ViewBind 实例，验证初始数据', () => {
    const bind = new ViewBind({ name: 'test', value: 123 });
    assert.strictEqual(bind.data.name, 'test');
    assert.strictEqual(bind.data.value, 123);
    assert.strictEqual(bind.bindCount, 0);
});

test('绑定回调，修改数据，验证回调触发', () => {
    const bind = new ViewBind({ count: 0 });
    let callCount = 0;
    let receivedData = null;

    bind.bind((data) => {
        callCount++;
        receivedData = data;
    });

    assert.strictEqual(callCount, 1);

    bind.data = { count: 1 };
    assert.strictEqual(callCount, 2);
    assert.deepStrictEqual(receivedData, { count: 1 });
});

test('绑定多个回调，验证全部触发', () => {
    const bind = new ViewBind({ value: 0 });
    let count1 = 0;
    let count2 = 0;

    bind.bind(() => count1++);
    bind.bind(() => count2++);

    assert.strictEqual(count1, 1);
    assert.strictEqual(count2, 1);

    bind.data = { value: 1 };
    assert.strictEqual(count1, 2);
    assert.strictEqual(count2, 2);
});

test('解绑回调，验证不再触发', () => {
    const bind = new ViewBind({ value: 0 });
    let callCount = 0;

    const unbind = bind.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    unbind();
    bind.data = { value: 1 };
    assert.strictEqual(callCount, 1);
});

test('使用 key 绑定，验证指定 key 触发', () => {
    const bind = new ViewBind({ a: 1, b: 2 });
    let callCount = 0;

    bind.bind('a', () => callCount++);

    assert.strictEqual(callCount, 1);

    bind.data = { a: 1, b: 3 };
    assert.strictEqual(callCount, 2);
});

test('使用 set 方法修改属性', () => {
    const bind = new ViewBind({ name: 'test' });
    let callCount = 0;

    bind.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    bind.set('name', 'new');
    assert.strictEqual(bind.data.name, 'new');
    assert.strictEqual(callCount, 2);
});

test('使用 update 方法批量更新', () => {
    const bind = new ViewBind({ a: 1, b: 2 });
    let callCount = 0;

    bind.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    bind.update((data) => {
        data.a = 10;
        data.b = 20;
    });

    assert.strictEqual(bind.data.a, 10);
    assert.strictEqual(bind.data.b, 20);
    assert.strictEqual(callCount, 2);
});

test('相同数据不触发回调', () => {
    const bind = new ViewBind({ value: 1 });
    let callCount = 0;

    bind.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    bind.data = { value: 1 };
    assert.strictEqual(callCount, 1);
});

test('手动触发通知', () => {
    const bind = new ViewBind({ value: 1 });
    let callCount = 0;

    bind.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    bind.notify();
    assert.strictEqual(callCount, 2);
});

test('unbindAll 清除所有绑定', () => {
    const bind = new ViewBind({ value: 0 });
    let callCount = 0;

    bind.bind(() => callCount++);
    bind.bind('key', () => callCount++);

    assert.strictEqual(callCount, 2);

    bind.unbindAll();
    bind.data = { value: 1 };
    assert.strictEqual(callCount, 2);
});

console.log('\n--- ViewBindList 测试 ---\n');

test('创建 ViewBindList 实例，验证初始列表', () => {
    const list = new ViewBindList([1, 2, 3]);
    assert.strictEqual(list.count, 3);
    assert.deepStrictEqual(list.list, [1, 2, 3]);
    assert.strictEqual(list.bindCount, 0);
});

test('绑定回调，添加元素，验证回调触发', () => {
    const list = new ViewBindList([1, 2]);
    let callCount = 0;
    let receivedList = null;

    list.bind((newList, oldList, newCount, oldCount) => {
        callCount++;
        receivedList = newList;
    });

    assert.strictEqual(callCount, 1);

    list.push(3);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(receivedList.length, 3);
});

test('移除元素，验证回调触发', () => {
    const list = new ViewBindList([1, 2, 3]);
    let callCount = 0;

    list.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    list.remove(1);
    assert.strictEqual(list.count, 2);
    assert.strictEqual(callCount, 2);
});

test('获取元素 ViewBind，修改元素', () => {
    const list = new ViewBindList([{ id: 1 }, { id: 2 }]);
    const firstBind = list.get(0);

    assert.ok(firstBind instanceof ViewBind);
    assert.deepStrictEqual(firstBind.data, { id: 1 });

    let elementCallCount = 0;
    firstBind.bind(() => elementCallCount++);

    assert.strictEqual(elementCallCount, 1);

    list.update(0, { id: 10 });
    assert.strictEqual(elementCallCount, 2);
});

test('设置新列表，验证回调触发', () => {
    const list = new ViewBindList([1, 2]);
    let callCount = 0;

    list.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    list.setList([3, 4, 5]);
    assert.strictEqual(list.count, 3);
    assert.strictEqual(callCount, 2);
});

test('insert 方法插入元素', () => {
    const list = new ViewBindList([1, 3]);
    let callCount = 0;

    list.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    list.insert(1, 2);
    assert.deepStrictEqual(list.list, [1, 2, 3]);
    assert.strictEqual(callCount, 2);
});

test('pop 方法移除最后一个元素', () => {
    const list = new ViewBindList([1, 2, 3]);
    let callCount = 0;

    list.bind(() => callCount++);

    const item = list.pop();
    assert.strictEqual(item, 3);
    assert.strictEqual(list.count, 2);
    assert.strictEqual(callCount, 2);
});

test('clear 方法清空列表', () => {
    const list = new ViewBindList([1, 2, 3]);
    let callCount = 0;

    list.bind(() => callCount++);

    list.clear();
    assert.strictEqual(list.count, 0);
    assert.strictEqual(callCount, 2);
});

test('解绑回调，验证不再触发', () => {
    const list = new ViewBindList([1, 2]);
    let callCount = 0;

    const unbind = list.bind(() => callCount++);

    assert.strictEqual(callCount, 1);

    unbind();
    list.push(3);
    assert.strictEqual(callCount, 1);
});

test('forEach 遍历列表', () => {
    const list = new ViewBindList([1, 2, 3]);
    const result = [];

    list.forEach((item, index) => {
        result.push(`${index}:${item}`);
    });

    assert.deepStrictEqual(result, ['0:1', '1:2', '2:3']);
});

test('map 映射列表', () => {
    const list = new ViewBindList([1, 2, 3]);
    const result = list.map((item) => item * 2);

    assert.deepStrictEqual(result, [2, 4, 6]);
});

test('filter 过滤列表', () => {
    const list = new ViewBindList([1, 2, 3, 4]);
    const result = list.filter((item) => item > 2);

    assert.deepStrictEqual(result, [3, 4]);
});

test('find 查找元素', () => {
    const list = new ViewBindList([{ id: 1 }, { id: 2 }]);
    const result = list.find((item) => item.id === 2);

    assert.deepStrictEqual(result, { id: 2 });
});

console.log('\n--- 回调重入测试 ---\n');

test('回调中解绑立即生效', () => {
    const bind = new ViewBind({ value: 0 });
    let callOrder = [];

    const unbindA = bind.bind(() => { callOrder.push('a'); });

    bind.bind(() => {
        callOrder.push('b');
        unbindA();
    });

    assert.deepStrictEqual(callOrder, ['a', 'b']);

    bind.data = { value: 1 };
    assert.deepStrictEqual(callOrder, ['a', 'b', 'b']);
});

test('回调中绑定会补发', () => {
    const bind = new ViewBind({ value: 0 });
    let lateCallCount = 0;

    bind.bind(() => {
        if (bind.data.value === 1) {
            bind.bind('late', () => lateCallCount++);
        }
    });

    assert.strictEqual(lateCallCount, 0);

    bind.data = { value: 1 };
    assert.strictEqual(lateCallCount, 1);
});

test('回调中改Data补帧刷新', () => {
    const bind = new ViewBind({ value: 0 });
    let callCount = 0;

    bind.bind(() => {
        callCount++;
        if (bind.data.value === 1) {
            bind.data = { value: 2 };
        }
    });

    assert.strictEqual(callCount, 1);

    bind.data = { value: 1 };
    assert.strictEqual(bind.data.value, 2, '最终数据应为 2');
    assert.ok(callCount >= 3, '应至少触发 3 次（初始 + 设为1 + 补帧设为2）');
});

test('回调中替换回调函数', () => {
    const bind = new ViewBind({ value: 0 });
    let log = [];

    const oldCb = () => log.push('old');
    const newCb = () => log.push('new');

    bind.bind(oldCb);

    bind.bind(() => {
        if (bind.data.value === 1) {
            bind.unbind(oldCb);
            bind.bind(newCb);
        }
    });

    log = [];
    bind.data = { value: 1 };
    assert.deepStrictEqual(log, ['old', 'new']);

    bind.data = { value: 2 };
    assert.deepStrictEqual(log, ['old', 'new', 'new']);
});

console.log('\n--- ViewBindList 一致性测试 ---\n');

test('List长度回调old/new正确', () => {
    const list = new ViewBindList([1, 2, 3]);
    let lastNewCount = -1;
    let lastOldCount = -1;

    list.bind((newList, oldList, newCount, oldCount) => {
        lastNewCount = newCount;
        lastOldCount = oldCount;
    });

    list.push(4);
    assert.strictEqual(lastNewCount, 4);
    assert.strictEqual(lastOldCount, 3);

    list.remove(0);
    assert.strictEqual(lastNewCount, 3);
    assert.strictEqual(lastOldCount, 4);
});

test('List按data定位刷新正确', () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const c = { id: 3 };
    const list = new ViewBindList([a, b, c]);
    const firstBind = list.get(0);

    let itemCallCount = 0;
    firstBind.bind(() => itemCallCount++);

    assert.strictEqual(itemCallCount, 1);

    list.setList([a, b, c]);
    const newFirstBind = list.get(0);
    assert.strictEqual(firstBind, newFirstBind, '相同 data 引用的 ViewBind 应复用');

    list.setList([{ id: 4 }, b, c]);
    const replacedBind = list.get(0);
    assert.notStrictEqual(firstBind, replacedBind, '不同 data 应创建新 ViewBind');
});

test('List排序后索引重建正确', () => {
    const a = { id: 1, name: 'a' };
    const b = { id: 2, name: 'b' };
    const c = { id: 3, name: 'c' };
    const list = new ViewBindList([a, b, c]);

    const bindA = list.get(0);
    const bindB = list.get(1);
    const bindC = list.get(2);

    list.setList([c, a, b]);

    assert.strictEqual(list.get(0), bindC, 'c 应在索引 0');
    assert.strictEqual(list.get(1), bindA, 'a 应在索引 1');
    assert.strictEqual(list.get(2), bindB, 'b 应在索引 2');
});

console.log('\n=== 测试结果 ===\n');
console.log(`总计: ${testCount} 个测试`);
console.log(`通过: ${passCount} 个测试`);
console.log(`失败: ${testCount - passCount} 个测试`);

if (passCount === testCount) {
    console.log('\n✓ 所有测试通过！');
    process.exit(0);
} else {
    console.log('\n✗ 存在失败的测试');
    process.exit(1);
}
