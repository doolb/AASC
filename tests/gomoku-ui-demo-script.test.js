const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

test('演示脚本只向当前显示端发送演示控制消息，不发送聊天消息', async t => {
    const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    t.after(() => server.close());
    const received = [];
    server.on('connection', socket => {
        socket.send(JSON.stringify({ type: 'displayList', list: [
            { id: 'display-current', isSubDisplay: false }
        ] }));
        socket.on('message', raw => {
            const message = JSON.parse(raw.toString());
            received.push(message);
            socket.send(JSON.stringify({ type: 'gameDemoResult', action: message.type,
                displayId: message.displayId, ok: true }));
        });
    });
    const script = path.resolve(__dirname, '../scripts/demo/gomoku-ui-demo.js');
    const child = spawn(process.execPath, [script, '--duration=100'], {
        env: { ...process.env, AASC_GOMOKU_SERVER_URL: `ws://127.0.0.1:${server.address().port}/control` }
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill(), 5000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    assert.equal(code, 0, output);
    assert.deepEqual(received.map(message => message.type), ['gameDemoStart', 'gameDemoStop']);
    assert.deepEqual(received.map(message => message.displayId), ['display-current', 'display-current']);
    assert.match(output, /已恢复原棋盘/);
});
