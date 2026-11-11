'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createUserMediaService, externalUrl, openExternal } = require('../src/apps/server/modules/media/user-media-service');

test('用户采集按站点和内容保存并合并列表，按层级浏览', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-user-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = createUserMediaService({ root });
  const input = { sourceUrl: 'https://example.com/view', content: '内容', title: '第一季', items: [{ title: '第一集', url: 'https://cdn.example.com/one.mp4' }] };
  await Promise.all([service.save(input), service.save({ ...input, items: [{ title: '第二集', url: 'https://cdn.example.com/two.mp4' }] })]);
  const saved = JSON.parse(await fs.readFile(path.join(root, 'example.com', '内容', '第一季.json'), 'utf8'));
  assert.deepEqual(saved.items.map(item => item.title), ['第一集', '第二集']);
  let entries = (await service.provider.home()).items;
  for (let i = 0; i < 3; i++) entries = (await service.provider.resolveLink({ url: entries[0].id })).items;
  assert.deepEqual(entries.map(item => item.title), ['第一集', '第二集']);
  assert.equal(JSON.stringify(entries).includes('cdn.example.com'), false);
  await assert.rejects(service.save({ ...input, items: [{ url: 'http://127.0.0.1/a.mp4' }] }), /地址无效/);
  assert.throws(() => externalUrl('http://localhost/a'), /地址无效/);
  assert.throws(() => externalUrl('https://user:pass@example.com/a'), /地址无效/);
});

test('用户媒体拒绝符号链接和路径穿越', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-user-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.symlink(os.tmpdir(), path.join(root, 'example.com'));
  const service = createUserMediaService({ root });
  await assert.rejects(service.save({ sourceUrl: 'https://example.com/', content: '内容', title: 'a', items: [{ url: 'https://cdn.example.com/a.mp4' }] }), /目录无效/);
  await assert.rejects(service.provider.resolveLink({ url: Buffer.from(JSON.stringify(['..'])).toString('base64url') }), /标识无效/);
});

test('媒体请求拒绝解析到内网的域名', async () => {
  await assert.rejects(openExternal('https://example.com/video.mp4', undefined, { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }), /不可访问/);
  await assert.rejects(openExternal('https://example.com/video.mp4', undefined, { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }] }), /不可访问/);
});

test('HLS 分段先安全下载并转封装，随后可使用 Range 播放', async t => {
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const { Readable } = require('node:stream');
  const run = promisify(execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-user-hls-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const segment = path.join(root, 'test.ts');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=1', '-t', '1', '-c:v', 'mpeg2video', '-f', 'mpegts', segment]);
  const bytes = await fs.readFile(segment);
  const service = createUserMediaService({ root: path.join(root, 'user'), open: async url => ({ statusCode: 200, headers: {}, stream: Readable.from([url.endsWith('.m3u8') ? Buffer.from('#EXTM3U\n#EXTINF:1,\ntest.ts\n#EXT-X-ENDLIST\n') : bytes]) }) });
  await service.save({ sourceUrl: 'https://example.com/view', content: '节目', title: '列表', items: [{ title: '第一集', url: 'https://cdn.example.com/test.m3u8' }] });
  let entries = (await service.provider.home()).items;
  for (let i = 0; i < 3; i++) entries = (await service.provider.resolveLink({ url: entries[0].id })).items;
  assert.equal(entries[0].playable, false);
  await service.download(entries[0].id);
  const stream = await service.provider.getStream(entries[0].id, { start: 0, end: 9 });
  assert.equal(stream.statusCode, 206);
  assert.equal(Buffer.concat(await Array.fromAsync(stream.stream)).length, 10);
  await assert.rejects(service.download(entries[0].id));
});
