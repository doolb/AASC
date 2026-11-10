'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { Readable } = require('node:stream');
const task = require('../res/tasks/hongguo/task');

test('红果任务只列出网页明确公开的视频并代理 Range', async t => {
  const original = axios.get; t.after(() => { axios.get = original; });
  let request;
  axios.get = async (url, options) => {
    if (options.responseType === 'stream') { request = { url, options }; return { status: 206, headers: { 'content-range': 'bytes 0-3/10' }, data: Readable.from(['test']) }; }
    return { data: '<script type="application/ld+json">' + JSON.stringify({ '@type': 'VideoObject', name: '第一集', contentUrl: 'https://hongguoduanju.com/video/public/987/360p.mp4' }) + '</script>' };
  };
  let definition;
  await task.run({ registerMediaProvider: value => { definition = value; return () => {}; }, log: () => {} });
  const provider = definition.create({ url: 'https://hongguoduanju.com/player/123' });
  assert.equal((await provider.list('/'))[0].path, '/123');
  assert.equal((await provider.list('/123'))[0].path, '/123/987.mp4');
  await provider.getFileStream('/123/987.mp4', { start: 0, end: 3 });
  assert.equal(request.options.headers.Range, 'bytes=0-3');
  await assert.rejects(provider.getFile('/123/555.mp4'), /未公开/);
  assert.throws(() => definition.create({ url: 'http://localhost/' }), /红果/);
});
