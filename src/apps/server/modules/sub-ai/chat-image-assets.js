'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const axios = require('axios');
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const LIMIT = 20 * 1024 * 1024;

/** 图片落盘后历史只保存本地URL；不将上游签名地址写进聊天快照。 */
function createChatImageAssets({ directory, urlPrefix = '/uploads/chat-images/', http = axios }) {
    async function save(image, { signal } = {}) {
        let data; let mime;
        if (image.dataUrl) {
            const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);
            if (!match || match[2].length > LIMIT * 1.4) throw new Error('参考图片格式或大小无效');
            mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]; data = Buffer.from(match[2], 'base64');
        } else {
            if (!/^https:\/\//.test(image.url || '')) throw new Error('生成图片地址无效');
            const response = await http.get(image.url, { responseType: 'arraybuffer', signal,
                timeout: 60000, maxContentLength: LIMIT, maxBodyLength: LIMIT });
            mime = String(response.headers['content-type'] || '').split(';')[0]; data = Buffer.from(response.data);
        }
        if (!MIME_EXT[mime] || !data.length || data.length > LIMIT) throw new Error('上游未返回有效图片或图片过大');
        const id = randomUUID(); const filename = `${id}.${MIME_EXT[mime]}`;
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, filename), data, { flag: 'wx' });
        return { id, url: `${urlPrefix}${filename}`, mimeType: mime };
    }
    async function read(image) {
        if (!image.url?.startsWith(urlPrefix)) throw new Error('参考图片不属于本地聊天');
        const filename = image.url.slice(urlPrefix.length);
        if (!/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(filename)) throw new Error('参考图片标识无效');
        return { ...image, data: await fs.readFile(path.join(directory, filename)) };
    }
    return { save, read };
}
module.exports = { createChatImageAssets };
