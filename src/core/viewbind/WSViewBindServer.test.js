const assert = require('assert');
const ViewBind = require('./ViewBind');
const WSViewBindServer = require('./WSViewBindServer');

console.log('=== WSViewBindServer 功能自测 ===\n');

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
// 1. 初始化
// ==========================================
console.log('--- 1. 初始化 ---\n');

test('创建 WSViewBindServer 实例', () => {
    const server = new WSViewBindServer();
    assert.ok(server, '实例创建成功');
    assert.strictEqual(server.displayClients.count, 0, '初始显示端为 0');
    assert.strictEqual(server.controlClients.size, 0, '初始控制端为 0');
    assert.strictEqual(server.handlers.size, 0, '初始 handler 为空');
});

test('getStats 返回初始值', () => {
    const server = new WSViewBindServer();
    const stats = server.getStats();
    assert.strictEqual(stats.displayClients, 0);
    assert.strictEqual(stats.controlClients, 0);
    assert.strictEqual(stats.handlers, 0);
});

// ==========================================
// 2. 显示端管理
// ==========================================
console.log('\n--- 2. 显示端管理 ---\n');

test('handleDisplayConnect 添加显示端', () => {
    const server = new WSViewBindServer();
    const ws = { readyState: 1, send() {} };
    server.handleDisplayConnect('display-1', '192.168.1.100', ws);
    assert.strictEqual(server.displayClients.count, 1, '显示端数量为 1');
});

test('添加多个显示端', () => {
    const server = new WSViewBindServer();
    for (let i = 1; i <= 3; i++) {
        server.handleDisplayConnect(`display-${i}`, `192.168.1.10${i}`, { readyState: 1, send() {} });
    }
    assert.strictEqual(server.displayClients.count, 3);
});

test('handleDisplayDisconnect 移除显示端', () => {
    const server = new WSViewBindServer();
    server.handleDisplayConnect('display-1', '192.168.1.100', { readyState: 1, send() {} });
    server.handleDisplayConnect('display-2', '192.168.1.101', { readyState: 1, send() {} });
    assert.strictEqual(server.displayClients.count, 2);

    server.handleDisplayDisconnect('display-1');
    assert.strictEqual(server.displayClients.count, 1, '移除后剩 1 个');
});

test('handleDisplayConnect 支持 savedState', () => {
    const server = new WSViewBindServer();
    const ws = { readyState: 1, send() {} };
    const savedState = { volume: 50, isPlaying: true, currentMedia: { url: 'test.mp4' } };
    const vb = server.handleDisplayConnect('display-1', '192.168.1.100', ws, savedState);
    assert.ok(vb instanceof ViewBind, '返回 ViewBind 实例');
    assert.strictEqual(vb.data.state.volume, 50, 'savedState 已合并');
    assert.strictEqual(vb.data.state.isPlaying, true);
});

// ==========================================
// 3. handler 注册与调用
// ==========================================
console.log('\n--- 3. handler 注册与调用 ---\n');

test('registerHandler 注册后 handler 数量增加', () => {
    const server = new WSViewBindServer();
    server.registerHandler('test', () => {});
    assert.strictEqual(server.handlers.size, 1);
});

test('handleControlMessage 调用已注册的 handler', () => {
    const server = new WSViewBindServer();
    let called = false;
    server.registerHandler('testCommand', (data, context) => {
        called = true;
        assert.strictEqual(data.type, 'testCommand');
        assert.ok(context.ws);
        assert.ok(context.server);
    });
    server.handleControlMessage({ type: 'testCommand', value: 1 }, { readyState: 1 });
    assert.ok(called, 'handler 被调用');
});

test('handleControlMessage 不匹配 type 不崩溃', () => {
    const server = new WSViewBindServer();
    server.registerHandler('knownType', () => {});
    const result = server.handleControlMessage({ type: 'unknownType' }, {});
    assert.ok(result.success, '未知 type 不崩溃');
});

test('handler 执行出错不传播', () => {
    const server = new WSViewBindServer();
    server.registerHandler('errorType', () => {
        throw new Error('handler error');
    });
    const result = server.handleControlMessage({ type: 'errorType' }, {});
    assert.strictEqual(result.success, false, '失败也返回 success false');
    assert.ok(result.error, '带错误信息');
});

