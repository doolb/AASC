'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createChatMediaGc } = require('../src/apps/server/modules/sub-ai/chat-media-gc');
const { createChatAttachmentService } = require('../src/apps/server/modules/sub-ai/chat-attachment-service');
async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-media-gc-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const historyDir = path.join(root, 'user'); const uploadsDir = path.join(root, 'uploads');
    await fs.mkdir(historyDir); await fs.mkdir(uploadsDir);
    const gc = createChatMediaGc({ historyDir, uploadsDir, graceMs: 0 }); t.after(() => gc.stop());
    const make = async (group, ext) => {
        const id = randomUUID(); const directory = path.join(uploadsDir, group); await fs.mkdir(directory, { recursive: true });
        const file = path.join(directory, `${id}.${ext}`); await fs.writeFile(file, 'owned');
        return { id, file, url: `/uploads/${group}/${id}.${ext}` };
    };
    return { root, historyDir, uploadsDir, gc, make };
}
test('清空后仍保护其他profile/会话和备份的图片、视频、封面；备份轮换后才回收', async t => {
    const { root, historyDir, gc, make } = await fixture(t);
    const image = await make('chat-images', 'png'); const video = await make('chat-videos', 'mp4'); const poster = await make('chat-images', 'jpg');
    const discarded = await make('chat-videos', 'webm');
    await fs.mkdir(path.join(historyDir, 'other-profile'));
    await fs.writeFile(path.join(historyDir, 'other-profile/chat-history-private.json'), JSON.stringify([{ images: [image] }]));
    const backup = path.join(root, 'aasc-user-backups/aasc-user-previous-day-2026-10-22'); await fs.mkdir(backup, { recursive: true });
    await fs.writeFile(path.join(backup, 'chat-history.json'), JSON.stringify([{ videos: [{ ...video, posterUrl: poster.url }] }]));
    assert.equal((await gc.run()).removed, 1); await assert.rejects(fs.access(discarded.file));
    for (const asset of [image, video, poster]) await fs.access(asset.file);
    await fs.rm(backup, { recursive: true }); assert.equal((await gc.run()).removed, 2); await fs.access(image.file);
    await fs.writeFile(path.join(historyDir, 'other-profile/chat-history-private.json'), '[]');
    assert.equal((await gc.run()).removed, 1);
});
test('历史损坏时不删除；非受管文件和符号链接不跟随，写入中不回收', async t => {
    const { historyDir, uploadsDir, gc, make } = await fixture(t); const asset = await make('chat-images', 'png');
    const history = path.join(historyDir, 'chat-history.json'); await fs.writeFile(history, 'invalid');
    await assert.rejects(gc.run()); await fs.access(asset.file);
    await fs.writeFile(history, '[]'); const unrelated = path.join(uploadsDir, 'chat-images/personal.png'); await fs.writeFile(unrelated, 'keep');
    const link = path.join(uploadsDir, 'chat-images', `${randomUUID()}.png`); await fs.symlink(unrelated, link);
    await gc.write(async () => assert.equal((await gc.run()).deferred, true));
    assert.equal((await gc.run()).removed, 1); await fs.access(unrelated); assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
});
test('上传文本可解码UTF16，草稿租约跨服务重建保留；绑定且清空后删除文件和元数据', async t => {
    const { uploadsDir, gc } = await fixture(t); const service = createChatAttachmentService({ uploadsDir, gc });
    const upload = path.join(uploadsDir, 'input.tmp'); const content = Buffer.concat([Buffer.from([255, 254]), Buffer.from('你好\n附件', 'utf16le')]); await fs.writeFile(upload, content);
    const asset = await service.ingest({ originalname: '对话.txt', path: upload, size: content.length });
    assert.equal((await service.read(asset)).data.toString(), '你好\n附件');
    const restarted = createChatMediaGc({ uploadsDir, historyDir: path.join(uploadsDir, '..', 'user'), graceMs: 0 }); t.after(() => restarted.stop());
    assert.equal((await restarted.run()).removed, 0);
    await service.bind([asset]); assert.equal((await gc.run()).removed, 2);
    await assert.rejects(service.read(asset)); await fs.access(upload);
});
test('视频开关、单条数量、伪造ID和二进制文本在服务端拒绝', async t => {
    const { uploadsDir, gc } = await fixture(t); const service = createChatAttachmentService({ uploadsDir, gc });
    const file = path.join(uploadsDir, 'video.tmp'); const bytes = Buffer.from('0000ftypisom0000'); await fs.writeFile(file, bytes);
    const asset = await service.ingest({ originalname: 'clip.mp4', path: file, size: bytes.length });
    await assert.rejects(service.resolve([asset.id], {}), /未开启视频/);
    assert.equal((await service.resolve([asset.id], { supportsVideoUpload: true }))[0].kind, 'video');
    await assert.rejects(service.resolve(Array(5).fill(asset.id)), /最多4/);
    await assert.rejects(service.resolve(['../secret']));
    await fs.writeFile(file, Buffer.from('binary\0data'));
    await assert.rejects(service.ingest({ originalname: 'bad.txt', path: file, size: 11 }), /二进制/);
});

test('共享显示引用和在途生成保护；历史落盘后清空可回收，链接历史停止删除', async t => {
    const { root, historyDir, uploadsDir, make } = await fixture(t); let history = [];
    const gc = createChatMediaGc({ uploadsDir, historyDir, graceMs: 0, liveHistory: () => history }); t.after(() => gc.stop());
    const shared = await make('chat-images', 'png'); const generating = await make('chat-videos', 'mp4');
    await fs.writeFile(path.join(historyDir, 'userconfig.json'), JSON.stringify({ displays: { currentMedia: shared.url } }));
    gc.protect(generating); assert.equal((await gc.run()).removed, 0);
    history = [{ videos: [generating] }]; gc.historySaved(); assert.equal((await gc.run()).removed, 0);
    history = []; gc.historySaved(); assert.equal((await gc.run()).removed, 1); await fs.access(shared.file);
    const linked = path.join(historyDir, 'chat-history.json'); const target = path.join(root, 'history.json'); await fs.writeFile(target, '[]'); await fs.symlink(target, linked);
    await assert.rejects(gc.run(), /链接/); await fs.access(shared.file);
});
