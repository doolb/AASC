'use strict';

const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { QuarkVideoCache } = require('./quark-video-cache');
const QUARK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch';
const API = 'https://drive-pc.quark.cn/1/clouddrive';


// 分享接口并非稳定公开协议，所有媒体读取均限制在夸克返回的 HTTPS 域名内。
module.exports = Base => class QuarkShareProvider extends Base {
    constructor(config, options = {}) {
        super(config);
        let url;
        try { url = new URL(config.url); } catch { throw new Error('夸克分享链接无效'); }
        const match = url.protocol === 'https:' && url.hostname === 'pan.quark.cn' && /^\/s\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname);
        if (!match || url.username || url.password) throw new Error('请输入有效的夸克分享链接');
        this.shareId = match[1];
        this.passcode = String(config.passcode || '');
        this.client = options.client || axios;
        this.videoCache = options.videoCache || new QuarkVideoCache(path.join(os.tmpdir(), 'aasc-quark-video-cache'));
        this.getPort = options.getPort || (() => 8081);
        this.getLocalIP = options.getLocalIP || (() => 'localhost');
        this.isHttps = options.isHttps || (() => false);
        this.token = '';
        this.getCookie = options.getCookie || (() => '');
        this.cookieSource = '';
        this.cookie = '';
        this.cookieRefresh = null;
        this.cookieRefreshAt = 0;
    }
    async request(endpoint, params = {}, body = null) {
        const url = `https://drive.quark.cn/1/clouddrive/share/sharepage/${endpoint}`;
        const options = { params: { pr: 'ucpro', fr: 'pc', uc_param_str: '', ...params }, headers: { Referer: 'https://pan.quark.cn/', Origin: 'https://pan.quark.cn', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000, maxRedirects: 0 };
        const response = body ? await this.client.post(url, body, options) : await this.client.get(url, options);
        if (response.data?.code !== 0) throw new Error(`夸克分享访问失败: ${response.data?.message || '未知错误'}`);
        return response.data;
    }
    async connect() {
        const result = await this.request('token', {}, { pwd_id: this.shareId, passcode: this.passcode });
        this.token = result.data?.stoken;
        if (!this.token) throw new Error('夸克未返回分享令牌');
        await this.entries('0');
        this.connected = true;
    }
    async disconnect() { this.token = ''; this.connected = false; }
    async entries(fid) {
        const items = [];
        for (let page = 1; page <= 1000; page++) {
            const response = await this.request('detail', { pwd_id: this.shareId, stoken: this.token, pdir_fid: fid, _page: page, _size: 50, _fetch_total: 1 });
            const list = response.data?.list;
            if (!Array.isArray(list)) throw new Error('夸克分享目录格式无效');
            items.push(...list);
            if (list.length < 50 || items.length >= Number(response.metadata?._total || Infinity)) return items;
        }
        throw new Error('夸克分享目录页数超限');
    }
    segments(value) {
        const input = String(value || '/');
        if (input.includes('\\') || input.includes('\0')) throw new Error('媒体路径无效');
        const parts = input.split('/').filter(Boolean);
        if (parts.some(part => part === '.' || part === '..')) throw new Error('媒体路径无效');
        return parts;
    }
    async directory(parts) {
        let fid = '0';
        for (const name of parts) {
            const item = (await this.entries(fid)).find(entry => entry.dir && entry.file_name === name);
            if (!item) throw new Error('夸克分享目录不存在');
            fid = item.fid;
        }
        return fid;
    }
    async list(dirPath = '/') {
        const parts = this.segments(dirPath);
        const entries = await this.entries(await this.directory(parts));
        return entries.filter(item => item.file_name && !item.file_name.includes('/')).map(item => {
            const itemPath = '/' + [...parts, item.file_name].join('/');
            const mediaType = item.dir ? 'folder' : this.detectMediaType(item.file_name);
            return { name: item.file_name, path: itemPath, type: item.dir ? 'folder' : 'file', mediaType, ...(mediaType === 'video' && item.thumbnail ? { hasThumbnail: true } : {}), size: Number(item.size || 0), modifiedTime: item.updated_at ? new Date(item.updated_at) : null, url: this.getPublicUrl(itemPath), ...(mediaType === 'text' ? { format: this.detectTextFormat(item.file_name) } : {}) };
        });
    }
    async findFile(filePath) {
        const parts = this.segments(filePath);
        const name = parts.pop();
        if (!name) throw new Error('文件路径无效');
        const item = (await this.entries(await this.directory(parts))).find(entry => !entry.dir && entry.file_name === name);
        if (!item) throw new Error('夸克分享文件不存在');
        return item;
    }
    async getFile(filePath) {
        const item = await this.findFile(filePath);
        // 预览文件大小可能不同于原文件，不能用原文件大小解析 Range。
        return { name: item.file_name, path: filePath, type: 'file', mediaType: this.detectMediaType(item.file_name), size: this.detectMediaType(item.file_name) === 'video' ? Number(item.size || 0) : 0, url: this.getPublicUrl(filePath) };
    }
    // 只维护当前进程内的登录态，不把 Cookie 或上游签名地址传给浏览器。
    mergeCookies(response) {
        for (const value of response.headers?.['set-cookie'] || []) {
            const pair = value.split(';')[0].trim();
            const name = pair.split('=')[0];
            if (!['__pus', '__puus'].includes(name)) continue;
            this.cookie = this.cookie.split(';').map(part => part.trim()).filter(part => part && !part.startsWith(name + '=' )).concat(pair).join('; ');
        }
    }
    async videoUrl(item) {
        const configured = String(this.getCookie() || process.env.KUAKE_COOKIE || '').trim() ||
            (process.env.KUAKE_PUS && process.env.KUAKE_PUUS ? `__pus=${process.env.KUAKE_PUS}; __puus=${process.env.KUAKE_PUUS}` : '');
        if (!configured) throw new Error('读取夸克原文件需要在服务端配置 KUAKE_COOKIE');
        if (this.cookieSource !== configured) { this.cookieSource = configured; this.cookie = configured; this.cookieRefreshAt = 0; }
        const params = { pr: 'ucpro', fr: 'pc' };
        // 多个缩略图或播放请求共享一次刷新，避免并发刷新使其他直链签名失效。
        if (Date.now() >= this.cookieRefreshAt) {
            if (!this.cookieRefresh) this.cookieRefresh = (async () => {
                const freshCookie = this.cookie.split(';').map(part => part.trim()).filter(part => !part.startsWith('__puus=')).join('; ');
                const fresh = await this.client.get(`${API}/config`, { params, headers: { Cookie: freshCookie, 'User-Agent': QUARK_UA }, timeout: 15000, maxRedirects: 0 });
                this.mergeCookies(fresh);
                this.cookieRefreshAt = Date.now() + 60 * 60 * 1000;
            })().finally(() => { this.cookieRefresh = null; });
            await this.cookieRefresh;
        }
        const response = await this.client.post(`${API}/file/download`, {
            fids: [item.fid], fids_token: [item.share_fid_token], pwd_id: this.shareId, stoken: this.token,
            speedup_session: '', token: ''
        }, { params: { ...params, sys: 'win32', ve: '3.23.2' }, headers: { Cookie: this.cookie, 'User-Agent': QUARK_UA, 'Content-Type': 'application/json' }, timeout: 15000, maxRedirects: 0 });
        this.mergeCookies(response);
        if (response.data?.code !== 0 || !response.data?.data?.[0]?.download_url) throw new Error(`夸克视频地址获取失败: ${response.data?.message || '未知错误'}`);
        let url;
        try { url = new URL(response.data.data[0].download_url); } catch { throw new Error('夸克视频地址无效'); }
        if (url.protocol !== 'https:' || url.username || url.password || !['.pds.quark.cn', '.drive.quark.cn'].some(domain => url.hostname.endsWith(domain))) throw new Error('夸克视频地址不受信任');
        return { url: url.href, cookie: this.cookie };
    }
    async prepareVideo(filePath, onProgress) {
        const item = await this.findFile(filePath);
        if (this.detectMediaType(item.file_name) !== 'video') throw new Error('该文件不是视频');
        return this.prepareVideoItem(item, onProgress);
    }
    async prepareVideoItem(item, onProgress) {
        const identity = JSON.stringify([this.shareId, item.fid, item.size, item.updated_at || item.l_updated_at || '']);
        return this.videoCache.prepare(identity, Number(item.size), async () => {
            const resolved = await this.videoUrl(item);
            const response = await this.client.get(resolved.url, { responseType: 'stream', timeout: 15000, maxRedirects: 0,
                headers: { Cookie: resolved.cookie, 'User-Agent': QUARK_UA, Referer: 'https://pan.quark.cn/' } });
            return response.data;
        }, onProgress);
    }
    async getDownloadStream(filePath, rangeHeader) {
        const item = await this.findFile(filePath);
        const resolved = await this.videoUrl(item);
        const headers = { Cookie: resolved.cookie, 'User-Agent': QUARK_UA, Referer: 'https://pan.quark.cn/' };
        if (typeof rangeHeader === 'string' && /^bytes=(?:\d+-\d*|-\d+)$/.test(rangeHeader) && rangeHeader.length <= 100) headers.Range = rangeHeader;
        const response = await this.client.get(resolved.url, { responseType: 'stream', timeout: 15000, maxRedirects: 0, headers });
        const resultHeaders = {};
        for (const [key, target] of [['content-length', 'Content-Length'], ['content-range', 'Content-Range'], ['accept-ranges', 'Accept-Ranges']]) {
            if (response.headers[key]) resultHeaders[target] = response.headers[key];
        }
        return { stream: response.data, statusCode: response.status, headers: resultHeaders, fileName: item.file_name };
    }
    async getFileStream(filePath, range) {
        const item = await this.findFile(filePath);
        if (this.detectMediaType(item.file_name) === 'video') {
            const cached = await this.prepareVideoItem(item);
            const size = Number(item.size);
            const headers = { 'Accept-Ranges': 'bytes', 'Content-Length': String(range ? range.end - range.start + 1 : size) };
            if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
            return { stream: fs.createReadStream(cached, range ? { start: range.start, end: range.end } : {}), statusCode: range ? 206 : 200, headers };
        }
        if (item.obj_category !== 'image' || !item.preview_url) throw new Error('该夸克分享文件暂无可用的图片预览');
        let url;
        try { url = new URL(item.preview_url); } catch { throw new Error('夸克预览地址无效'); }
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.drive.quark.cn') || url.username || url.password) throw new Error('夸克预览地址无效');
        const response = await this.client.get(url.href, { responseType: 'stream', timeout: 15000, maxRedirects: 0, headers: { Referer: 'https://pan.quark.cn/' } });
        const headers = { 'Accept-Ranges': 'none' };
        for (const [key, target] of [['content-type', 'Content-Type'], ['content-length', 'Content-Length']]) if (response.headers[key]) headers[target] = response.headers[key];
        return { stream: response.data, statusCode: response.status, headers };
    }
    async getThumbnailStream(filePath) {
        const item = await this.findFile(filePath);
        if (this.detectMediaType(item.file_name) !== 'video' || !item.thumbnail) throw new Error('该视频没有可用缩略图');
        let url;
        try { url = new URL(item.thumbnail); } catch { throw new Error('夸克缩略图地址无效'); }
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.drive.quark.cn') || url.username || url.password) throw new Error('夸克缩略图地址无效');
        const response = await this.client.get(url.href, { responseType: 'stream', timeout: 15000, maxRedirects: 0, headers: { Referer: 'https://pan.quark.cn/' } });
        if (!/^image\//i.test(response.headers['content-type'] || '')) { response.data.destroy(); throw new Error('夸克缩略图格式无效'); }
        const headers = { 'Content-Type': response.headers['content-type'], 'Accept-Ranges': 'none', 'Cache-Control': 'private, max-age=300' };
        if (response.headers['content-length']) headers['Content-Length'] = response.headers['content-length'];
        return { stream: response.data, statusCode: response.status, headers };
    }
    getPublicUrl(filePath) {
        const encoded = this.segments(filePath).map(encodeURIComponent).join('/');
        return `${this.isHttps() ? 'https' : 'http'}://${this.getLocalIP()}:${this.getPort()}/api/media-libraries/${encodeURIComponent(this.config.id)}/proxy/${encoded}`;
    }
};
