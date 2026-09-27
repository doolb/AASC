'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RESOURCES, verifyBuffer } = require('../scripts/ops/prepare-mmd-ar-vendor');

const PUBLIC_ROOT = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const WEB_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');

test('本地 AR 资源固定版本、大小、SHA-256 和许可证完整', () => {
  for (const resource of RESOURCES) {
    const filePath = path.join(PUBLIC_ROOT, resource.path);
    assert.equal(fs.existsSync(filePath), true, resource.path);
    assert.equal(verifyBuffer(fs.readFileSync(filePath), resource), true, resource.path);
  }
});

test('测试网页运行时只引用随包 AR 脚本和官方目标', { skip: !fs.existsSync(path.join(WEB_ROOT, 'index.html')) }, () => {
  const html = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
  const adapter = fs.readFileSync(path.join(WEB_ROOT, 'js/display-mmd-ar-aframe.js'), 'utf8');
  for (const resource of RESOURCES) {
    assert.equal(fs.existsSync(path.join(WEB_ROOT, resource.path)), true, resource.path);
  }
  assert.match(html, /src="\.\/js\/vendor\/aframe-1\.5\.0\/aframe\.min\.js"/u);
  assert.match(html, /src="\.\/js\/vendor\/mind-ar-1\.2\.5\/mindar-image-aframe\.prod\.js"/u);
  assert.match(adapter, /assets\/mindar-official-card\.mind/u);
  assert.doesNotMatch(html, /aframe\.io\/releases|cdn\.jsdelivr\.net\/npm\/mind-ar/u);
  assert.doesNotMatch(adapter, /cdn\.jsdelivr\.net/u);
});
