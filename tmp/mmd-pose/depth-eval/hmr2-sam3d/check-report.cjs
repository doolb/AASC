// 真实Edge验证三张HMR2.0b结果、立体骨架、受光材质和手机布局。
const puppeteer = require('puppeteer');
const path = require('node:path');
const { start } = require('../server.cjs');

(async () => {
  const { server, url } = await start();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true,
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${url}/_depth/hmr2-sam3d/report.html?image=seated`);
    await page.waitForFunction(() => globalThis.reportReady, { timeout: 30000 });
    const results = [];
    for (const name of ['seated', 'anime', 'diagram']) {
      await page.select('#sample', name);
      await page.evaluate((value) => globalThis.showSample(value), name);
      const result = await page.evaluate(() => {
        const canvas = document.querySelector('#hmr2 .xyz');
        const webgl = canvas.getContext('webgl2');
        return {
          label: document.querySelector('#common').textContent,
          status: document.querySelector('#hmr2 .status').textContent,
          details: document.querySelector('#hmr2 .details').textContent,
          photo: document.querySelector('#hmr2 .overlay').width,
          renderer: canvas.dataset.renderer,
          joints: Number(canvas.dataset.joints),
          bones: Number(canvas.dataset.bones),
          lights: Number(canvas.dataset.lights),
          projectedShadows: canvas.dataset.projectedShadows,
          webgl: Boolean(webgl),
          skeletonPixels: canvas.toDataURL().length > 10000,
          cards: document.querySelectorAll('.card').length,
        };
      });
      if (!result.label || result.photo <= 0 || result.cards !== 1 || !result.status.includes('推理完成')
        || !result.details.includes('embedded SMPL buffers') || !result.webgl || result.renderer !== 'three-webgl'
        || result.joints !== 25 || result.bones < 20 || result.lights !== 3
        || result.projectedShadows !== 'false' || !result.skeletonPixels) {
        throw Error(`${name} 实际HMR2.0b结果未完整显示`);
      }
      await page.screenshot({ path: path.join(__dirname, `report-${name}.png`), fullPage: true });
      results.push({ name, ...result });
    }
    await page.select('#sample', 'seated');
    await page.evaluate(() => globalThis.showSample('seated'));
    const beforeDrag = await page.$eval('#hmr2 canvas.xyz', (canvas) => canvas.toDataURL());
    const bounds = await page.$eval('#hmr2 canvas.xyz', (canvas) => {
      const box = canvas.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await page.mouse.move(bounds.x, bounds.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 75, bounds.y + 28, { steps: 6 });
    await page.mouse.up();
    const afterDrag = await page.$eval('#hmr2 canvas.xyz', (canvas) => ({
      yaw: Number(canvas.dataset.yaw), image: canvas.toDataURL(),
    }));
    if (afterDrag.yaw <= 0 || afterDrag.image === beforeDrag) throw Error('3D骨架拖动后视角未变化');
    await page.mouse.click(bounds.x, bounds.y, { clickCount: 2, delay: 60 });
    const resetYaw = await page.$eval('#hmr2 canvas.xyz', (canvas) => Number(canvas.dataset.yaw));
    if (resetYaw !== 0) throw Error('3D骨架双击未复位');
    await page.setViewport({ width: 390, height: 844 });
    await page.select('#sample', 'seated');
    await page.evaluate(() => globalThis.showSample('seated'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await page.screenshot({ path: path.join(__dirname, 'report-mobile.png'), fullPage: true });
    if (overflow) throw Error('390px报告横向溢出');
    const fallbackPage = await browser.newPage();
    await fallbackPage.evaluateOnNewDocument(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(kind, ...args) {
        if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
        return original.call(this, kind, ...args);
      };
    });
    fallbackPage.on('pageerror', (error) => errors.push(error.message));
    fallbackPage.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
    await fallbackPage.goto(`${url}/_depth/hmr2-sam3d/report.html?image=seated`);
    await fallbackPage.waitForFunction(() => globalThis.reportReady, { timeout: 30000 });
    const fallbackRendered = await fallbackPage.$eval('#hmr2 canvas.xyz', (canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return canvas.dataset.renderer === 'canvas-2d-fallback'
        && document.querySelector('#hmr2 .status').textContent.includes('WebGL不可用')
        && pixels.some((value, index) => index % 4 === 3 && value !== 0);
    });
    if (!fallbackRendered) throw Error('WebGL不可用时未回退到线条骨架');
    if (errors.length) throw Error(`浏览器脚本错误：${errors.join('; ')}`);
    if (requests.some((request) => request.method !== 'GET' || !request.url.startsWith(`${url}/`))) throw Error('报告出现非本机GET请求');
    console.log(JSON.stringify({ cases: results.length, overflow, fallbackRendered, realSkeletonRender: results.every((item) => item.skeletonPixels), bones: results.map((item) => item.bones), errors, status: results[0].status }));
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
