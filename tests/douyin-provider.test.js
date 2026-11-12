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

test('抖音首页自动启动网页媒体并按推荐 ID 获取真实视频流', async () => {
  const calls = [];
  const browserMedia = {
    async ensure() { calls.push('ensure'); },
    async douyinHome(options) { calls.push(['home', options]); return [{ id: '7696837153740819721', title: '真实推荐', cover: 'https://p3.douyinpic.com/cover.jpg' }]; },
    async douyinVideo(options) { calls.push(['video', options]); return 'https://video.douyinvod.com/test.mp4'; }
  };
  const provider = createDouyinProvider({}, { browserMedia, ytdlp: { async stop() {}, async resolve() { throw new Error('不应依赖下载器'); } },
    httpGet: async (_config, _url, options) => ({ status: 206, headers: { 'content-range': 'bytes 0-1/2', requestRange: options.headers.Range }, data: Readable.from(['ok']) }) });
  const home = await provider.home();
  assert.equal(home.items[0].title, '真实推荐');
  assert.equal(home.items[0].url, 'https://www.douyin.com/video/7696837153740819721');
  const result = await provider.getStream(home.items[0].id, { start: 0, end: 1 });
  assert.equal((await Array.fromAsync(result.stream)).join(''), 'ok');
  assert.equal(result.headers.requestRange, 'bytes=0-1');
  assert.equal(calls[0], 'ensure');
  assert.deepEqual(calls[3], ['video', { id: '7696837153740819721', proxyUrl: '' }]);
  await provider.stop();
});

test('抖音首页无推荐或网页媒体启动失败时明确报告', async () => {
  const ytdlp = { async stop() {} };
  const browserMedia = { async ensure() {}, async douyinHome() { return []; }, async douyinVideo() {} };
  const provider = createDouyinProvider({}, { ytdlp, browserMedia });
  await assert.rejects(provider.home(), /尚未返回推荐/);
  browserMedia.ensure = async () => { throw new Error('浏览器启动失败'); };
  await assert.rejects(provider.home(), /网页媒体任务启动失败/);
  await provider.stop();
});

test('抖音首页接口显示安全的会话错误并隐藏其他异常', async t => {
  const express = require('express');
  const { registerTaskMediaRoutes } = require('../src/apps/server/modules/media/task-media-routes');
  let failure = '浏览器会话数量已达上限';
  const manager = { taskMediaProviders: { get: () => ({ features: ['home'] }) }, callTaskSource: async () => { throw new Error(failure); } };
  const app = express();
  registerTaskMediaRoutes(app, { manager, index: { indexPath: '/tmp/aasc-test-index-unused' }, getTarget: () => ({}), getBaseUrl: () => 'http://localhost' });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/task-media-sources/douyin/home`;
  assert.equal((await (await fetch(endpoint)).json()).message, failure);
  failure = 'secret/private/path';
  assert.equal((await (await fetch(endpoint)).json()).message, '媒体来源操作失败，请检查来源状态和输入');
});
