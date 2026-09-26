'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const puppeteer = require('puppeteer-core');

const WEB_ROOT = path.resolve(__dirname, '../3rd/mmd-ar-test/web-dist');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
  .find((candidate) => candidate && fs.existsSync(candidate));

test('模拟定位切后台释放视频，回前台以新轨道恢复；手动停止不恢复', {
  skip: !CHROME || !fs.existsSync(path.join(WEB_ROOT, 'index.html')),
  timeout: 90000,
}, async () => {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/mnt/mmd-ar/')) return void response.writeHead(404).end();
    const relative = decodeURIComponent(pathname.slice('/mnt/mmd-ar/'.length)) || 'index.html';
    const absolute = path.resolve(WEB_ROOT, relative);
    if (!absolute.startsWith(`${WEB_ROOT}${path.sep}`) || !fs.existsSync(absolute)
      || !fs.statSync(absolute).isFile()) return void response.writeHead(404).end();
    response.setHeader('Content-Type', /\.m?js$/u.test(absolute) ? 'text/javascript'
      : /\.html$/u.test(absolute) ? 'text/html'
        : /\.png$/u.test(absolute) ? 'image/png' : 'application/octet-stream');
    fs.createReadStream(absolute).pipe(response);
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 90000,
      args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmdAr?.getState?.().targetCount > 0
      && window.MmdArTestSimCamera?.getStream && window.DisplayMmd?.getState, { timeout: 30000 });
    await page.select('#mmdArInputMode', 'simulated');
    const input = await page.$('#mmdArSimFile');
    await input.uploadFile(path.resolve(__dirname, '../3rd/mmd-ar-test/testimg/mindar.JPG'));
    await page.waitForFunction(() => window.MmdArTestSimCamera.getState().imageReady);
    await page.evaluate(() => {
      window.DisplayMmd = Object.freeze({ ...window.DisplayMmd,
        getState: () => ({ visible: true, modelReady: true }) });
      window.__arTestTracks = [];
      window.DisplayMmdImageTargetTracker = Object.freeze({
        start: async () => {
          const stream = await window.MmdArTestSimCamera.getStream();
          window.__arTestTracks.push(stream.getVideoTracks()[0]);
          return { processFrame: async () => ({ visible: false, newSample: false }),
            stop: async () => window.MmdArTestSimCamera.releaseStream() };
        }
      });
      document.getElementById('displayArStartButton').click();
    });
    await page.waitForFunction(() => window.DisplayMmdAr.getState().tracking
      && window.__arTestTracks.length === 1, { timeout: 15000 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !window.DisplayMmdAr.getState().tracking
      && !window.MmdArTestSimCamera.getState().streaming
      && window.__arTestTracks[0].readyState === 'ended', { timeout: 15000 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => window.DisplayMmdAr.getState().tracking
      && window.MmdArTestSimCamera.getState().streaming
      && window.__arTestTracks.length === 2, { timeout: 15000 });
    const tracks = await page.evaluate(() => window.__arTestTracks.map((track) => track.id));
    assert.notEqual(tracks[0], tracks[1]);
    await page.evaluate(() => window.DisplayMmdAr.stop());
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => !window.DisplayMmdAr.getState().tracking
      && !window.MmdArTestSimCamera.getState().streaming, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__arTestTracks.length), 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
