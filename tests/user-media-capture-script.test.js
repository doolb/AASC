'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('油猴脚本发现媒体、允许选择并发送自动识别的名称', () => {
  const commands = new Map();
  const prompts = ['', '剧集', '第一季'];
  let sent;
  const page = {
    title: '剧集',
    querySelector(selector) { if (selector === 'meta[property="og:title"]') return { content: '剧集' }; return null; },
    querySelectorAll(selector) { return selector.startsWith('video,') ? [{ currentSrc: 'https://cdn.example.com/one.mp4', title: '第一集', closest: () => null }] : []; }
  };
  const context = { URL, document: page, location: { href: 'https://example.com/watch' }, performance: { getEntriesByType: () => [] }, prompt: () => prompts.shift(), alert() {},
    GM_getValue: key => key === 'server' ? 'https://aasc.example.com' : 'a'.repeat(64), GM_setValue() {},
    GM_registerMenuCommand: (label, callback) => commands.set(label, callback), GM_xmlhttpRequest: request => { sent = request; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/apps/web-mediacenter/ui/public/userscripts/aasc-media-capture.user.js'), 'utf8'), context);
  commands.get('AASC：采集当前页面媒体')();
  assert.equal(sent.url, 'https://aasc.example.com/api/user-media/capture');
  assert.equal(sent.headers.Authorization, 'Bearer ' + 'a'.repeat(64));
  const body = JSON.parse(sent.data);
  assert.equal(body.content, '剧集'); assert.equal(body.title, '第一季');
  assert.equal(body.items[0].title, '第一集'); assert.equal(body.items[0].url, 'https://cdn.example.com/one.mp4');
});
