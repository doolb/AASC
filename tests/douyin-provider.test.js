'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createDouyinProvider, mediaUrl } = require('../res/tasks/domestic-media/providers/douyin');

test('抖音分享链接解析、代理流 Range 及站点校验', async () => {
  let stopped = false, call;
  const provider = createDouyinProvider({ proxyUrl: 'http://proxy' }, {
    ytdlp: { async resolve() { return { title: '测试', url: 'https://video.douyinvod.com/a.mp4' }; }, async stop() { stopped = true; } },
    httpGet: async (config, url, options) => { call = { config, url, options }; return { status: 206, headers: { 'content-range': 'bytes 1-2/3' }, data: Readable.from(['bc']) }; }
  });
  const result = await provider.resolveLink({ url: '分享视频 https://v.douyin.com/abc/' });
  const stream = await provider.getStream(result.items[0].id, { start: 1, end: 2 });
  assert.equal(call.config.proxyUrl, 'http://proxy');
  assert.equal(call.options.headers.Range, 'bytes=1-2');
  assert.equal((await Array.fromAsync(stream.stream)).join(''), 'bc');
  await assert.rejects(provider.resolveLink({ url: 'https://douyin.com.evil.test/x' }), /抖音分享链接/);
  assert.equal(mediaUrl('https://douyinvod.com.evil.test/a'), false);
  await provider.stop();
  assert.equal(stopped, true);
});
