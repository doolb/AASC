'use strict';
// 独立静态入口用于本地预览；正式部署可把整个 web/pig-level 目录交给任意静态服务器。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../web/pig-level');
const levelFiles = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 94, 95, 97, 98, 99, 100, 101, 102, 103, 104, 112, 113, 114, 115, 116, 117, 118].map(level => `/level-${level}.json`);
const module3dFiles = ['presets', 'textures', 'geometry', 'models', 'scenery', 'grass', 'particles', 'environment', 'holo-ui', 'audio', 'post', 'view'].map(name => `/3d/${name}.mjs`);
const types = new Map([
    ['/index.html', 'text/html'],
    ['/style.css', 'text/css'],
    ['/app.mjs', 'text/javascript'],
    ['/engine.mjs', 'text/javascript'],
    ['/vendor/three.module.min.js', 'text/javascript'],
    ...module3dFiles.map(file => [file, 'text/javascript']),
    ...levelFiles.map(file => [file, 'application/json'])
]);
const server = http.createServer((request, response) => {
    try {
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
        const url = new URL(request.url, 'http://localhost');
        const name = url.pathname === '/' ? '/index.html' : url.pathname;
        if (!types.has(name)) { response.writeHead(404).end(); return; }
        const body = fs.readFileSync(path.join(root, name));
        response.writeHead(200, { 'content-type': `${types.get(name)}; charset=utf-8`, 'content-length': body.length, 'cache-control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) { response.writeHead(500).end('页面读取失败'); }
});
const host = process.env.PIG_LEVEL_HOST || '127.0.0.1';
const port = Number(process.env.PIG_LEVEL_PORT || 8788);
server.listen(port, host, () => console.log(`猪了个猪网页预览: http://${host}:${port}/?level=48`));