// ==========================================
// 4. 控制端管理
// ==========================================
console.log('\n--- 4. 控制端管理 ---\n');

test('handleControlConnect 添加控制端', () => {
    const server = new WSViewBindServer();
    server.handleControlConnect({ readyState: 1 });
    assert.strictEqual(server.controlClients.size, 1);
});

test('handleControlDisconnect 移除控制端', () => {
    const server = new WSViewBindServer();
    const ws = { readyState: 1 };
    server.handleControlConnect(ws);
    assert.strictEqual(server.controlClients.size, 1);
    server.handleControlDisconnect(ws);
    assert.strictEqual(server.controlClients.size, 0);
});

// ==========================================
// 5. 生命周期回调
// ==========================================
console.log('\n--- 5. 生命周期回调 ---\n');

test('setCallbacks 注册的生命周期回调被调用', () => {
    const server = new WSViewBindServer();
    let connectCalled = false;
    let disconnectCalled = false;

    server.setCallbacks({
        onDisplayConnect: (id) => { connectCalled = true; },
        onDisplayDisconnect: (id) => { disconnectCalled = true; }
    });

    server.handleDisplayConnect('d1', 'ip', { readyState: 1, send() {} });
    assert.ok(connectCalled, 'onDisplayConnect 被调用');

    server.handleDisplayDisconnect('d1');
    assert.ok(disconnectCalled, 'onDisplayDisconnect 被调用');
});

test('控制端生命周期回调', () => {
    const server = new WSViewBindServer();
    let ctrlConnect = false;
    let ctrlDisconnect = false;

    server.setCallbacks({
        onControlConnect: () => { ctrlConnect = true; },
        onControlDisconnect: () => { ctrlDisconnect = true; }
    });

    const ws = { readyState: 1 };
    server.handleControlConnect(ws);
    assert.ok(ctrlConnect, 'onControlConnect 被调用');

    server.handleControlDisconnect(ws);
    assert.ok(ctrlDisconnect, 'onControlDisconnect 被调用');
});

// ==========================================
// 6. getDisplayList
// ==========================================
console.log('\n--- 6. getDisplayList ---\n');

test('getDisplayList 返回空列表', () => {
    const server = new WSViewBindServer();
    const list = server.getDisplayList();
    assert.ok(Array.isArray(list));
    assert.strictEqual(list.length, 0);
});

test('getDisplayList 含显示端数据', () => {
    const server = new WSViewBindServer();
    const ws = { readyState: 1, send() {} };
    const vb = server.handleDisplayConnect('disp-1', '10.0.0.1', ws);

    // 设置 displayId
    const d = vb.data;
    d.displayId = 'disp-1';
    vb.data = d;

    const list = server.getDisplayList();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'disp-1');
    assert.strictEqual(list[0].ip, '10.0.0.1');
});

// ==========================================
// 7. shutdown
// ==========================================
console.log('\n--- 7. shutdown ---\n');

test('shutdown 清空所有连接', () => {
    const server = new WSViewBindServer();
    server.handleDisplayConnect('d1', 'ip', { readyState: 1, send() {} });
    server.handleControlConnect({ readyState: 1 });
    server.registerHandler('test', () => {});

    server.shutdown();

    assert.strictEqual(server.displayClients.count, 0);
    assert.strictEqual(server.controlClients.size, 0);
    assert.strictEqual(server.handlers.size, 0);
});

test('重复 shutdown 不报错', () => {
    const server = new WSViewBindServer();
    server.shutdown();
    server.shutdown();
    assert.ok(true);
});

// ==========================================
// 结果
// ==========================================
console.log('\n=== 测试结果 ===\n');
console.log(`总计: ${testCount} 个测试`);
console.log(`通过: ${passCount} 个测试`);
console.log(`失败: ${testCount - passCount} 个测试`);

if (passCount === testCount) {
    console.log('\n✓ WSViewBindServer 自测全部通过！');
} else {
    console.log('\n✗ 存在失败的自测');
    process.exit(1);
}
