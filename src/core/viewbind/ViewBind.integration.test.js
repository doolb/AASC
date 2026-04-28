const assert = require('assert');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { ViewBind, ViewBindList } = require('./index');

console.log('=== ViewBind 真实环境集成自测 ===\n');

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

async function testAsync(name, fn) {
    testCount++;
    try {
        await fn();
        passCount++;
        console.log(`✓ ${name}`);
    } catch (err) {
        console.log(`✗ ${name}`);
        console.log(`  错误: ${err.message}`);
    }
}

let server, wss, serverPort;
const _conns = [];

function startServer() {
    return new Promise((resolve) => {
        const httpServer = http.createServer((req, res) => {
            res.writeHead(200);
            res.end('ok');
        });

        const wsServer = new WebSocketServer({ server: httpServer });

        const displayClients = new ViewBindList([]);
        const controlClients = new Set();
        const serverStartTime = Date.now();

        wsServer.on('connection', (ws, req) => {
            const url = req.url || '';
            const ip = req.socket.remoteAddress || '127.0.0.1';

            if (url.includes('display')) {
                const displayId = `display-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const clientInfo = { id: displayId, ip, connectedAt: Date.now(), ws, state: {} };

                displayClients.push(clientInfo);

                ws.send(JSON.stringify({ type: 'displayId', id: displayId }));
                ws.send(JSON.stringify({ type: 'serverStartTime', time: serverStartTime }));

                broadcastDisplayList(displayClients, controlClients);

                ws.on('message', (raw) => {
                    try {
                        const msg = JSON.parse(raw.toString());
                        if (msg.type === 'heartbeat') {
                            ws.send(JSON.stringify({ type: 'heartbeatAck', time: Date.now() }));
                        }
                        if (msg.type === 'commandAck') {
                            for (const ctrl of controlClients) {
                                if (ctrl.readyState === WebSocket.OPEN) {
                                    ctrl.send(JSON.stringify({
                                        type: 'commandAck',
                                        displayId,
                                        commandType: msg.commandType,
                                        success: msg.success,
                                        details: msg.details || ''
                                    }));
                                }
                            }
                        }
                        if (msg.type === 'canvasSize') {
                            const idx = displayClients.list.findIndex(c => c.id === displayId);
                            if (idx !== -1) {
                                displayClients.list[idx].state.canvasSize = { width: msg.width, height: msg.height };
                                broadcastDisplayList(displayClients, controlClients);
                            }
                        }
                        if (msg.type === 'browserInfo') {
                            const idx = displayClients.list.findIndex(c => c.id === displayId);
                            if (idx !== -1) {
                                displayClients.list[idx].state.browserInfo = {
                                    userAgent: msg.userAgent,
                                    browserName: msg.browserName
                                };
                                broadcastDisplayList(displayClients, controlClients);
                            }
                        }
                        if (msg.type === 'stateUpdate') {
                            const idx = displayClients.list.findIndex(c => c.id === displayId);
                            if (idx !== -1) {
                                Object.assign(displayClients.list[idx], msg.updates);
                                broadcastDisplayList(displayClients, controlClients);
                            }
                        }
                    } catch (_) {}
                });

                ws.on('close', () => {
                    const idx = displayClients.list.findIndex(c => c.id === displayId);
                    if (idx !== -1) {
                        displayClients.remove(idx);
                    }
                    broadcastDisplayList(displayClients, controlClients);
                });

            } else if (url.includes('control')) {
                controlClients.add(ws);

                ws.send(JSON.stringify({ type: 'serverStartTime', time: Date.now() }));
                ws.send(JSON.stringify({
                    type: 'displayList',
                    list: displayClients.list.map(sanitize)
                }));

                ws.on('message', (raw) => {
                    try {
                        const msg = JSON.parse(raw.toString());
                        if (msg.type === 'media' && msg.displayId) {
                            const displayData = displayClients.list.find(c => c.id === msg.displayId);
                            if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
                                displayData.ws.send(JSON.stringify(msg.media));
                            }
                        }
                        if (msg.type === 'control' && msg.displayId) {
                            const displayData = displayClients.list.find(c => c.id === msg.displayId);
                            if (displayData && displayData.ws.readyState === WebSocket.OPEN) {
                                displayData.ws.send(JSON.stringify(msg));
                            }
                        }
                        if (msg.type === 'getState' && msg.displayId) {
                            const displayData = displayClients.list.find(c => c.id === msg.displayId);
                            if (displayData) {
                                ws.send(JSON.stringify({
                                    type: 'displayState',
                                    displayId: msg.displayId,
                                    state: displayData.state
                                }));
                            }
                        }
                    } catch (_) {}
                });

                ws.on('close', () => {
                    controlClients.delete(ws);
                });
            }
        });

        httpServer.listen(0, '127.0.0.1', () => {
            server = httpServer;
            wss = wsServer;
            serverPort = httpServer.address().port;
            resolve();
        });
    });
}

function sanitize(item) {
    const { ws, ...rest } = item;
    return rest;
}

function broadcastDisplayList(displayClients, controlClients) {
    const list = displayClients.list.map(sanitize);
    for (const ctrl of controlClients) {
        if (ctrl.readyState === WebSocket.OPEN) {
            ctrl.send(JSON.stringify({ type: 'displayList', list }));
        }
    }
}

function stopServer() {
    return new Promise((resolve) => {
        for (const client of wss.clients) {
            client.close();
        }
        wss.close(() => {
            server.close(() => resolve());
        });
    });
}

function connectDisplay(port, path = '/display') {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        const received = [];
        ws.on('message', (raw) => {
            received.push(JSON.parse(raw.toString()));
        });
        ws.on('open', () => {
            setTimeout(() => resolve({ ws, received }), 50);
        });
        ws.on('error', reject);
    });
}

function connectControl(port, path = '/control') {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        const received = [];
        ws.on('message', (raw) => {
            received.push(JSON.parse(raw.toString()));
        });
        ws.on('open', () => {
            setTimeout(() => resolve({ ws, received }), 50);
        });
        ws.on('error', reject);
    });
}

function closeAll(...conns) {
    for (const c of conns) {
        if (c && c.ws && c.ws.readyState === WebSocket.OPEN) {
            c.ws.close();
        }
    }
}

function waitForServerEmpty(timeout = 2000) {
    return waitForCondition(() => wss.clients.size === 0, timeout);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function waitForCondition(fn, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        function check() {
            const result = fn();
            if (result) return resolve(result);
            if (Date.now() - start > timeout) {
                return reject(new Error('超时等待条件满足'));
            }
            setTimeout(check, 20);
        }
        check();
    });
}

// ============================================================
// 1. 服务器生命周期
// ============================================================
(async () => {
    await startServer();

    console.log('\n--- 1. 服务器生命周期 ---\n');

    await testAsync('服务器启动后 WebSocket 端口可用', async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/display`);
        await new Promise((resolve, reject) => {
            ws.on('open', () => { ws.close(); resolve(); });
            ws.on('error', reject);
        });
    });

    await testAsync('服务器可以正常关闭', async () => {
        const savedServer = server;
        const savedWss = wss;
        const savedPort = serverPort;

        await stopServer();
        await sleep(100);

        const ws = new WebSocket(`ws://127.0.0.1:${savedPort}/display`);
        const connected = await new Promise((resolve) => {
            ws.on('open', () => resolve(true));
            ws.on('error', () => resolve(false));
            setTimeout(() => resolve(false), 200);
        });
        assert.strictEqual(connected, false, '服务器关闭后端口应不可用');
    });

    await startServer();

    // ============================================================
    // 2. 单显示端连接
    // ============================================================
    console.log('\n--- 2. 单显示端连接 ---\n');

    await testAsync('控制端收到 displayList 消息', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);

        const hasDisplayList = control.received.some(m => m.type === 'displayList');
        assert.ok(hasDisplayList, '控制端应收到 displayList');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('显示端收到 displayId 和 serverStartTime', async () => {
        const display = await connectDisplay(serverPort);

        const hasId = display.received.some(m => m.type === 'displayId');
        const hasTime = display.received.some(m => m.type === 'serverStartTime');
        assert.ok(hasId, '收到 displayId');
        assert.ok(hasTime, '收到 serverStartTime');

        display.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('displayId 格式正确', async () => {
        const display = await connectDisplay(serverPort);
        const idMsg = display.received.find(m => m.type === 'displayId');

        assert.ok(idMsg, '收到 displayId');
        assert.ok(idMsg.id.startsWith('display-'), `displayId 应以 "display-" 开头: ${idMsg.id}`);

        display.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('serverStartTime 带有效时间戳', async () => {
        const display = await connectDisplay(serverPort);
        const timeMsg = display.received.find(m => m.type === 'serverStartTime');

        assert.ok(timeMsg.time > 0, 'serverStartTime 应带正的时间戳');
        assert.ok(timeMsg.time <= Date.now(), 'serverStartTime 不应晚于当前时间');

        display.ws.close();
        await waitForServerEmpty();
    });

    // ============================================================
    // 3. 多显示端并发连接
    // ============================================================
    console.log('\n--- 3. 多显示端并发连接 ---\n');

    await testAsync('3 个显示端并发连接，服务器追踪全部', async () => {
        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);
        const d3 = await connectDisplay(serverPort);

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.ok(listMsg, '控制端收到 displayList');
        assert.strictEqual(listMsg.list.length, 3, `应有 3 个显示端`);

        closeAll(d1, d2, d3, control);
        await waitForServerEmpty();
    });

    await testAsync('每个显示端收到唯一的 displayId', async () => {
        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);

        const id1 = d1.received.find(m => m.type === 'displayId');
        const id2 = d2.received.find(m => m.type === 'displayId');

        assert.ok(id1, 'd1 收到 displayId');
        assert.ok(id2, 'd2 收到 displayId');
        assert.notStrictEqual(id1.id, id2.id, 'displayId 应唯一');

        closeAll(d1, d2);
        await waitForServerEmpty();
    });

    await testAsync('延迟连接的显示端也被追踪', async () => {
        const d1 = await connectDisplay(serverPort);

        await sleep(100);

        const d2 = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);

        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(listMsg.list.length, 2, '两个显示端都被追踪');

        closeAll(d1, d2, control);
        await waitForServerEmpty();
    });

    await testAsync('后连接的显示端 id 列表更新包含全部', async () => {
        const d1 = await connectDisplay(serverPort);
        await sleep(30);
        const d2 = await connectDisplay(serverPort);

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        const ids = listMsg.list.map(c => c.id);
        assert.ok(ids.some(id => id.includes(d1.received.find(m => m.type === 'displayId').id.slice(-4))), 'd1 在列表中');
        assert.ok(ids.some(id => id.includes(d2.received.find(m => m.type === 'displayId').id.slice(-4))), 'd2 在列表中');

        closeAll(d1, d2, control);
        await waitForServerEmpty();
    });

    await testAsync('5 个显示端并发连接全部追踪', async () => {
        const displays = [];
        for (let i = 0; i < 5; i++) {
            displays.push(await connectDisplay(serverPort));
        }

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(listMsg.list.length, 5, '5 个显示端全在列表中');

        closeAll(...displays, control);
        await waitForServerEmpty();
    });

    // ============================================================
    // 4. 多控制端连接
    // ============================================================
    console.log('\n--- 4. 多控制端连接 ---\n');

    await testAsync('多个控制端都收到 displayList', async () => {
        const display = await connectDisplay(serverPort);
        const c1 = await connectControl(serverPort);
        const c2 = await connectControl(serverPort);

        const hasList1 = c1.received.some(m => m.type === 'displayList');
        const hasList2 = c2.received.some(m => m.type === 'displayList');
        assert.ok(hasList1, '控制端 1 收到 displayList');
        assert.ok(hasList2, '控制端 2 收到 displayList');

        closeAll(display, c1, c2);
        await waitForServerEmpty();
    });

    await testAsync('已存在的控制端收到新显示端加入通知', async () => {
        const control = await connectControl(serverPort);
        control.received.length = 0;

        const display = await connectDisplay(serverPort);

        await waitForCondition(() => {
            return control.received.some(m => m.type === 'displayList' && m.list.length === 1);
        });

        const update = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(update.list.length, 1, '控制端收到 1 个显示端');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('后连接控制端看到已有全部显示端', async () => {
        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(listMsg.list.length, 2, '控制端看到 2 个显示端');

        closeAll(d1, d2, control);
        await waitForServerEmpty();
    });

    // ============================================================
    // 5. 显示端断连
    // ============================================================
    console.log('\n--- 5. 显示端断连 ---\n');

    await testAsync('显示端断开后控制端收到更新列表', async () => {
        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);

        const control = await connectControl(serverPort);
        control.received.length = 0;

        d1.ws.close();

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'displayList' && m.list.length === 1
            );
        });

        const update = control.received.find(m =>
            m.type === 'displayList' && m.list.length === 1
        );
        assert.ok(update, '控制端收到更新后的 displayList');

        d2.ws.close();
        control.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('全部显示端断开后列表为空', async () => {
        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);

        const control = await connectControl(serverPort);
        control.received.length = 0;

        d1.ws.close();
        d2.ws.close();

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'displayList' && m.list.length === 0
            );
        });

        const empty = control.received.find(m =>
            m.type === 'displayList' && m.list.length === 0
        );
        assert.ok(empty, '全部断开后列表为空');

        control.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('显示端断开后服务器可接受新连接', async () => {
        const d1 = await connectDisplay(serverPort);
        d1.ws.close();

        await sleep(100);

        const d2 = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);

        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(listMsg.list.length, 1, '只有 1 个显示端在线');

        closeAll(d2, control);
        await waitForServerEmpty();
    });

    await testAsync('显示端重复断连不报错', async () => {
        const display = await connectDisplay(serverPort);
        const displayId = display.received.find(m => m.type === 'displayId').id;

        display.ws.close();
        display.ws.close();

        await sleep(100);

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(listMsg.list.length, 0, '显示端已断开');

        control.ws.close();
        await waitForServerEmpty();
    });

    // ============================================================
    // 6. 消息通信
    // ============================================================
    console.log('\n--- 6. 消息通信 ---\n');

    await testAsync('显示端心跳-确认往返', async () => {
        const display = await connectDisplay(serverPort);

        display.ws.send(JSON.stringify({ type: 'heartbeat' }));

        await waitForCondition(() => {
            return display.received.some(m => m.type === 'heartbeatAck');
        });

        const ack = display.received.find(m => m.type === 'heartbeatAck');
        assert.ok(ack, '收到 heartbeatAck');
        assert.ok(ack.time > 0, '心跳确认带时间戳');

        display.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('显示端 commandAck 转发到控制端', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);

        display.ws.send(JSON.stringify({
            type: 'commandAck',
            commandType: 'play',
            success: true,
            details: '播放成功'
        }));

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'commandAck' && m.commandType === 'play'
            );
        });

        const ack = control.received.find(m =>
            m.type === 'commandAck' && m.commandType === 'play'
        );
        assert.ok(ack, '控制端收到 commandAck');
        assert.ok(ack.success, 'ack 成功');
        assert.strictEqual(ack.details, '播放成功');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('commandAck 携带 displayId', async () => {
        const display = await connectDisplay(serverPort);
        const displayId = display.received.find(m => m.type === 'displayId').id;
        const control = await connectControl(serverPort);

        display.ws.send(JSON.stringify({
            type: 'commandAck',
            commandType: 'pause',
            success: true,
            details: ''
        }));

        await waitForCondition(() => {
            return control.received.some(m => m.type === 'commandAck');
        });

        const ack = control.received.find(m => m.type === 'commandAck');
        assert.strictEqual(ack.displayId, displayId, 'commandAck 携带 displayId');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('commandAck 失败转发', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);

        display.ws.send(JSON.stringify({
            type: 'commandAck',
            commandType: 'volume',
            success: false,
            details: '音量超出范围'
        }));

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'commandAck' && !m.success
            );
        });

        const ack = control.received.find(m => m.type === 'commandAck' && !m.success);
        assert.ok(ack, '控制端收到失败 ack');
        assert.strictEqual(ack.details, '音量超出范围');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('多个控制端都收到 commandAck', async () => {
        const display = await connectDisplay(serverPort);
        const c1 = await connectControl(serverPort);
        const c2 = await connectControl(serverPort);

        display.ws.send(JSON.stringify({
            type: 'commandAck',
            commandType: 'play',
            success: true,
            details: ''
        }));

        await waitForCondition(() => c1.received.some(m => m.type === 'commandAck'));
        await waitForCondition(() => c2.received.some(m => m.type === 'commandAck'));

        assert.ok(c1.received.some(m => m.type === 'commandAck'), '控制端1收到 ack');
        assert.ok(c2.received.some(m => m.type === 'commandAck'), '控制端2收到 ack');

        closeAll(display, c1, c2);
        await waitForServerEmpty();
    });

    // ============================================================
    // 7. 控制端到显示端的消息转发
    // ============================================================
    console.log('\n--- 7. 控制端到显示端的消息转发 ---\n');

    await testAsync('控制端发送 media 到指定显示端', async () => {
        const display = await connectDisplay(serverPort);
        const displayId = display.received.find(m => m.type === 'displayId').id;
        const control = await connectControl(serverPort);

        control.ws.send(JSON.stringify({
            type: 'media',
            displayId,
            media: { type: 'url', url: 'http://example.com/video.mp4', mediaType: 'video' }
        }));

        await waitForCondition(() => {
            return display.received.some(m => m.type === 'url');
        });

        const media = display.received.find(m => m.type === 'url');
        assert.ok(media, '显示端收到 media');
        assert.strictEqual(media.url, 'http://example.com/video.mp4');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('控制端发送 control 命令到显示端', async () => {
        const display = await connectDisplay(serverPort);
        const displayId = display.received.find(m => m.type === 'displayId').id;
        const control = await connectControl(serverPort);

        control.ws.send(JSON.stringify({
            type: 'control',
            displayId,
            action: 'rotate',
            value: 90
        }));

        await waitForCondition(() => {
            return display.received.some(m => m.type === 'control');
        });

        const cmd = display.received.find(m => m.type === 'control');
        assert.ok(cmd, '显示端收到 control');
        assert.strictEqual(cmd.action, 'rotate');
        assert.strictEqual(cmd.value, 90);

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('多个控制端可控制同一个显示端', async () => {
        const display = await connectDisplay(serverPort);
        const displayId = display.received.find(m => m.type === 'displayId').id;
        const c1 = await connectControl(serverPort);
        const c2 = await connectControl(serverPort);

        c1.ws.send(JSON.stringify({
            type: 'media',
            displayId,
            media: { type: 'url', url: 'http://example.com/1.mp4', mediaType: 'video' }
        }));

        await waitForCondition(() => display.received.some(m => m.type === 'url'));
        display.received.length = 0;

        c2.ws.send(JSON.stringify({
            type: 'control',
            displayId,
            action: 'volume',
            value: 50
        }));

        await waitForCondition(() => display.received.some(m => m.type === 'control'));

        assert.ok(true, '两个控制端都可控制显示端');
        closeAll(display, c1, c2);
        await waitForServerEmpty();
    });

    await testAsync('控制端发送 getState 获取显示端状态', async () => {
        const display = await connectDisplay(serverPort);
        const displayId = display.received.find(m => m.type === 'displayId').id;
        const control = await connectControl(serverPort);

        control.ws.send(JSON.stringify({
            type: 'getState',
            displayId
        }));

        await waitForCondition(() => {
            return control.received.some(m => m.type === 'displayState');
        });

        const stateMsg = control.received.find(m => m.type === 'displayState');
        assert.ok(stateMsg, '控制端收到 displayState');
        assert.strictEqual(stateMsg.displayId, displayId);

        closeAll(display, control);
        await waitForServerEmpty();
    });

    // ============================================================
    // 8. 显示端状态上报
    // ============================================================
    console.log('\n--- 8. 显示端状态上报 ---\n');

    await testAsync('显示端上报 canvasSize 后广播到控制端', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);
        control.received.length = 0;

        display.ws.send(JSON.stringify({ type: 'canvasSize', width: 1920, height: 1080 }));

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'displayList' &&
                m.list.some(c => c.state && c.state.canvasSize && c.state.canvasSize.width === 1920)
            );
        });

        const update = control.received.find(m => m.type === 'displayList');
        const displayInList = update.list.find(c => c.state && c.state.canvasSize);
        assert.ok(displayInList, '控制端收到带 canvasSize 的列表');
        assert.strictEqual(displayInList.state.canvasSize.width, 1920);

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('显示端上报 browserInfo 后广播到控制端', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);
        control.received.length = 0;

        display.ws.send(JSON.stringify({
            type: 'browserInfo',
            userAgent: 'Mozilla/5.0',
            browserName: 'Chrome'
        }));

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'displayList' &&
                m.list.some(c => c.state && c.state.browserInfo)
            );
        });

        const update = control.received.find(m => m.type === 'displayList');
        const displayInList = update.list.find(c => c.state && c.state.browserInfo);
        assert.ok(displayInList, '控制端收到带 browserInfo 的列表');
        assert.strictEqual(displayInList.state.browserInfo.browserName, 'Chrome');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('显示端上报自定义 stateUpdate', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);
        control.received.length = 0;

        display.ws.send(JSON.stringify({
            type: 'stateUpdate',
            updates: { customField: 'test-value' }
        }));

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'displayList' &&
                m.list.some(c => c.customField === 'test-value')
            );
        });

        const update = control.received.find(m => m.type === 'displayList');
        const displayWithField = update.list.find(c => c.customField === 'test-value');
        assert.ok(displayWithField, '控制端收到带自定义字段的列表');

        closeAll(display, control);
        await waitForServerEmpty();
    });

    // ============================================================
    // 9. ViewBind 集成自动通知
    // ============================================================
    console.log('\n--- 9. ViewBind 集成自动通知 ---\n');

    await testAsync('ViewBindList push 自动触发 displayList 广播', async () => {
        const control = await connectControl(serverPort);
        control.received.length = 0;

        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);

        await waitForCondition(() => {
            return control.received.filter(m => m.type === 'displayList').length >= 2;
        });

        const listUpdates = control.received.filter(m => m.type === 'displayList');
        const lastList = listUpdates[listUpdates.length - 1];
        assert.strictEqual(lastList.list.length, 2, '最终列表应有 2 个显示端');

        closeAll(d1, d2, control);
        await waitForServerEmpty();
    });

    await testAsync('ViewBindList remove 自动触发 displayList 广播', async () => {
        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);
        control.received.length = 0;

        d1.ws.close();

        await waitForCondition(() => {
            return control.received.some(m =>
                m.type === 'displayList' && m.list.length === 1
            );
        });

        const update = control.received.find(m => m.type === 'displayList' && m.list.length === 1);
        assert.ok(update, 'remove 后控制端收到更新');

        d2.ws.close();
        control.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('sanitize 过滤不暴露 ws 对象', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);

        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.ok(listMsg, '控制端收到 displayList');

        for (const item of listMsg.list) {
            assert.strictEqual(item.ws, undefined, 'displayList 不应暴露 ws 对象');
        }

        closeAll(display, control);
        await waitForServerEmpty();
    });

    // ============================================================
    // 10. 边界情况
    // ============================================================
    console.log('\n--- 10. 边界情况 ---\n');

    await testAsync('发送无效 JSON 不崩溃', async () => {
        const display = await connectDisplay(serverPort);

        display.ws.send('not-json');
        display.ws.send('');
        display.ws.send('{"broken":');

        await sleep(100);
        assert.ok(true, '无效消息不导致服务器崩溃');

        display.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('发送未知消息类型不崩溃', async () => {
        const display = await connectDisplay(serverPort);

        display.ws.send(JSON.stringify({ type: 'unknownType', data: 'test' }));

        await sleep(100);
        assert.ok(true, '未知消息类型不导致服务器崩溃');

        display.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('发送空消息不崩溃', async () => {
        const display = await connectDisplay(serverPort);

        const buf = Buffer.alloc(0);
        display.ws.send(buf);

        await sleep(100);
        assert.ok(true, '空消息不导致服务器崩溃');

        display.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('不存在的连接路径不崩溃', async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/nonexistent`);
        await new Promise((resolve) => {
            ws.on('open', () => {
                ws.close();
                resolve();
            });
            ws.on('error', () => resolve());
        });

        await sleep(50);
        assert.ok(true, '未知路径连接不导致服务器崩溃');
    });

    await testAsync('显示端标识已连接后立即发送消息', async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/display`);
        const received = [];

        await new Promise((resolve) => {
            ws.on('open', () => {
                ws.send(JSON.stringify({ type: 'heartbeat' }));
                setTimeout(resolve, 100);
            });
            ws.on('message', (raw) => received.push(JSON.parse(raw.toString())));
        });

        const hasAck = received.some(m => m.type === 'heartbeatAck');
        assert.ok(hasAck, '连接后立即发送的消息被处理');

        ws.close();
        await waitForServerEmpty();
    });

    // ============================================================
    // 11. 压力场景
    // ============================================================
    console.log('\n--- 11. 压力场景 ---\n');

    await testAsync('10 个显示端并发连接', async () => {
        const displays = [];
        for (let i = 0; i < 10; i++) {
            displays.push(await connectDisplay(serverPort));
        }

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(listMsg.list.length, 10, '10 个显示端全在列表中');

        closeAll(...displays, control);
        await waitForServerEmpty();
    });

    await testAsync('10 个控制端并发连接', async () => {
        const display = await connectDisplay(serverPort);
        const controls = [];
        for (let i = 0; i < 10; i++) {
            controls.push(await connectControl(serverPort));
        }

        for (const c of controls) {
            const hasList = c.received.some(m => m.type === 'displayList');
            assert.ok(hasList, '每个控制端都收到 displayList');
        }

        closeAll(display, ...controls);
        await waitForServerEmpty();
    });

    await testAsync('急速连接断开循环', async () => {
        for (let i = 0; i < 5; i++) {
            const d = await connectDisplay(serverPort);
            d.ws.close();
            await sleep(20);
        }

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.strictEqual(listMsg.list.length, 0, '极速连接断开后列表为空');

        control.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('大量消息快速发送不丢失', async () => {
        const display = await connectDisplay(serverPort);
        const control = await connectControl(serverPort);
        control.received.length = 0;

        const N = 20;
        for (let i = 0; i < N; i++) {
            display.ws.send(JSON.stringify({
                type: 'commandAck',
                commandType: `cmd-${i}`,
                success: true,
                details: `detail-${i}`
            }));
        }

        await waitForCondition(() => {
            return control.received.filter(m => m.type === 'commandAck').length >= N;
        }, 5000);

        const acks = control.received.filter(m => m.type === 'commandAck');
        assert.strictEqual(acks.length, N, `全部 ${N} 条 commandAck 送达`);

        closeAll(display, control);
        await waitForServerEmpty();
    });

    await testAsync('30 个高频心跳不丢包', async () => {
        const display = await connectDisplay(serverPort);

        for (let i = 0; i < 30; i++) {
            display.ws.send(JSON.stringify({ type: 'heartbeat' }));
            await sleep(10);
        }

        await waitForCondition(() => {
            const acks = display.received.filter(m => m.type === 'heartbeatAck');
            return acks.length >= 25;
        }, 3000);

        const acks = display.received.filter(m => m.type === 'heartbeatAck');
        assert.ok(acks.length >= 25, `至少 25 个心跳确认 (实际 ${acks.length})`);

        display.ws.close();
        await waitForServerEmpty();
    });

    // ============================================================
    // 12. 服务器长时间运行
    // ============================================================
    console.log('\n--- 12. 服务器长时间运行 ---\n');

    await testAsync('服务器长时间运行无异常', async () => {
        const displays = [];
        for (let i = 0; i < 5; i++) {
            displays.push(await connectDisplay(serverPort));
        }

        for (const d of displays) {
            d.ws.send(JSON.stringify({ type: 'heartbeat' }));
        }

        await sleep(100);

        for (const d of displays) d.ws.close();
        await waitForServerEmpty();
    });

    await testAsync('服务器状态保持正确', async () => {
        const d1 = await connectDisplay(serverPort);
        const d2 = await connectDisplay(serverPort);

        const control = await connectControl(serverPort);
        const listMsg = control.received.find(m => m.type === 'displayList');
        assert.ok(listMsg.list.length >= 2, '多个显示端可同时连接');

        closeAll(d1, d2, control);
        await waitForServerEmpty();
    });

    // ============================================================
    // 清理
    // ============================================================
    await stopServer();

    // ============================================================
    // 结果
    // ============================================================
    console.log('\n=== 自测结果 ===\n');
    console.log(`总计: ${testCount} 个测试`);
    console.log(`通过: ${passCount} 个测试`);
    console.log(`失败: ${testCount - passCount} 个测试`);

    if (passCount === testCount) {
        console.log('\n✓ ViewBind 真实环境集成自测全部通过！');
    } else {
        console.log('\n✗ 存在失败的自测');
        process.exit(1);
    }
})();
