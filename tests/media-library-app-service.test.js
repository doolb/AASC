'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { MediaLibraryProvider, LocalProvider, HttpProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service.js');

const provider = new MediaLibraryProvider({});

test('detectMediaType 识别 html/htm/mhtml 文件', () => {
    assert.strictEqual(provider.detectMediaType('page.html'), 'html');
    assert.strictEqual(provider.detectMediaType('page.HTM'), 'html');
    assert.strictEqual(provider.detectMediaType('page.htm?t=123'), 'html');
    assert.strictEqual(provider.detectMediaType('page.mhtml'), 'html');
    assert.strictEqual(provider.detectMediaType('page.MHTML'), 'html');
});

test('detectMediaType 保持原有类型识别', () => {
    assert.strictEqual(provider.detectMediaType('a.gif'), 'gif');
    assert.strictEqual(provider.detectMediaType('a.mp4'), 'video');
    assert.strictEqual(provider.detectMediaType('a.jpg'), 'image');
});

test('detectMediaType 识别 wav/ogg/mp3 音频文件', () => {
    assert.strictEqual(provider.detectMediaType('voice.wav'), 'audio');
    assert.strictEqual(provider.detectMediaType('voice.OGG?download=1'), 'audio');
    assert.strictEqual(provider.detectMediaType('voice.MP3'), 'audio');
});

test('getPublicUrl 保留路径分隔符（/ 不编码为 %2F）', () => {
    // uploads 目录分支（子目录文件：/ 必须保留，否则 express.static 404）
    const uploadsDir = path.resolve(process.cwd(), 'res', 'uploads');
    const p1 = new LocalProvider({ path: uploadsDir }, {
        getPort: () => 8081,
        getLocalIP: () => '127.0.0.1',
        isHttps: () => false
    });
    const url1 = p1.getPublicUrl('html/[2V+16P_53M]习呆呆.html');
    assert.strictEqual(
        url1,
        'http://127.0.0.1:8081/uploads/html/%5B2V%2B16P_53M%5D%E4%B9%A0%E5%91%86%E5%91%86.html'
    );
    assert.ok(!url1.includes('%2F'), '路径分隔符不应被编码为 %2F');

    // 媒体库目录分支（routePrefix /media/{id}）
    const p2 = new LocalProvider({ id: 'media-lib-test', path: '/tmp/media-lib-test' }, {
        getPort: () => 8081,
        getLocalIP: () => '127.0.0.1',
        isHttps: () => false
    });
    const url2 = p2.getPublicUrl('sub/a b.jpg');
    assert.ok(url2.startsWith('http://127.0.0.1:8081/media/media-lib-test/sub/a%20b.jpg'));
    assert.ok(!url2.includes('%2F'), '路径分隔符不应被编码为 %2F');
});

