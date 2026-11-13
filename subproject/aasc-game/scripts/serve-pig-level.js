'use strict';
// 独立静态入口用于本地预览；正式部署可把整个 web/pig-level 目录交给任意静态服务器。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../web/pig-level');
const types = new Map([['/index.html', 'text/html'], ['/style.css', 'text/css'], ['/app.mjs', 'text/javascript'], ['/engine.mjs', 'text/javascript'], ['/level-48.json', 'application/json'], ['/level-40.json', 'application/json']]);
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
server.listen(port, host, () => console.log(`第48关: http://${host}:${port}/?level=48`));
