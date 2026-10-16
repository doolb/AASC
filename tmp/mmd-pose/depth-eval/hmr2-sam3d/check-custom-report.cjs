const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { start } = require('./custom-report-server.cjs');

async function main() {
  const real = process.argv.includes('--real');
  const options = real ? {} : { inferCustom: async (_file, box) => ({
    model: 'HMR2.0b', names: ['nose', 'neck'], edges: [[0, 1]], xy: [[10, 10], [20, 20]],
    xyz: [[0, 0, 0], [0, 1, 0]], box, imageSize: [64, 64], camera: {},
    inferenceMs: 1, device: 'test', source: 'test', provenance: {},
  }) };
  const { server, upstream, url } = await start(options);
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle'] });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/_depth/hmr2-sam3d/report.html?image=seated`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => globalThis.reportReady === true);
    assert.equal(await page.$('#custom-file') !== null, true);
    const png = real ? JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-config.json'), 'utf8')).samples.find((sample) => sample.name === 'anime').image
      : path.resolve(__dirname, '../rigid-projection/seated-depth.png');
    await page.$('#custom-file').then((element) => element.uploadFile(png));
    await page.waitForFunction(() => document.querySelector('#sample').value === 'custom');
    assert.equal(await page.$eval('#custom-run', (element) => element.disabled), false);
    await page.click('#custom-run');
    await page.waitForFunction(() => document.querySelector('#hmr2 .status').textContent.includes('推理完成'), { timeout: real ? 120000 : 30000 });
    assert.equal(await page.$eval('#hmr2 canvas.xyz', (element) => element.dataset.joints), real ? '25' : '2');
    assert.match(await page.$eval('#hmr2 .depth-status', (element) => element.textContent), /整图相对深度完成/);
    assert.match(await page.$eval('#hmr2 img.depth', (element) => element.src), /^data:image\/png/);
    const bytes = fs.readFileSync(png).toString('base64');
    await page.evaluate((encoded) => {
      const binary = atob(encoded);
      const array = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([array], 'paste.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
    }, bytes);
    await page.waitForFunction(() => document.querySelector('#common').textContent.includes('paste.png'));
    await page.evaluate((encoded) => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => [{
        types: ['image/png'], getType: async () => new Blob([bytes], { type: 'image/png' }),
      }] } });
    }, bytes);
    await page.click('#custom-paste');
    await page.waitForFunction(() => document.querySelector('#common').textContent.includes('剪贴板图片'));
    await page.$eval('#box-w', (element) => { element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.match(await page.$eval('#hmr2 .status', (element) => element.textContent), /人物框必须/);
    await page.select('#sample', 'seated');
    await page.waitForFunction(() => document.querySelector('#hmr2 .status').textContent.includes('原版推理完成'));
    const bad = await fetch(`${url}/api/hmr2-custom`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Person-Box': '[0,0,0,1]' }, body: fs.readFileSync(png) });
    assert.equal(bad.status, 400);
    console.log('自定义文件、粘贴、人物框、浏览器深度、HMR接口通过');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