test('parseRange 解析 bytes 区间', () => {
    const p = new MediaLibraryProvider({});
    assert.deepStrictEqual(p.parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepStrictEqual(p.parseRange('bytes=100-', 1000), { start: 100, end: 999 });
    assert.deepStrictEqual(p.parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    // 越界 end 截断到 totalSize-1
    assert.deepStrictEqual(p.parseRange('bytes=0-9999', 1000), { start: 0, end: 999 });
    // 非法/边界
    assert.strictEqual(p.parseRange(undefined, 1000), null);
    assert.strictEqual(p.parseRange('', 1000), null);
    assert.strictEqual(p.parseRange('bytes=-', 1000), null);
    assert.strictEqual(p.parseRange('bytes=500-100', 1000), null);
    assert.strictEqual(p.parseRange('bytes=1000-2000', 1000), null);
    assert.strictEqual(p.parseRange('bytes=0-99', 0), null);
    assert.strictEqual(p.parseRange('bytes=0-99', -1), null);
    assert.strictEqual(p.parseRange('items=0-99', 1000), null);
});

test('HttpProvider.getPublicUrl 返回同源 HTTPS 代理 URL', () => {
    const p = new HttpProvider({ id: 'h1', url: 'http://192.168.1.39' }, {
        getPort: () => 8081,
        getLocalIP: () => '192.168.1.39',
        isHttps: () => true
    });
    // encodeURIComponent 整段路径（/ 编成 %2F），express 通配符 * 可正确解码 %2F
    assert.strictEqual(
        p.getPublicUrl('/mnt/90461.jpg'),
        'https://192.168.1.39:8081/api/media-libraries/h1/proxy/mnt%2F90461.jpg'
    );
});

test('HttpProvider.getPublicUrl 服务器 HTTP 模式返回 http 代理 URL', () => {
    const p = new HttpProvider({ id: 'h1', url: 'http://192.168.1.39' }, {
        getPort: () => 8081,
        getLocalIP: () => '192.168.1.39',
        isHttps: () => false
    });
    assert.strictEqual(
        p.getPublicUrl('/mnt/a b.jpg'),
        'http://192.168.1.39:8081/api/media-libraries/h1/proxy/mnt%2Fa%20b.jpg'
    );
});

test('HttpProvider.getFileStream 文件 URL 无尾斜杠 + Range 转发 + 超时', async () => {
    const http = require('http');
    const requests = [];
    const srv = http.createServer((req, res) => {
        requests.push({ url: req.url, range: req.headers.range });
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': '100',
            'Accept-Ranges': 'bytes',
            'Content-Range': 'bytes 0-99/100'
        });
        res.end('x'.repeat(100));
    });
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    const p = new HttpProvider({ id: 'h', url: `http://127.0.0.1:${port}` }, {
        getPort: () => 8081,
        getLocalIP: () => '192.168.1.39',
        isHttps: () => false
    });
    try {
        // 无 range：URL 不应带尾斜杠，relay 200
        const r1 = await p.getFileStream('/mnt/a.mp4');
        // 消费流（生产代码用 pipe；测试需手动消费才触发 end）
        r1.stream.resume();
        await new Promise(r => r1.stream.on('end', r));
        assert.strictEqual(r1.statusCode, 200);
        assert.ok(!requests[0].url.endsWith('/'), '文件 URL 不应带尾斜杠');

        // 有 range：转发 Range 头
        const r2 = await p.getFileStream('/mnt/a.mp4', { start: 10, end: 19 });
        r2.stream.resume();
        await new Promise(r => r2.stream.on('end', r));
        assert.strictEqual(requests[1].range, 'bytes=10-19');
        assert.strictEqual(r2.headers['Content-Range'], 'bytes 0-99/100');

        // 超时：指向不可达端口应 8s 内失败而非无限挂起（_fetchList 是 connect 的 init 路径）
        const deadPort = 1; // 保留端口，连接必然失败
        const pd = new HttpProvider({ id: 'd', url: `http://127.0.0.1:${deadPort}`, requestTimeout: 500 }, {
            getPort: () => 8081, getLocalIP: () => '127.0.0.1', isHttps: () => false
        });
        const t0 = Date.now();
        await assert.rejects(() => pd._fetchList('/'), /请求超时|connect|ECONNREFUSED/);
        assert.ok(Date.now() - t0 < 3000, '不可达服务器应快速失败');
    } finally {
        srv.close();
    }
});

