'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service');

test('WebDAV 媒体库认证、目录、Range、写入和只读', async t => {
    const calls = [];
    const server = http.createServer((req, res) => {
        calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, range: req.headers.range });
        if (req.headers.authorization !== 'Basic ' + Buffer.from('user:pass').toString('base64')) { res.writeHead(401); res.end(); return; }
        if (req.method === 'PROPFIND') {
            res.writeHead(207, { 'content-type': 'application/xml' });
            res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/dav/%E4%B8%AD%E6%96%87.mp4</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>5</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>');
            return;
        }
        if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': '5' }); res.end(); return; }
        if (req.method === 'GET') { res.writeHead(206, { 'content-range': 'bytes 1-2/5', 'content-length': '2' }); res.end('bc'); return; }
        req.resume(); res.writeHead(201); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    const manager = new MediaLibraryManager();
    await manager.addLibrary({ id: 'dav', type: 'webdav', url: `http://127.0.0.1:${server.address().port}/dav`, username: 'user', password: 'pass' });
    const list = await manager.list('dav', '/');
    assert.equal(list[0].name, '中文.mp4');
    assert.equal(list[0].size, 5);
    const media = await manager.getFileStream('dav', '/中文.mp4', { start: 1, end: 2 });
    assert.equal((await Array.fromAsync(media.stream)).join(''), 'bc');
    assert.equal(calls.at(-1).range, 'bytes=1-2');
    await manager.createFolder('dav', '/', '新目录');
    await manager.upload('dav', '/', { filename: 'a.txt', data: Buffer.from('a') });
    await manager.delete('dav', '/a.txt');
    assert.deepEqual(calls.slice(-3).map(item => item.method), ['MKCOL', 'PUT', 'DELETE']);
    await assert.rejects(manager.deleteFolder('dav', '/'), /根目录/);
    manager.libraries.get('dav').config.readonly = true;
    await assert.rejects(manager.upload('dav', '/', { filename: 'a', data: Buffer.from('x') }), /只读/);
    await assert.rejects(manager.list('dav', '/../outside'), /路径无效/);
});

test('WebDAV 跨站媒体重定向不传递认证', async t => {
    let receivedAuth;
    const target = http.createServer((req, res) => { receivedAuth = req.headers.authorization; res.writeHead(200, { 'content-length': '2' }); res.end('ok'); });
    await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
    const source = http.createServer((req, res) => {
        if (req.method === 'PROPFIND') { res.writeHead(207); res.end('<d:multistatus xmlns:d="DAV:"/>'); return; }
        res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/file` }); res.end();
    });
    await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
    t.after(() => { source.close(); target.close(); });
    const manager = new MediaLibraryManager();
    await manager.addLibrary({ id: 'dav', type: 'webdav', url: `http://127.0.0.1:${source.address().port}/`, username: 'user', password: 'secret' });
    const media = await manager.getFileStream('dav', '/file.mp4');
    assert.equal((await Array.fromAsync(media.stream)).join(''), 'ok');
    assert.equal(receivedAuth, undefined);
    await assert.rejects(manager.delete('dav', '/file.mp4'), /跨站重定向/);
});
