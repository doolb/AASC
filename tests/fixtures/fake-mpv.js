'use strict';

// 独立子进程模拟mpv JSON IPC，验证真实socket、进程生命周期及乱序事件，而非仅匹配源码。
const net = require('node:net');
const address = process.argv.find(value => value.startsWith('--input-ipc-server=')).slice('--input-ipc-server='.length);
const properties = {
    'time-pos': 0, duration: 120, pause: false, 'idle-active': true,
    'video-dec-params': { dw: 1280, dh: 720, rotate: 0 },
    'osd-dimensions': { w: 800, h: 600 }
};
const commands = [];
let loads = 0;
net.createServer(socket => {
    let buffer = '';
    const send = value => { if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`); };
    socket.on('error', () => {});
    socket.on('data', chunk => {
        buffer += chunk.toString();
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const { command, request_id: requestId } = JSON.parse(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            commands.push(command);
            const [name, key, value] = command;
            if (name === 'ignore') continue;
            const reply = data => send({ request_id: requestId, error: 'success', data });
            if (name === 'fail') { send({ request_id: requestId, error: 'property unavailable' }); continue; }
            if (name === 'observe_property') {
                reply(null);
                send({ event: 'property-change', name: value, data: properties[value] });
                continue;
            }
            if (name === 'get_property') {
                const special = { 'test-load-count': loads, 'test-command-log': commands, 'test-pid': process.pid };
                reply(Object.hasOwn(special, key) ? special[key] : properties[key]);
                continue;
            }
            if (name === 'set_property') {
                if (process.argv.includes('--fixture-no-scale') && key.startsWith('video-scale-')) {
                    send({ request_id: requestId, error: 'property not found' });
                    continue;
                }
                properties[key] = value;
                reply(null);
                send({ event: 'property-change', name: key, data: value });
                continue;
            }
            if (name === 'loadfile') {
                loads += 1;
                reply(null);
                if (key.includes('fail')) { send({ event: 'end-file', reason: 'error', file_error: 'fixture失败' }); continue; }
                if (key.includes('never-load')) continue;
                properties['idle-active'] = false;
                const loaded = () => {
                    send({ event: 'file-loaded' });
                    send({ event: 'property-change', name: 'idle-active', data: false });
                };
                if (key.includes('slow')) setTimeout(loaded, 200);
                else loaded();
                continue;
            }
            if (name === 'stop') properties['idle-active'] = true;
            if (name === 'seek') properties['time-pos'] = key;
            reply(null);
        }
    });
}).listen(address);
