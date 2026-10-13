'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');

const publicDir = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

test('真实控制端 ZIP 预览、取消、自动重启结果与 APK 保存回调', {
    skip: !fs.existsSync(chrome), timeout: 45000
}, async t => {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    t.after(() => browser.close());
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-backup-browser-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const zipPath = path.join(directory, 'backup.zip'); fs.writeFileSync(zipPath, Buffer.from('PK\x03\x04'));
    const $ = cheerio.load(fs.readFileSync(path.join(publicDir, 'upload.html'), 'utf8'));
    const html = $('#fullConfigBackupMode').closest('.section').toString();
    const page = await browser.newPage();
    const requests = [];
    await page.exposeFunction('recordBackupRequest', value => requests.push(value));
    async function reset(status = 'applied') {
        requests.length = 0;
        await page.goto('about:blank');
        await page.setContent(html);
        await page.addScriptTag({ path: path.join(publicDir, 'js/aasc-user-config.js') });
        await page.evaluate(resultStatus => {
            window.showToast = () => {};
            window.fetch = async (url, options = {}) => {
                await window.recordBackupRequest({ url, method: options.method || 'GET', body: typeof options.body === 'string' ? options.body : null });
                const mode = options.body instanceof FormData ? options.body.get('mode') : 'merge';
                const preview = { id: 'fixture-preview', mode, configFiles: 2, userFiles: 5, added: 1, overwritten: 6, deleted: mode === 'replace' ? 2 : 0 };
                const data = url.endsWith('/preview') ? { status: 'success', preview }
                    : url.endsWith('/import') ? { status: 'success', id: preview.id, restarting: true, message: '服务器正在自动重启' }
                    : { status: 'success', result: { status: resultStatus, id: preview.id, message: '恢复失败，已回滚原配置' } };
                return { ok: true, status: 200, json: async () => data };
            };
        }, status);
    }
    async function preview(mode = 'merge') {
        await page.select('#fullConfigBackupMode', mode);
        await (await page.$('#fullConfigBackupImportInput')).uploadFile(zipPath);
        await page.waitForFunction(() => !document.getElementById('fullConfigBackupPreview').hidden);
    }

    await t.test('预览和取消不会提交导入或重启', async () => {
        await reset(); await preview('replace');
        assert.match(await page.$eval('#fullConfigBackupPreviewText', node => node.textContent), /删除 2 个/u);
        assert.equal(await page.$eval('#fullConfigBackupMode', node => node.disabled), true);
        await page.click('[onclick="AascUserConfig.cancelFullPreview()"]');
        await page.waitForFunction(() => document.getElementById('fullConfigBackupPreview').hidden);
        assert.equal(requests.some(item => item.url.endsWith('/import')), false);
        assert.ok(requests.some(item => item.method === 'DELETE'));
    });

    await t.test('确认只提交一次；恢复成功后自动刷新控制端', async () => {
        await reset(); await preview();
        const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 10000 });
        await page.click('[onclick="AascUserConfig.confirmFullImport()"]');
        await navigation;
        const imports = requests.filter(item => item.url.endsWith('/import'));
        assert.equal(imports.length, 1);
        assert.deepEqual(JSON.parse(imports[0].body), { id: 'fixture-preview', mode: 'merge', confirmed: true });
        assert.ok(requests.some(item => item.url.endsWith('/status')));
    });

    await t.test('恢复回滚后显示错误并重新允许操作', async () => {
        await reset('failed'); await preview();
        await page.click('[onclick="AascUserConfig.confirmFullImport()"]');
        await page.waitForFunction(() => document.getElementById('fullConfigBackupStatus').textContent.includes('已回滚'));
        assert.equal(await page.$eval('[onclick="AascUserConfig.exportFullConfig()"]', node => node.disabled), false);
    });

    await t.test('APK 系统保存期间等待回调，取消和成功均恢复按钮', async () => {
        await reset();
        await page.evaluate(() => { window.NativeControl = { saveFullConfigBackup: id => { window.nativeRequestId = id; return true; } }; });
        await page.click('[onclick="AascUserConfig.exportFullConfig()"]');
        assert.equal(await page.$eval('[onclick="AascUserConfig.exportFullConfig()"]', node => node.disabled), true);
        await page.evaluate(() => window.onFullConfigBackupSaved({ requestId: window.nativeRequestId, status: 'cancelled' }));
        assert.match(await page.$eval('#fullConfigBackupStatus', node => node.textContent), /已取消/u);
        await page.click('[onclick="AascUserConfig.exportFullConfig()"]');
        await page.evaluate(() => window.onFullConfigBackupSaved({ requestId: window.nativeRequestId, status: 'saved' }));
        assert.equal(await page.$eval('[onclick="AascUserConfig.exportFullConfig()"]', node => node.disabled), false);
        assert.match(await page.$eval('#fullConfigBackupStatus', node => node.textContent), /已保存/u);
        assert.equal(requests.length, 0);
    });
});
