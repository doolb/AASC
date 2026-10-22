'use strict';
const { createDoubaoBrowserLauncher } = require('./chat2api-doubao-browser-launcher');
const { imageError } = require('./chat2api-image-catalog');

/** 千问参考图上传的确认接口要求官网SDK签名；复用统一profile，只关闭本次创建的页签。 */
function createQwenImageBrowser({ rootDir, getBrowserConfig = () => null }) {
    const launcher = createDoubaoBrowserLauncher({ rootDir });
    let queue = Promise.resolve();
    async function upload(image, { account, signal }) {
        if (process.env.AASC_ANDROID_NODE === '1') throw imageError('qwen_reference_browser_required', '千问参考图上传暂需桌面浏览器签名环境', 503);
        signal?.throwIfAborted();
        const config = { ...(getBrowserConfig() || {}), mode: 'browser-fetch', accountId: '' };
        const browser = await launcher.open(config, await launcher.lastAccount(config));
        let page;
        const abort = () => { void page?.close().catch(() => {}); };
        signal?.addEventListener('abort', abort, { once: true });
        try {
            page = await browser.newPage();
            await page.bringToFront();
            signal?.throwIfAborted();
            const ticket = account.credentials.ticket || account.credentials.tongyi_sso_ticket;
            if (!ticket) throw imageError('qwen_account_invalid', '千问账号缺少登录票据', 401);
            await page.setCookie({ name: 'tongyi_sso_ticket', value: ticket, domain: '.qianwen.com', path: '/', secure: true });
            await page.goto('https://www.qianwen.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(() => globalThis.webpackChunk_ali_qianwen_web, { timeout: 30000 });
            await page.waitForSelector('[contenteditable=true]', { timeout: 30000 });
            const { createHash } = require('node:crypto');
            const uploadResult = await page.evaluate(async ({ base64, md5, filename }) => {
                let require;
                globalThis.webpackChunk_ali_qianwen_web.push([['aasc-upload-' + Date.now()], {}, r => { require = r; }]);
                let client;
                for (const id of Object.keys(require.m).filter(id => /requestWithRetryPromise/.test(String(require.m[id])))) {
                    try { client = Object.values(require(id)).find(value => value && typeof value.requestPromise === 'function'); } catch {}
                    if (client) break;
                }
                if (!client) throw new Error('千问官网上传SDK不可用');
                const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                const request = async (url, body) => {
                    const response = await client.requestPromise({ url, method: 'POST', host: 'WORKSPACE',
                        signScene: 'workspace_api', body, data: body, useSignature: true });
                    const result = response.data;
                    if (result?.code !== 0 || !result.data) throw new Error('千问参考图上传校验失败');
                    return result.data;
                };
                const config = await request('/1/oss_token', { file_name: filename, content_type: 'application/octet-stream', content_md5: md5, size: data.length });
                if (!/^https:\/\//.test(config.host)) throw new Error('千问上传地址无效');
                const put = await fetch(`${config.host}/${encodeURIComponent(config.object)}?biz_id=ai_qwen&req_id=${crypto.randomUUID()}`, {
                    method: 'PUT', body: data, headers: { ...Object.fromEntries((config.oss_headers || []).map(x => [x.key, x.value])),
                        'Content-Type': 'application/octet-stream', 'Content-MD5': md5, Authorization: config.authorization }
                });
                if (!put.ok) throw new Error('千问参考图文件上传失败');
                const file = await request(`/1/oss/callback?biz_id=ai_qwen&req_id=${crypto.randomUUID()}`, {
                    file_md5: md5, file_name: filename, file_type: filename.split('.').at(-1), bucket: config.bucket,
                    endpoint: config.endpoint, object: config.object, entry: 'qwen_pc' });
                return { id: file.ws_gid, url: file.material_cdn_url || file.material_url };
            }, { base64: image.data.toString('base64'), md5: createHash('md5').update(image.data).digest('base64'),
                filename: `reference.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1]}` });
            if (!uploadResult.id || !/^https:\/\//.test(uploadResult.url || '')) throw new Error('千问参考图上传没有返回资源');
            return uploadResult;
        } finally {
            signal?.removeEventListener('abort', abort);
            await page?.close().catch(() => {});
            await browser.disconnect();
        }
    }
    return {
        upload(image, options) {
            const task = queue.then(() => upload(image, options));
            queue = task.catch(() => {}); return task;
        },
        stop: () => launcher.close()
    };
}
module.exports = { createQwenImageBrowser };
