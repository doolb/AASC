'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

function client(port) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/room`), queue = [], waiting = [];
    socket.on('message', bytes => { const message = JSON.parse(bytes); const index = waiting.findIndex(entry => entry.type === message.type);
        if (index < 0) queue.push(message); else { const [entry] = waiting.splice(index, 1); clearTimeout(entry.timer); entry.resolve(message); } });
    return { socket, ready: new Promise(resolve => socket.once('open', resolve)), send: data => socket.send(JSON.stringify(data)),
        take(type) { const index = queue.findIndex(message => message.type === type); if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
            return new Promise((resolve, reject) => { const entry = { type, resolve, timer: setTimeout(() => {
                waiting.splice(waiting.indexOf(entry), 1); reject(new Error(`等待 ${type} 超时`)); }, 4000) }; waiting.push(entry); }); } };
}

test('真实WebSocket多设备同房间广播、晚加入快照、所有权、顺序和断线', async t => {
    const { createLabServer } = await import('../3rd/imu-six-axis-test/server.mjs');
    const { ImuEngine } = await import('../3rd/imu-six-axis-test/imu-engine.mjs');
    const service = await createLabServer({ port: 0, host: '127.0.0.1' }); t.after(() => service.close());
    const first = client(service.port), second = client(service.port); await Promise.all([first.ready, second.ready]);
    first.send({ type: 'room.join', label: '模拟器' }); const joined = await first.take('room.joined');
    await first.take('device.update');
    second.send({ type: 'room.join', room: joined.room, label: '手机' }); const phone = await second.take('room.joined');
    await first.take('device.update'); await second.take('device.update');
    const frame = new ImuEngine().snapshot();
    first.send({ type: 'imu.frame', deviceId: joined.device.id, generation: joined.device.generation, sequence: 1, frame });
    const remote = await second.take('device.update'); await first.take('device.update');
    assert.equal(remote.device.id, joined.device.id); assert.deepEqual(remote.device.frame.position, frame.position);
    second.send({ type: 'imu.frame', deviceId: joined.device.id, generation: phone.device.generation, sequence: 1, frame });
    assert.match((await second.take('error')).message, /会话/);
    first.send({ type: 'imu.frame', deviceId: joined.device.id, generation: joined.device.generation, sequence: 1, frame });
    assert.match((await first.take('error')).message, /顺序/);
    const observer = client(service.port); await observer.ready;
    observer.send({ type: 'room.join', room: joined.room, role: 'viewer' }); const snapshot = await observer.take('room.joined');
    assert.equal(snapshot.device, null); assert.deepEqual(snapshot.devices.find(device => device.id === joined.device.id).frame.position, frame.position);
    second.socket.close(); const offline = await observer.take('device.update'); assert.equal(offline.device.online, false);
    const response = await fetch(`http://127.0.0.1:${service.port}/vendor/TransformControls.js`); assert.equal(response.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/server.mjs`)).status, 404);
});
