'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { groupWebPanels, WEB_PANEL_GROUP_CSS, WEB_PANEL_GROUP_JS } = require('../3rd/mmd-ar-test/web-panel-groups');

const DISPLAY_SOURCE = path.join(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const GENERATED_PAGE = path.join(__dirname, '../3rd/mmd-ar-test/web-dist/index.html');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
  .find((candidate) => candidate && fs.existsSync(candidate));
const CAMERA_CONTROL_IDS = ['mmdArTranslationDeadZone', 'mmdArRotationDeadZone', 'mmdArSmoothingMs', 'mmdArCameraDistance'];

function addCameraControls($) {
  $('#displayArTargetPanel').append('<div id="mmdArTargetPlaneMode"></div>');
  $('#displayArTargetPanel').append(CAMERA_CONTROL_IDS.map((id) => `<label><input id="${id}" type="range"></label>`).join(''));
}

// 使用真正的生成页与全部业务脚本，确保面板 stopPropagation 等事件链进入回归。
async function startGeneratedPageServer() {
  const root = path.dirname(GENERATED_PAGE);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/mnt/mmd-ar/')) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(pathname.slice('/mnt/mmd-ar/'.length)) || 'index.html';
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const extension = path.extname(absolute).toLowerCase();
    const contentType = ({
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.wasm': 'application/wasm',
      '.png': 'image/png',
    })[extension] || 'application/octet-stream';
    response.setHeader('Content-Type', contentType);
    fs.createReadStream(absolute).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('测试网页灯光和定位控件按类折叠，原控件 ID 与按钮保留', () => {
  const $ = cheerio.load(fs.readFileSync(DISPLAY_SOURCE, 'utf8'));
  addCameraControls($);
  const panels = ['#displayMmdLightingPanel', '#displayArTargetPanel'];
  const originalIds = new Map(panels.map((selector) => [
    selector,
    $(selector).find('[id]').map((_, node) => node.attribs.id).get().sort(),
  ]));
  $('#displayArTargetPanel .display-mmd-ar-header').after('<div class="mmd-ar-benchmark"><label><select id="mmdArInputScale"></select></label><p id="mmdArInputResolution"></p><p id="mmdArBenchmarkLive"></p></div>');
  $('#displayMmdKeyColor').closest('label').before('<label><input id="displayMmdKeyShadowEnabled" type="checkbox" checked><span>主光阴影（默认开启）</span></label>');
  originalIds.get('#displayMmdLightingPanel').push('displayMmdKeyShadowEnabled');
  originalIds.get('#displayMmdLightingPanel').sort();
  originalIds.get('#displayArTargetPanel').push('mmdArBenchmarkLive');
  originalIds.get('#displayArTargetPanel').push('mmdArInputScale', 'mmdArInputResolution');
  originalIds.get('#displayArTargetPanel').push('mmdArTrackingToggle');
  originalIds.get('#displayArTargetPanel').sort();

  groupWebPanels($);

  const expectedTitles = [
    ['基础光照', 'AO', '主光', '补光', '边缘光 1', '边缘光 2', '物理'],
    ['定位图与校准', '跟踪操作', '体感环绕', '相机跟随'],
  ];
  panels.forEach((selector, index) => {
    const panel = $(selector);
    const groups = panel.children('section.mmd-ar-panel-group');
    assert.deepEqual(groups.map((_, node) => $(node).find('button.mmd-ar-panel-group-toggle').attr('data-group-title')).get(), expectedTitles[index]);
    assert.equal(groups.find('button[aria-expanded="true"]').length, 1);
    assert.equal(groups.first().find('button').attr('aria-expanded'), 'true');
    assert.deepEqual(panel.find('[id]').filter((_, node) => !$(node).hasClass('mmd-ar-panel-group-body'))
      .map((_, node) => node.attribs.id).get().sort(), originalIds.get(selector));
  });
  for (const [controlId, title] of [
    ['displayMmdPmxAoEnabled', 'AO'],
    ['displayMmdKeyShadowEnabled', '主光'],
    ['displayMmdFillEnabled', '补光'],
    ['displayMmdRim1Enabled', '边缘光 1'],
    ['displayMmdRim2Enabled', '边缘光 2'],
    ['displayArMotionEnabled', '体感环绕'],
  ]) {
    const group = $(`#${controlId}`).closest('.mmd-ar-panel-group');
    assert.equal(group.find('.mmd-ar-panel-group-header').find(`#${controlId}`).length, 1);
    assert.equal(group.find('button.mmd-ar-panel-group-toggle').attr('data-group-title'), title);
    assert.equal(group.find('.mmd-ar-panel-group-switch').text().trim(), '');
    assert.ok(group.find('button.mmd-ar-panel-group-toggle > span').first().text().length > title.length);
    assert.equal(group.find(`#${controlId}`).attr('aria-label'), group.find('button.mmd-ar-panel-group-toggle > span').first().text());
  }
  assert.equal($('#displayArCalibrationButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '定位图与校准');
  assert.equal($('#displayArDeleteButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '定位图与校准');
  assert.equal($('#displayArStartButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '跟踪操作');
  assert.equal($('#displayArStopButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '跟踪操作');
  assert.equal($('#mmdArTrackingToggle').closest('.mmd-ar-panel-group').find('button.mmd-ar-panel-group-toggle').attr('data-group-title'), '定位图与校准');
  assert.equal($('#displayMmdShadowSource').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '补光');
  assert.match(WEB_PANEL_GROUP_CSS, /background: #39455c/u);
});

test('新增未分类控件时停止网页构建，避免面板设置丢失', () => {
  const $ = cheerio.load(fs.readFileSync(DISPLAY_SOURCE, 'utf8'));
  addCameraControls($);
  $('#displayArTargetPanel .display-mmd-ar-header').after('<div class="mmd-ar-benchmark"><p id="mmdArBenchmarkLive"></p></div>');
  $('#displayMmdKeyColor').closest('label').before('<label><input id="displayMmdKeyShadowEnabled" type="checkbox" checked><span>主光阴影（默认开启）</span></label>');
  $('#displayMmdLightingPanel').append('<label><input id="newLightingControl"></label>');
  assert.throws(() => groupWebPanels($), /未分类控件/u);
});

test('手机宽度下分类可独立开合，控件值与面板滚动范围不变', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const $ = cheerio.load(fs.readFileSync(GENERATED_PAGE, 'utf8'));
  $('script, link[rel="stylesheet"]').remove();
  $('head').append(`<style>${fs.readFileSync(path.join(__dirname, '../src/apps/web-mediacenter/ui/public/css/display-mmd.css'), 'utf8')}</style>`);
  $('body').append(`<script>${WEB_PANEL_GROUP_JS}</script>`);
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    await page.setContent($.html());
    await page.evaluate(() => { document.getElementById('displayMmdLightingPanel').hidden = false; });
    const before = await page.evaluate(() => ({
      lighting: document.getElementById('displayMmdLightingPreset').value,
      shadowSource: document.getElementById('displayMmdShadowSource').value,
    }));
    await page.click('#displayMmdLightingPanel .mmd-ar-panel-group:nth-of-type(2) .mmd-ar-panel-group-toggle > span:first-child');
    const aoOpenedFromTitle = await page.evaluate(() => ({
      open: !document.querySelectorAll('#displayMmdLightingPanel .mmd-ar-panel-group-body')[1].hidden,
      enabled: document.getElementById('displayMmdPmxAoEnabled').checked,
    }));
    await page.click('#displayMmdPmxAoEnabled');
    const aoStayedOpenFromSwitch = await page.evaluate(() => !document.querySelectorAll('#displayMmdLightingPanel .mmd-ar-panel-group-body')[1].hidden);
    await page.click('#displayMmdLightingPanel .mmd-ar-panel-group:nth-of-type(2) .mmd-ar-panel-group-toggle > span:first-child');
    const aoClosedFromTitle = await page.evaluate(() => document.querySelectorAll('#displayMmdLightingPanel .mmd-ar-panel-group-body')[1].hidden);
    await page.click('#displayMmdFillEnabled');
    await page.evaluate(() => {
      document.getElementById('displayMmdLightingPanel').hidden = true;
      document.getElementById('displayArTargetPanel').hidden = false;
    });
    await page.click('#displayArTargetPanel .mmd-ar-panel-group:nth-of-type(2) .mmd-ar-panel-group-toggle > span:first-child');
    const after = await page.evaluate(() => ({
      lighting: document.getElementById('displayMmdLightingPreset').value,
      shadowSource: document.getElementById('displayMmdShadowSource').value,
      aoOpen: document.querySelectorAll('#displayMmdLightingPanel .mmd-ar-panel-group-body')[1].hidden === false,
      trackingOpen: document.querySelectorAll('#displayArTargetPanel .mmd-ar-panel-group-body')[1].hidden === false,
      firstLightingOpen: document.querySelector('#displayMmdLightingPanel .mmd-ar-panel-group-body').hidden === false,
      fillEnabled: document.getElementById('displayMmdFillEnabled').checked,
      fillGroupClosed: document.querySelectorAll('#displayMmdLightingPanel .mmd-ar-panel-group-body')[3].hidden,
      aoEnabled: document.getElementById('displayMmdPmxAoEnabled').checked,
      aoButtonLabel: document.querySelectorAll('#displayMmdLightingPanel .mmd-ar-panel-group-toggle')[1].getAttribute('aria-label'),
      titleBackground: getComputedStyle(document.querySelector('#displayMmdLightingPanel .mmd-ar-panel-group-header')).backgroundColor,
      panelWidth: document.getElementById('displayMmdLightingPanel').getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
    }));
    assert.deepEqual(aoOpenedFromTitle, { open: true, enabled: true });
    assert.equal(aoStayedOpenFromSwitch, true);
    assert.equal(aoClosedFromTitle, true);
    assert.equal(after.aoOpen, false);
    assert.equal(after.trackingOpen, true);
    assert.equal(after.firstLightingOpen, true);
    assert.equal(after.fillEnabled, true);
    assert.equal(after.fillGroupClosed, true);
    assert.equal(after.aoEnabled, false);
    assert.equal(after.aoButtonLabel, '展开AO设置');
    assert.equal(after.titleBackground, 'rgb(57, 69, 92)');
    assert.equal(after.lighting, before.lighting);
    assert.equal(after.shadowSource, before.shadowSource);
    assert.ok(after.panelWidth <= after.viewportWidth);
    await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 3 });
    const narrowHeadersFit = await page.evaluate(() => Array.from(document.querySelectorAll('.mmd-ar-panel-group-header'))
      .every((header) => header.scrollWidth <= header.clientWidth + 1));
    assert.equal(narrowHeadersFit, true);
  } finally {
    await browser?.close();
  }
});

test('完整测试网页脚本存在时，灯光与定位分类仍能展开和收起', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    // 分类事件不依赖模型二进制；阻止大型 PMX/VMD 下载，避免回归被渲染开销拖慢。
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(() => Boolean(window.DisplayMmdImageTargetTracker?.start)), true);
    assert.equal(await page.evaluate(() => document.getElementById('mmdArTrackerEngine')), null);
    assert.equal(fs.existsSync(path.join(path.dirname(GENERATED_PAGE), 'js/display-mmd-image-tracker.js')), false);
    await page.evaluate(() => document.getElementById('displayMmdLightingToggle').click());
    assert.equal(await page.evaluate(() => document.getElementById('displayMmdLightingPanel').hidden), false);
    const lightingTitle = '#displayMmdLightingPanel .mmd-ar-panel-group:nth-of-type(2) .mmd-ar-panel-group-toggle > span:first-child';
    await page.evaluate((selector) => document.querySelector(selector).click(), lightingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayMmdLightingPanelGroup2').hidden), false);
    await page.evaluate((selector) => document.querySelector(selector).click(), lightingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayMmdLightingPanelGroup2').hidden), true);
    const keyShadow = await page.evaluate(() => {
      const toggle = document.getElementById('displayMmdKeyShadowEnabled');
      const initial = { checked: toggle.checked, value: window.DisplayMmd.getLighting().keyShadowEnabled };
      toggle.click();
      return { initial, checked: toggle.checked, value: window.DisplayMmd.getLighting().keyShadowEnabled,
        saved: JSON.parse(localStorage.getItem('aasc.display.mmdLighting.v1')).keyShadowEnabled };
    });
    assert.deepEqual(keyShadow, {
      initial: { checked: true, value: true }, checked: false, value: false, saved: false,
    });
    assert.doesNotMatch(fs.readFileSync(DISPLAY_SOURCE, 'utf8'), /displayMmdKeyShadowEnabled/u);

    await page.evaluate(() => document.getElementById('displayArTargetToggle').click());
    assert.equal(await page.evaluate(() => document.getElementById('displayArTargetPanel').hidden), false);
    const trackingTitle = '#displayArTargetPanel .mmd-ar-panel-group:nth-of-type(2) .mmd-ar-panel-group-toggle > span:first-child';
    await page.evaluate((selector) => document.querySelector(selector).click(), trackingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayArTargetPanelGroup2').hidden), false);
    await page.evaluate((selector) => document.querySelector(selector).click(), trackingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayArTargetPanelGroup2').hidden), true);
    const cameraSettings = await page.evaluate(() => {
      const group = document.querySelector('#displayArTargetPanel .mmd-ar-panel-group:nth-of-type(4)');
      group.querySelector('.mmd-ar-panel-group-toggle').click();
      const distance = document.getElementById('mmdArCameraDistance');
      distance.value = '65';
      distance.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        open: !group.querySelector('.mmd-ar-panel-group-body').hidden,
        value: document.getElementById('mmdArCameraDistanceValue').textContent,
        saved: JSON.parse(localStorage.getItem('aasc.mmdArTest.cameraSettings.v1')),
        accepted: window.DisplayMmd.setArCameraSettings({ distancePercent: 65 })
      };
    });
    assert.equal(cameraSettings.open, true);
    assert.equal(cameraSettings.value, '65%');
    assert.equal(cameraSettings.saved.distancePercent, 65);
    assert.equal(cameraSettings.saved.smoothingMs, 120);
    assert.equal(cameraSettings.saved.targetPlane, 'floor');
    assert.equal(cameraSettings.accepted, true);
    await page.$eval('#mmdArTargetPlaneMode [data-target-plane="vertical"]', (button) => button.click());
    assert.equal(await page.$eval('#mmdArTargetPlaneMode [data-target-plane="vertical"]', (button) => button.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('aasc.mmdArTest.cameraSettings.v1')).targetPlane), 'vertical');
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.$eval('#mmdArCameraDistance', (node) => node.value), '65');
    assert.equal(await page.$eval('#mmdArTargetPlaneMode [data-target-plane="vertical"]', (button) => button.getAttribute('aria-pressed')), 'true');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('校准弹窗在窄竖屏内可滚动，定位切换只显示一个按钮', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 600, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmdAr?.getState?.().targetCount > 0);
    const result = await page.evaluate(() => {
      const calibration = document.getElementById('displayArCalibration');
      const dialog = calibration.querySelector('.display-mmd-ar-dialog');
      const toggle = document.getElementById('mmdArTrackingToggle');
      document.getElementById('displayStageLayers').style.setProperty('--display-safe-inset-top', '40px');
      document.getElementById('displayStageLayers').style.setProperty('--display-safe-inset-bottom', '24px');
      calibration.hidden = false;
      const initial = {
        dialog: dialog.getBoundingClientRect().toJSON(),
        viewport: window.innerHeight,
        toggleText: toggle.textContent,
        toggleDisabled: toggle.disabled,
        oldStartDisplay: getComputedStyle(document.querySelector('.mmd-ar-original-tracking-actions')).display,
      };
      window.DisplayMmdAr.setCameraEnabled(false);
      return { ...initial, disabledAfterCameraOff: toggle.disabled };
    });
    assert.ok(result.dialog.top >= -1, `弹窗顶边越界：${result.dialog.top}`);
    assert.ok(result.dialog.bottom <= result.viewport + 1, `弹窗底边越界：${result.dialog.bottom}`);
    assert.equal(result.oldStartDisplay, 'none');
    assert.equal(result.toggleText, '开始定位');
    assert.equal(result.toggleDisabled, false);
    await page.waitForFunction(() => document.getElementById('mmdArTrackingToggle').disabled);
    assert.equal(await page.$eval('#mmdArTrackingToggle', (node) => node.disabled), true);
    const active = await page.evaluate(async () => {
      const oldController = window.DisplayMmdAr;
      let stopped = 0;
      window.DisplayMmdAr = { getState: () => ({ tracking: true, status: 'tracking' }), stop: () => { stopped += 1; } };
      document.getElementById('displayArTargetStatus').textContent = '定位中';
      await new Promise((resolve) => setTimeout(resolve, 0));
      const toggle = document.getElementById('mmdArTrackingToggle');
      const label = toggle.textContent;
      toggle.click();
      window.DisplayMmdAr = oldController;
      return { label, disabled: toggle.disabled, stopped };
    });
    assert.deepEqual(active, { label: '结束定位', disabled: false, stopped: 1 });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('手机窄屏下定位面板可用触摸手势滚到下方操作', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 650, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    const initial = await page.evaluate(() => {
      document.getElementById('displayArTargetToggle').click();
      document.querySelectorAll('#displayArTargetPanel .mmd-ar-panel-group-toggle[aria-expanded="false"]')
        .forEach((button) => button.click());
      const panel = document.getElementById('displayArTargetPanel');
      return {
        bodyTouch: getComputedStyle(document.body).touchAction,
        panelTouch: getComputedStyle(panel).touchAction,
        panelBottom: panel.getBoundingClientRect().bottom,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        rect: panel.getBoundingClientRect().toJSON(),
      };
    });
    assert.notEqual(initial.bodyTouch, 'none');
    assert.equal(initial.panelTouch, 'pan-y');
    assert.ok(initial.panelBottom <= 650);
    assert.ok(initial.scrollHeight > initial.clientHeight);
    const x = Math.round(initial.rect.left + initial.rect.width / 2);
    const y = Math.round(Math.min(initial.rect.bottom - 70, initial.rect.top + 280));
    const client = await page.createCDPSession();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let offset = 20; offset <= 160; offset += 20) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - offset }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(await page.$eval('#displayArTargetPanel', (panel) => panel.scrollTop) > 0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTPS 测试页内置官方目标且保留用户选图，正式页不带内置目标', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const generated = fs.readFileSync(GENERATED_PAGE, 'utf8');
  assert.match(generated, /MindAR 官方测试图/u);
  assert.match(generated, /DisplayMmdArBuiltInTargets/u);
  assert.doesNotMatch(fs.readFileSync(DISPLAY_SOURCE, 'utf8'), /MindAR 官方测试图/u);
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    const url = `http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#displayArTargetSelect option[value="builtin:mindar-official-card"]'));
    const initial = await page.evaluate(() => ({
      value: document.getElementById('displayArTargetSelect').value,
      deleteDisabled: document.getElementById('displayArDeleteButton').disabled,
      link: document.querySelector('.mmd-ar-official-target-link').href,
    }));
    assert.equal(initial.value, 'builtin:mindar-official-card');
    assert.equal(initial.deleteDisabled, true);
    assert.equal(initial.link, `${url}assets/mindar-official-card.png`);
    const image = await page.evaluate(async () => {
      const response = await fetch(document.querySelector('.mmd-ar-official-target-link').href);
      const blob = await response.blob();
      return { ok: response.ok, type: blob.type, size: blob.size };
    });
    assert.deepEqual(image, { ok: true, type: 'image/png', size: 61689 });
    await page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector('.mmd-ar-official-target-link').href)).blob();
      const request = indexedDB.open('aasc-mmd-ar', 1);
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('targets', 'readwrite');
        transaction.objectStore('targets').put({
          targetId: 'user-target', name: '用户定位图', referenceImageBlob: blob,
          selectedQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
          updatedAt: Date.now(),
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      localStorage.setItem('aasc.display.mmdAr.activeTarget.v1', 'user-target');
      database.close();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#displayArTargetSelect option[value="user-target"]'));
    assert.equal(await page.$eval('#displayArTargetSelect', (select) => select.value), 'user-target');
    assert.equal(await page.$eval('#displayArDeleteButton', (button) => button.disabled), false);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
