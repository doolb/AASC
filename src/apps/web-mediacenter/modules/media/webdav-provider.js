'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

// WebDAV 地址按段编码，拒绝穿越和目录分隔符，保持所有操作在配置根目录内。
module.exports = Base => class WebDavProvider extends Base {
    constructor(config, options = {}) {
        super(config);
        this.base = new URL(config.url);
        if (!['http:', 'https:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error('WebDAV 地址无效');
        this.base.pathname = this.base.pathname.replace(/\/+$/, '') + '/';
        this.client = options.client || axios;
        this.getPort = options.getPort || (() => 8081);
        this.getLocalIP = options.getLocalIP || (() => 'localhost');
        this.isHttps = options.isHttps || (() => false);
    }
    segments(value) {
        const raw = String(value || '/');
        if (raw.includes('\\') || raw.includes('\0')) throw new Error('WebDAV 路径无效');
        const parts = raw.split('/').filter(Boolean);
        if (parts.some(part => part === '.' || part === '..')) throw new Error('WebDAV 路径无效');
        return parts;
    }
    url(value) { return new URL(this.segments(value).map(encodeURIComponent).join('/'), this.base).href; }
    async request(method, target, options = {}) {
        let url = target;
        for (let count = 0; count <= 4; count++) {
            const current = new URL(url);
            if (!['http:', 'https:'].includes(current.protocol) || current.username || current.password || (this.base.protocol === 'https:' && current.protocol !== 'https:')) throw new Error('WebDAV 重定向地址无效');
            const sameOrigin = current.origin === this.base.origin;
            if (!sameOrigin && !['GET', 'HEAD'].includes(method)) throw new Error('WebDAV 操作不允许跨站重定向');
            const auth = sameOrigin && this.config.username ? { username: this.config.username, password: this.config.password || '' } : undefined;
            const response = await this.client.request({ ...options, url, method, auth, proxy: false, timeout: 30000, maxRedirects: 0, validateStatus: () => true });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                response.data?.destroy?.();
                if (!response.headers.location) throw new Error('WebDAV 重定向缺少地址');
                url = new URL(response.headers.location, url).href;
                continue;
            }
            if (response.status < 200 || response.status >= 300) {
                response.data?.destroy?.();
                throw new Error(`WebDAV 请求失败 (${response.status})`);
            }
            return response;
        }
        throw new Error('WebDAV 重定向次数过多');
    }
    async connect() { await this.list('/'); this.connected = true; }
    async disconnect() { this.connected = false; }
    async properties(dirPath, depth) {
        const response = await this.request('PROPFIND', this.url(dirPath), { headers: { Depth: String(depth), 'Content-Type': 'application/xml' }, data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>', responseType: 'text', maxContentLength: 4 * 1024 * 1024 });
        if (response.status !== 207 || /<!DOCTYPE|<!ENTITY/i.test(String(response.data))) throw new Error('WebDAV 目录响应无效');
        const $ = cheerio.load(String(response.data), { xmlMode: true });
        const nameIs = (node, name) => node.type === 'tag' && node.name.split(':').pop().toLowerCase() === name;
        const find = (root, name) => $(root).find('*').filter((_, node) => nameIs(node, name));
        const basePath = decodeURIComponent(this.base.pathname).replace(/\/+$/, '') + '/';
        const items = [];
        $('*').filter((_, node) => nameIs(node, 'response')).each((_, node) => {
            try {
                const href = find(node, 'href').first().text();
                const parsed = new URL(href, this.base);
                if (parsed.origin !== this.base.origin) return;
                const decoded = decodeURIComponent(parsed.pathname);
                if (!decoded.startsWith(basePath) && decoded.replace(/\/+$/, '') !== basePath.replace(/\/+$/, '')) return;
                const relative = decoded.slice(basePath.length).replace(/\/+$/, '');
                if (!relative) return;
                const parts = this.segments(relative);
                if (parts.join('/') !== relative) return;
                const propstats = find(node, 'propstat').toArray().filter(item => /\s2\d\d(?:\s|$)/.test(find(item, 'status').first().text()));
                if (!propstats.length) return;
                const root = propstats[0];
                const folder = find(root, 'collection').length > 0;
                const name = parts.at(-1);
                const mediaType = folder ? 'folder' : this.detectMediaType(name);
                const value = Number(find(root, 'getcontentlength').first().text());
                const time = new Date(find(root, 'getlastmodified').first().text());
                const itemPath = '/' + relative;
                items.push({ name, path: itemPath, type: folder ? 'folder' : 'file', mediaType, size: Number.isSafeInteger(value) && value >= 0 ? value : 0, modifiedTime: Number.isNaN(time.getTime()) ? null : time, url: this.getPublicUrl(itemPath) });
            } catch { /* 跳过不属于配置根目录的异常条目。 */ }
        });
        return items;
    }
    async list(dirPath = '/') {
        const expected = this.segments(dirPath).length + 1;
        return (await this.properties(dirPath, 1)).filter(item => this.segments(item.path).length === expected);
    }
    async getFile(filePath) {
        const response = await this.request('HEAD', this.url(filePath));
        const name = this.segments(filePath).at(-1);
        return { name, path: filePath, type: 'file', mediaType: this.detectMediaType(name), size: Number(response.headers['content-length']) || 0, url: this.getPublicUrl(filePath) };
    }
    async getFileStream(filePath, range) {
        const headers = range ? { Range: `bytes=${range.start}-${range.end}` } : {};
        const response = await this.request('GET', this.url(filePath), { headers, responseType: 'stream' });
        const result = {};
        for (const key of ['content-type', 'content-range', 'accept-ranges', 'content-length']) if (response.headers[key]) result[key] = response.headers[key];
        return { stream: response.data, statusCode: response.status, headers: result };
    }
    getPublicUrl(filePath) {
        const encoded = this.segments(filePath).map(encodeURIComponent).join('/');
        return `${this.isHttps() ? 'https' : 'http'}://${this.getLocalIP()}:${this.getPort()}/api/media-libraries/${encodeURIComponent(this.config.id)}/proxy/${encoded}`;
    }
    async uploadFile(dirPath, file) {
        const name = String(file.filename || '');
        if (!name || this.segments(name).length !== 1 || name.includes('/')) throw new Error('文件名无效');
        const target = '/' + [...this.segments(dirPath), name].join('/');
        await this.request('PUT', this.url(target), { data: file.data, headers: { 'Content-Type': file.contentType || 'application/octet-stream', 'If-None-Match': '*' }, maxBodyLength: Infinity });
        return { name, path: target, url: this.getPublicUrl(target) };
    }
    async createFolder(dirPath, name) {
        if (!name || this.segments(name).length !== 1 || name.includes('/')) throw new Error('文件夹名称无效');
        const target = '/' + [...this.segments(dirPath), name].join('/');
        await this.request('MKCOL', this.url(target));
        return { name, path: target };
    }
    async deleteFile(filePath) { if (!this.segments(filePath).length) throw new Error('不能删除媒体库根目录'); await this.request('DELETE', this.url(filePath)); return true; }
    async deleteFolder(filePath) { return this.deleteFile(filePath); }
};