test('LocalProvider.getFileStream 支持 Range（206 + Content-Range）', async () => {
    const fs = require('fs');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-test-'));
    const filePath = path.join(dir, 'a.bin');
    fs.writeFileSync(filePath, Buffer.alloc(1000, 7));
    const p = new LocalProvider({ id: 'l', path: dir }, {
        getPort: () => 8081, getLocalIP: () => '127.0.0.1', isHttps: () => false
    });
    try {
        // 无 range → 200 全量
        const r1 = await p.getFileStream('a.bin');
        assert.strictEqual(r1.statusCode, 200);
        assert.strictEqual(r1.headers['Content-Length'], '1000');
        // 有 range → 206 切片
        const r2 = await p.getFileStream('a.bin', { start: 100, end: 199 });
        assert.strictEqual(r2.statusCode, 206);
        assert.strictEqual(r2.headers['Content-Length'], '100');
        assert.strictEqual(r2.headers['Content-Range'], 'bytes 100-199/1000');
        let n = 0;
        for await (const chunk of r2.stream) n += chunk.length;
        assert.strictEqual(n, 100);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('HttpProvider.getFile 返回 HEAD 获取的 size 与 modifiedTime', async () => {
    const http = require('http');
    const srv = http.createServer((req, res) => {
        if (req.method === 'HEAD') {
            res.writeHead(200, {
                'Content-Length': '16275103',
                'Last-Modified': 'Mon, 27 Apr 2026 02:48:00 GMT'
            });
            res.end();
        } else {
            res.writeHead(405);
            res.end();
        }
    });
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    const p = new HttpProvider({ id: 'h', url: `http://127.0.0.1:${port}` }, {
        getPort: () => 8081, getLocalIP: () => '192.168.1.39', isHttps: () => false
    });
    try {
        const info = await p.getFile('/mnt/a.mp4');
        assert.strictEqual(info.size, 16275103);
        assert.ok(info.modifiedTime instanceof Date);
        assert.strictEqual(
            info.modifiedTime.getTime(),
            new Date('Mon, 27 Apr 2026 02:48:00 GMT').getTime()
        );
    } finally {
        srv.close();
    }
});

test('HttpProvider._fetchList 对媒体文件并发 HEAD 补 size，文件夹不 HEAD', async () => {
    const http = require('http');
    const srv = http.createServer((req, res) => {
        if (req.method === 'HEAD') {
            const size = req.url.includes('a.mp4') ? 1000 : 2000;
            res.writeHead(200, {
                'Content-Length': String(size),
                'Last-Modified': 'Mon, 27 Apr 2026 02:48:00 GMT'
            });
            res.end();
        } else {
            const html = '<table>' +
                '<tr><td class="indexcolname"><a href="a.mp4">a.mp4</a></td><td class="indexcolsize"> 1K </td></tr>' +
                '<tr><td class="indexcolname"><a href="b.jpg">b.jpg</a></td><td class="indexcolsize"> 2K </td></tr>' +
                '<tr><td class="indexcolname"><a href="sub/">sub/</a></td></tr>' +
                '</table>';
            res.writeHead(200, { 'Content-Type': 'text/html;charset=UTF-8' });
            res.end(html);
        }
    });
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    const p = new HttpProvider({ id: 'h', url: `http://127.0.0.1:${port}` }, {
        getPort: () => 8081, getLocalIP: () => '192.168.1.39', isHttps: () => false
    });
    try {
        const items = await p._fetchList('/mnt');
        assert.strictEqual(items.find(i => i.name === 'a.mp4').size, 1000);
        assert.strictEqual(items.find(i => i.name === 'b.jpg').size, 2000);
        const sub = items.find(i => i.name === 'sub');
        assert.strictEqual(sub.type, 'folder');
        assert.strictEqual(sub.size, 0, '文件夹不应发 HEAD，size 保持 0');
    } finally {
        srv.close();
    }
});

test('HttpProvider HEAD 失败（404）回落 size=0 不抛错', async () => {
    const http = require('http');
    const srv = http.createServer((req, res) => {
        if (req.method === 'HEAD') {
            res.writeHead(404);
            res.end();
        } else {
            const html = '<table><tr><td class="indexcolname"><a href="a.mp4">a.mp4</a></td></tr></table>';
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        }
    });
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    const p = new HttpProvider({ id: 'h', url: `http://127.0.0.1:${port}` }, {
        getPort: () => 8081, getLocalIP: () => '192.168.1.39', isHttps: () => false
    });
    try {
        const items = await p._fetchList('/mnt');
        assert.strictEqual(items.find(i => i.name === 'a.mp4').size, 0, 'HEAD 失败回落 0');
        const info = await p.getFile('/mnt/a.mp4');
        assert.strictEqual(info.size, 0);
    } finally {
        srv.close();
    }
});
test('LocalProvider.list 将符号链接目录识别为文件夹并支持继续列举', async () => {
    const fs = require('fs');
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-symlink-test-'));
    const targetDir = path.join(dir, 'storage-target');
    const linkPath = path.join(dir, 'storage');
    fs.mkdirSync(path.join(targetDir, 'DCIM'), { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'DCIM', 'photo.jpg'), Buffer.from('test'));

    try {
        // Windows 使用 junction 避免测试依赖管理员权限，Termux/Linux 使用目录符号链接。
        fs.symlinkSync(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
        const provider = new LocalProvider({ id: 'symlink', path: dir }, {
            getPort: () => 8081,
            getLocalIP: () => '127.0.0.1',
            isHttps: () => false
        });

        const rootItems = await provider.list('/');
        const storageItem = rootItems.find(item => item.name === 'storage');
        assert.ok(storageItem, '符号链接目录应出现在根目录列表中');
        assert.strictEqual(storageItem.type, 'folder');
        assert.strictEqual(storageItem.mediaType, 'folder');

        const storageItems = await provider.list('/storage');
        const dcimItem = storageItems.find(item => item.name === 'DCIM');
        assert.ok(dcimItem, '符号链接目录的目标内容应可继续列举');
        assert.strictEqual(dcimItem.type, 'folder');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
