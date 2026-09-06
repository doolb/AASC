const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

class MediaLibraryProvider {
    constructor(config) {
        this.config = config;
        this.connected = false;
    }

    async connect() {
        throw new Error('必须实现 connect 方法');
    }

    async disconnect() {
        throw new Error('必须实现 disconnect 方法');
    }

    async list(dirPath) {
        throw new Error('必须实现 list 方法');
    }

    async getFile(filePath) {
        throw new Error('必须实现 getFile 方法');
    }

    async uploadFile(dirPath, file) {
        throw new Error('必须实现 uploadFile 方法');
    }

    async deleteFile(filePath) {
        throw new Error('必须实现 deleteFile 方法');
    }

    async createFolder(dirPath, folderName) {
        throw new Error('必须实现 createFolder 方法');
    }

    async deleteFolder(folderPath) {
        throw new Error('必须实现 deleteFolder 方法');
    }

    async getFileStream(filePath) {
        throw new Error('必须实现 getFileStream 方法');
    }

    getPublicUrl(filePath) {
        throw new Error('必须实现 getPublicUrl 方法');
    }

    detectMediaType(name) {
        const ext = name.toLowerCase().split('.').pop().split('?')[0];
        if (['gif'].includes(ext)) return 'gif';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        if (['wav', 'ogg', 'mp3'].includes(ext)) return 'audio';
        if (['html', 'htm', 'mhtml'].includes(ext)) return 'html';
        if (['txt', 'md'].includes(ext)) return 'text';
        return 'image';
    }

    detectTextFormat(name) {
        const ext = name.toLowerCase().split('.').pop().split('?')[0];
        if (ext === 'md') return 'markdown';
        if (ext === 'txt') return 'plain';
        return undefined;
    }

    // 解析 HTTP Range: bytes=start-end / bytes=start- / bytes=-suffix
    // 非法或越界返回 null，由调用方回退为 200 整流
    parseRange(rangeHeader, totalSize) {
        if (!rangeHeader || typeof totalSize !== 'number' || totalSize <= 0) return null;
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (!m) return null;
        let start = m[1] === '' ? null : parseInt(m[1], 10);
        let end = m[2] === '' ? null : parseInt(m[2], 10);
        if (start === null && end === null) return null;
        if (start === null) {
            // 末尾后缀段 bytes=-N：取最后 N 字节
            start = Math.max(0, totalSize - end);
            end = totalSize - 1;
        } else if (end === null) {
            end = totalSize - 1;
        }
        if (start > end || start >= totalSize) return null;
        if (end >= totalSize) end = totalSize - 1;
        return { start, end };
    }
}

class LocalProvider extends MediaLibraryProvider {
    constructor(config, options = {}) {
        super(config);
        this.basePath = path.resolve(config.path);
        this.getPort = options.getPort || (() => 8081);
        this.getLocalIP = options.getLocalIP || (() => 'localhost');
        this.isHttps = options.isHttps || (() => false);
        const resUploadsDir = path.resolve(process.cwd(), 'res', 'uploads');
        this.isUploadsDir = this.basePath === resUploadsDir;
        this.routePrefix = `/media/${config.id}`;
    }

    async connect() {
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
        this.connected = true;
        return true;
    }

    async disconnect() {
        this.connected = false;
        return true;
    }

    async list(dirPath = '/') {
        const fullPath = this._resolvePath(dirPath);
        
        if (!fs.existsSync(fullPath)) {
            return [];
        }
        
        const items = fs.readdirSync(fullPath);
        
        return items
            .filter(name => !name.startsWith('.'))
            .map(name => {
                try {
                    const itemPath = path.join(fullPath, name);
                    const linkStat = fs.lstatSync(itemPath);
                    let stat = linkStat;
                    
                    // Termux 的 ~/storage 及其下级目录通常是符号链接。
                    // lstat 只能得到链接本身，不能正确判断目标是否为目录，
                    // 因此需要保留断链检查，同时使用 stat 获取目标文件的真实属性。
                    if (linkStat.isSymbolicLink()) {
                        try {
                            stat = fs.statSync(itemPath);
                        } catch (e) {
                            return null;
                        }
                    }
                    
                    const relativePath = path.join(dirPath, name).replace(/\\/g, '/');
                    
                    const mediaType = stat.isDirectory() ? 'folder' : this.detectMediaType(name);
                    return {
                        name: name,
                        path: relativePath,
                        type: stat.isDirectory() ? 'folder' : 'file',
                        mediaType,
                        ...(mediaType === 'text' ? { format: this.detectTextFormat(name) } : {}),
                        size: stat.size,
                        modifiedTime: stat.mtime,
                        url: this.getPublicUrl(relativePath)
                    };
                } catch (e) {
                    return null;
                }
            })
            .filter(item => item !== null)
            .sort((a, b) => {
                if (a.type === 'folder' && b.type !== 'folder') return -1;
                if (a.type !== 'folder' && b.type === 'folder') return 1;
                return a.name.localeCompare(b.name);
            });
    }

    async getFile(filePath) {
        const fullPath = this._resolvePath(filePath);
        
        if (!fs.existsSync(fullPath)) {
            return null;
        }
        
        const stat = fs.statSync(fullPath);
        
        const mediaType = this.detectMediaType(filePath);
        return {
            name: path.basename(filePath),
            path: filePath,
            type: 'file',
            mediaType,
            ...(mediaType === 'text' ? { format: this.detectTextFormat(filePath) } : {}),
            size: stat.size,
            modifiedTime: stat.mtime,
            url: this.getPublicUrl(filePath)
        };
    }

    async uploadFile(dirPath, file) {
        const fullPath = this._resolvePath(dirPath);
        
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
        
        const uniqueName = `${Date.now()}_${file.filename}`;
        const filePath = path.join(fullPath, uniqueName);
        
        fs.writeFileSync(filePath, file.data);
        file.data = null;
        
        const relativePath = path.join(dirPath, uniqueName).replace(/\\/g, '/');
        
        return {
            name: uniqueName,
            path: relativePath,
            url: this.getPublicUrl(relativePath)
        };
    }

    async deleteFile(filePath) {
        const fullPath = this._resolvePath(filePath);
        
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
        
        return true;
    }

    async createFolder(dirPath, folderName) {
        const fullPath = this._resolvePath(path.join(dirPath, folderName));
        
        fs.mkdirSync(fullPath, { recursive: true });
        
        return {
            name: folderName,
            path: path.join(dirPath, folderName).replace(/\\/g, '/')
        };
    }

    async deleteFolder(folderPath) {
        const fullPath = this._resolvePath(folderPath);
        
        if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true });
        }
        
        return true;
    }

    async getFileStream(filePath, range) {
        const fullPath = this._resolvePath(filePath);

        if (!fs.existsSync(fullPath)) {
            throw new Error('文件不存在');
        }

        const stat = fs.statSync(fullPath);
        if (!range) {
            return {
                stream: fs.createReadStream(fullPath),
                statusCode: 200,
                headers: {
                    'Content-Length': String(stat.size),
                    'Accept-Ranges': 'bytes'
                }
            };
        }
        return {
            stream: fs.createReadStream(fullPath, { start: range.start, end: range.end }),
            statusCode: 206,
            headers: {
                'Content-Length': String(range.end - range.start + 1),
                'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
                'Accept-Ranges': 'bytes'
            }
        };
    }

    // 路径分段编码：encodeURIComponent 会把 / 编成 %2F，express.static 不解码导致子目录 404
    _encodePath(filePath) {
        return filePath.split('/').map(seg => encodeURIComponent(seg)).join('/');
    }

    getPublicUrl(filePath) {
        const localIP = this.getLocalIP();
        const port = this.getPort();
        const protocol = this.isHttps() ? 'https' : 'http';
        const cleanPath = filePath.replace(/^\//, '');
        const encoded = this._encodePath(cleanPath);
        if (this.isUploadsDir) {
            return `${protocol}://${localIP}:${port}/uploads/${encoded}`;
        }
        return `${protocol}://${localIP}:${port}${this.routePrefix}/${encoded}`;
    }
    
    getRoutePrefix() {
        return this.routePrefix;
    }
    
    getBasePath() {
        return this.basePath;
    }

    _resolvePath(relativePath) {
        const cleanPath = relativePath.replace(/^\/+/, '').replace(/\/+$/, '');
        const resolved = path.join(this.basePath, cleanPath);
        const normalized = path.normalize(resolved);
        
        if (!normalized.startsWith(this.basePath)) {
            throw new Error('路径遍历攻击检测');
        }
        
        return normalized;
    }
}

class HttpProvider extends MediaLibraryProvider {
    constructor(config, options = {}) {
        super(config);
        this.baseUrl = config.url;
        this.username = config.username;
        this.password = config.password;
        this.cache = new Map();
        this.cacheTimeout = config.cacheTimeout || 60000;
        this.requestTimeout = config.requestTimeout || 8000;
        this.getPort = options.getPort || (() => 8081);
        this.getLocalIP = options.getLocalIP || (() => 'localhost');
        this.isHttps = options.isHttps || (() => false);
    }

    async connect() {
        try {
            await this._fetchList('/');
            this.connected = true;
            
            this._cacheCleanupTimer = setInterval(() => {
                const now = Date.now();
                for (const [key, entry] of this.cache) {
                    if (now - entry.time > this.cacheTimeout) {
                        this.cache.delete(key);
                    }
                }
            }, this.cacheTimeout);
            
            return true;
        } catch (err) {
            throw new Error(`无法连接到HTTP服务器: ${err.message}`);
        }
    }

    async disconnect() {
        this.cache.clear();
        if (this._cacheCleanupTimer) {
            clearInterval(this._cacheCleanupTimer);
            this._cacheCleanupTimer = null;
        }
        this.connected = false;
        return true;
    }

    async list(dirPath = '/') {
        return this._fetchList(dirPath);
    }

    async getFile(filePath) {
        // HEAD 获取真实大小/修改时间（fancy-index 列表只有人类可读大小，无法还原精确字节）
        const sizeInfo = await this._fetchHead(this._buildUrl(filePath).replace(/\/$/, ''));

        const mediaType = this.detectMediaType(filePath);
        return {
            name: path.basename(filePath),
            path: filePath,
            type: 'file',
            mediaType,
            ...(mediaType === 'text' ? { format: this.detectTextFormat(filePath) } : {}),
            size: (sizeInfo && sizeInfo.size) || 0,
            modifiedTime: (sizeInfo && sizeInfo.modifiedTime) || null,
            url: this.getPublicUrl(filePath)
        };
    }

    async uploadFile(dirPath, file) {
        throw new Error('HTTP媒体库不支持上传操作');
    }

    async deleteFile(filePath) {
        throw new Error('HTTP媒体库不支持删除操作');
    }

    async createFolder(dirPath, folderName) {
        throw new Error('HTTP媒体库不支持创建文件夹');
    }

    async deleteFolder(folderPath) {
        throw new Error('HTTP媒体库不支持删除文件夹');
    }

    async getFileStream(filePath, range) {
        // 文件 URL 去掉 _buildUrl 追加的尾斜杠（Apache 对文件尾斜杠返回 404）
        const url = this._buildUrl(filePath).replace(/\/$/, '');
        const client = url.startsWith('https') ? https : http;
        const reqHeaders = {};
        if (this.username && this.password) {
            reqHeaders.auth = `${this.username}:${this.password}`;
        }
        if (range) {
            reqHeaders.headers = { Range: `bytes=${range.start}-${range.end}` };
        }

        return new Promise((resolve, reject) => {
            const req = client.get(url, reqHeaders, (res) => {
                if (res.statusCode !== 200 && res.statusCode !== 206) {
                    reject(new Error(`HTTP错误: ${res.statusCode}`));
                    return;
                }
                const headers = {};
                // 统一为规范头名（Content-Type / Content-Range / Accept-Ranges / Content-Length），
                // 与 Local/SmbProvider 返回格式一致，供 proxy 端点 setHeader 使用
                const HEADER_MAP = {
                    'content-type': 'Content-Type',
                    'content-range': 'Content-Range',
                    'accept-ranges': 'Accept-Ranges',
                    'content-length': 'Content-Length'
                };
                for (const h of Object.keys(HEADER_MAP)) {
                    if (res.headers[h]) headers[HEADER_MAP[h]] = res.headers[h];
                }
                resolve({ stream: res, statusCode: res.statusCode, headers });
            });

            req.on('error', reject);
            req.setTimeout(this.requestTimeout, () => req.destroy(new Error('请求超时')));
        });
    }

    getPublicUrl(filePath) {
        // 同源 HTTPS 代理 URL：服务器 HTTPS 时显示端页面的 http:// 媒体被混合内容拦截，
        // 统一走 /api/media-libraries/{id}/proxy 保证可播放（与 SmbProvider 一致）
        const localIP = this.getLocalIP();
        const port = this.getPort();
        const protocol = this.isHttps() ? 'https' : 'http';
        const cleanPath = filePath.replace(/^\//, '');
        return `${protocol}://${localIP}:${port}/api/media-libraries/${this.config.id}/proxy/${encodeURIComponent(cleanPath)}`;
    }

    async _fetchList(dirPath) {
        const cacheKey = `list:${dirPath}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.time < this.cacheTimeout) {
            return cached.data;
        }

        const url = this._buildUrl(dirPath);
        const html = await this._fetchHtml(url);
        const items = this._parseHtml(html, dirPath);

        // 对媒体文件并发 HEAD 补精确 size / modifiedTime（fancy-index 列表只有人类可读大小），
        // 供控制端展示真实大小 + 库代理端点 Range 解析（视频 seek 依赖 size）
        const mediaTypes = ['image', 'video', 'gif', 'html', 'audio'];
        const mediaFiles = items.filter(i => i.type === 'file' && mediaTypes.includes(i.mediaType));
        await this._fillSizes(mediaFiles);

        this.cache.set(cacheKey, { data: items, time: Date.now() });

        return items;
    }

    // 小并发池对文件列表发 HEAD 补 size，单个失败/超时回落 0（不阻塞列表浏览）
    async _fillSizes(files) {
        const LIMIT = 6;
        let i = 0;
        const workers = Array.from({ length: Math.min(LIMIT, files.length) }, async () => {
            while (i < files.length) {
                const item = files[i++];
                const info = await this._fetchHead(this._buildUrl(item.path).replace(/\/$/, ''));
                if (info) {
                    item.size = info.size;
                    item.modifiedTime = info.modifiedTime;
                }
            }
        });
        await Promise.all(workers);
    }

    // HEAD 请求获取 Content-Length / Last-Modified；失败或超时返回 null（调用方回落 0）
    async _fetchHead(url) {
        const client = url.startsWith('https') ? https : http;
        const reqOptions = { method: 'HEAD' };
        if (this.username && this.password) {
            reqOptions.auth = `${this.username}:${this.password}`;
        }

        return new Promise((resolve) => {
            const req = client.request(url, reqOptions, (res) => {
                res.resume();
                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }
                const rawSize = res.headers['content-length'];
                const size = rawSize ? parseInt(rawSize, 10) : NaN;
                const rawModified = res.headers['last-modified'];
                const modifiedTime = rawModified ? new Date(rawModified) : null;
                resolve({
                    size: Number.isFinite(size) ? size : 0,
                    modifiedTime: modifiedTime && !isNaN(modifiedTime.getTime()) ? modifiedTime : null
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(this.requestTimeout, () => { req.destroy(); resolve(null); });
            req.end();
        });
    }

    _buildUrl(dirPath) {
        const baseUrl = this.baseUrl.replace(/\/$/, '');
        const cleanPath = dirPath.replace(/^\//, '');
        return cleanPath ? `${baseUrl}/${cleanPath}/` : `${baseUrl}/`;
    }

    async _fetchHtml(url) {
        const client = url.startsWith('https') ? https : http;
        const reqOptions = {};
        if (this.username && this.password) {
            reqOptions.auth = `${this.username}:${this.password}`;
        }

        return new Promise((resolve, reject) => {
            const req = client.get(url, reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP错误: ${res.statusCode}`));
                        return;
                    }
                    resolve(data);
                });
            });

            req.on('error', reject);
            // 不可达服务器 8s 内快速失败，避免媒体库 init 挂死（如 192.168.1.101 失联）
            req.setTimeout(this.requestTimeout, () => req.destroy(new Error('请求超时')));
        });
    }

    _parseHtml(html, dirPath) {
        const items = [];
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
        let match;
        // fancy-index 目录列表的表头排序链接（?C=N;O=D 等）与 Parent Directory 不应成为媒体项
        const JUNK_NAMES = new Set(['Name', 'Last modified', 'Size', 'Description', 'Parent Directory']);

        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const name = match[2].trim();

            if (name === '..' || name === '../' || name === '.') continue;
            if (JUNK_NAMES.has(name) && /^\?C=/.test(href)) continue;
            if (name === 'Parent Directory') continue;

            const isFolder = href.endsWith('/');
            const cleanName = name.replace(/\/$/, '');

            if (cleanName) {
                const itemPath = dirPath === '/'
                    ? '/' + cleanName
                    : dirPath + '/' + cleanName;

                const mediaType = isFolder ? 'folder' : this.detectMediaType(cleanName);
                items.push({
                    name: cleanName,
                    path: itemPath,
                    type: isFolder ? 'folder' : 'file',
                    mediaType,
                    ...(mediaType === 'text' ? { format: this.detectTextFormat(cleanName) } : {}),
                    size: 0,
                    modifiedTime: null,
                    url: this.getPublicUrl(itemPath)
                });
            }
        }

        return items.sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });
    }
}

class SmbProvider extends MediaLibraryProvider {
    constructor(config, options = {}) {
        super(config);
        this.server = config.server;
        this.sharePath = config.share;
        this.share = this._buildSharePath(config.server, config.share);
        this.domain = config.domain || 'WORKGROUP';
        this.username = config.username;
        this.password = config.password;
        this.smbClient = null;
        this.getPort = options.getPort || (() => 8081);
        this.getLocalIP = options.getLocalIP || (() => 'localhost');
        this.isHttps = options.isHttps || (() => false);
    }

    _buildSharePath(server, sharePath) {
        if (!server || !sharePath) {
            return '';
        }
        const cleanShare = sharePath.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '').replace(/[\/\\]+/g, '\\');
        return `\\\\${server}\\${cleanShare}`;
    }

    async connect() {
        try {
            if (!this.server) {
                throw new Error('SMB服务器地址不能为空');
            }
            
            if (!this.sharePath) {
                throw new Error('SMB共享路径不能为空');
            }
            
            if (!this.share) {
                throw new Error('SMB共享路径构建失败');
            }
            
            const SMB2 = this._loadSmb2();
            
            this.smbClient = new SMB2({
                share: this.share,
                domain: this.domain,
                username: this.username,
                password: this.password
            });
            
            await this._readdir('');
            this.connected = true;
            return true;
        } catch (err) {
            throw new Error(`无法连接到SMB服务器: ${err.message}`);
        }
    }

    _loadSmb2() {
        try {
            return require('@marsaud/smb2');
        } catch (e) {
            try {
                return require('smb2');
            } catch (e2) {
                throw new Error('SMB2库未安装，请运行: npm install @marsaud/smb2');
            }
        }
    }

    async disconnect() {
        if (this.smbClient) {
            this.smbClient.close();
            this.smbClient = null;
        }
        this.connected = false;
        return true;
    }

    async list(dirPath = '/') {
        let cleanPath = dirPath.replace(/^\//, '').replace(/\/$/, '');
        const files = await this._readdir(cleanPath);
        
        return files.map(file => {
            const itemPath = dirPath === '/' ? '/' + file.name : dirPath + '/' + file.name;
            
            const mediaType = file.isDirectory ? 'folder' : this.detectMediaType(file.name);
            return {
                name: file.name,
                path: itemPath,
                type: file.isDirectory ? 'folder' : 'file',
                mediaType,
                ...(mediaType === 'text' ? { format: this.detectTextFormat(file.name) } : {}),
                size: file.size || 0,
                modifiedTime: file.modifiedTime || null,
                url: this.getPublicUrl(itemPath)
            };
        }).sort((a, b) => {
            if (a.type === 'folder' && b.type !== 'folder') return -1;
            if (a.type !== 'folder' && b.type === 'folder') return 1;
            return a.name.localeCompare(b.name);
        });
    }

    async getFile(filePath) {
        const cleanPath = filePath.replace(/^\//, '');
        const stat = await this._stat(cleanPath);
        
        const mediaType = this.detectMediaType(filePath);
        return {
            name: path.basename(filePath),
            path: filePath,
            type: 'file',
            mediaType,
            ...(mediaType === 'text' ? { format: this.detectTextFormat(filePath) } : {}),
            size: stat.size || 0,
            modifiedTime: stat.modifiedTime || null,
            url: this.getPublicUrl(filePath)
        };
    }

    async uploadFile(dirPath, file) {
        throw new Error('SMB媒体库暂不支持上传操作');
    }

    async deleteFile(filePath) {
        throw new Error('SMB媒体库暂不支持删除操作');
    }

    async createFolder(dirPath, folderName) {
        throw new Error('SMB媒体库暂不支持创建文件夹');
    }

    async deleteFolder(folderPath) {
        throw new Error('SMB媒体库暂不支持删除文件夹');
    }

    async getFileStream(filePath, range) {
        const cleanPath = filePath.replace(/^\//, '');
        const buffer = await this._readFile(cleanPath);

        const { Readable } = require('stream');
        const CHUNK_SIZE = 256 * 1024;
        // range 时只发送切片段：stream 从切片 buffer 开头读，读完整段即 range 内容
        const slice = range ? buffer.slice(range.start, range.end + 1) : buffer;
        let offset = 0;
        let bufferRef = slice;
        let consumed = false;

        const stream = new Readable({
            read() {
                if (!bufferRef || consumed) {
                    this.push(null);
                    return;
                }
                if (offset >= bufferRef.length) {
                    consumed = true;
                    bufferRef = null;
                    this.push(null);
                    return;
                }
                const end = Math.min(offset + CHUNK_SIZE, bufferRef.length);
                const chunk = Buffer.from(bufferRef.slice(offset, end));
                offset = end;
                this.push(chunk);

                if (offset >= bufferRef.length) {
                    consumed = true;
                    bufferRef = null;
                }
            }
        });

        const cleanup = () => {
            if (!consumed) {
                consumed = true;
            }
            bufferRef = null;
        };

        stream.on('end', cleanup);
        stream.on('close', cleanup);
        stream.on('error', cleanup);

        if (range) {
            return {
                stream,
                statusCode: 206,
                headers: {
                    'Content-Length': String(range.end - range.start + 1),
                    'Content-Range': `bytes ${range.start}-${range.end}/${buffer.length}`,
                    'Accept-Ranges': 'bytes'
                }
            };
        }
        return {
            stream,
            statusCode: 200,
            headers: {
                'Content-Length': String(buffer.length),
                'Accept-Ranges': 'bytes'
            }
        };
    }

    getPublicUrl(filePath) {
        const localIP = this.getLocalIP();
        const port = this.getPort();
        const protocol = this.isHttps() ? 'https' : 'http';
        const cleanPath = filePath.replace(/^\//, '');
        return `${protocol}://${localIP}:${port}/api/media-libraries/${this.config.id}/proxy/${encodeURIComponent(cleanPath)}`;
    }

    _readdir(dirPath) {
        return new Promise((resolve, reject) => {
            const path = dirPath || '';
            this.smbClient.readdir(path, (err, files) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const items = files.map(name => ({
                    name: name,
                    isDirectory: !name.includes('.')
                }));
                
                resolve(items);
            });
        });
    }

    _stat(filePath) {
        return new Promise((resolve, reject) => {
            this.smbClient.stat(filePath, (err, stat) => {
                if (err) {
                    resolve({ size: 0, modifiedTime: null });
                    return;
                }
                resolve(stat);
            });
        });
    }

    _readFile(filePath) {
        return new Promise((resolve, reject) => {
            this.smbClient.readFile(filePath, (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(data);
            });
        });
    }
}

class MediaLibraryManager {
    constructor(options = {}) {
        this.libraries = new Map();
        this.defaultLibraryId = null;
        this.configPath = options.configPath || path.join(__dirname, '../config/media-libraries.json');
        this.getPort = options.getPort || (() => 8081);
        this.getLocalIP = options.getLocalIP || (() => 'localhost');
        this.isHttps = options.isHttps || (() => false);
    }

    async init() {
        const config = this._loadConfig();
        
        for (const libConfig of config.libraries || []) {
            try {
                await this.addLibrary(libConfig);
                if (libConfig.isDefault) {
                    this.defaultLibraryId = libConfig.id;
                }
            } catch (err) {
                console.error(`初始化媒体库 ${libConfig.id} 失败:`, err.message);
            }
        }
    }

    async addLibrary(config) {
        let provider;
        
        switch (config.type) {
            case 'local':
                provider = new LocalProvider(config, {
                    getPort: this.getPort,
                    getLocalIP: this.getLocalIP,
                    isHttps: this.isHttps
                });
                break;
            case 'http':
            case 'https':
                provider = new HttpProvider(config, {
                    getPort: this.getPort,
                    getLocalIP: this.getLocalIP,
                    isHttps: this.isHttps
                });
                break;
            case 'smb':
                provider = new SmbProvider(config, {
                    getPort: this.getPort,
                    getLocalIP: this.getLocalIP,
                    isHttps: this.isHttps
                });
                break;
            default:
                throw new Error(`不支持的媒体库类型: ${config.type}`);
        }
        
        await provider.connect();
        
        this.libraries.set(config.id, {
            config: config,
            provider: provider
        });
        
        return config.id;
    }

    async removeLibrary(id) {
        const library = this.libraries.get(id);
        
        if (library) {
            await library.provider.disconnect();
            this.libraries.delete(id);
            
            if (this.defaultLibraryId === id) {
                this.defaultLibraryId = this.libraries.size > 0 
                    ? this.libraries.keys().next().value 
                    : null;
            }
        }
        
        return true;
    }

    getLibrary(id) {
        return this.libraries.get(id);
    }

    getDefaultLibrary() {
        return this.libraries.get(this.defaultLibraryId);
    }

    getDefaultLibraryId() {
        return this.defaultLibraryId;
    }

    setDefault(id) {
        if (!this.libraries.has(id)) {
            throw new Error('媒体库不存在');
        }
        this.defaultLibraryId = id;
        this.saveConfig();
        return true;
    }

    listLibraries() {
        const list = [];
        
        this.libraries.forEach((lib, id) => {
            list.push({
                id: id,
                name: lib.config.name,
                type: lib.config.type,
                isDefault: id === this.defaultLibraryId,
                readonly: lib.config.readonly || false
            });
        });
        
        return list;
    }

    async list(libraryId, dirPath) {
        const library = this.libraries.get(libraryId);
        
        if (!library) {
            throw new Error('媒体库不存在');
        }
        
        return library.provider.list(dirPath);
    }

    async upload(libraryId, dirPath, file) {
        const library = this.libraries.get(libraryId);
        
        if (!library) {
            throw new Error('媒体库不存在');
        }
        
        if (library.config.readonly) {
            throw new Error('只读媒体库');
        }
        
        return library.provider.uploadFile(dirPath, file);
    }

    async delete(libraryId, filePath) {
        const library = this.libraries.get(libraryId);
        
        if (!library) {
            throw new Error('媒体库不存在');
        }
        
        if (library.config.readonly) {
            throw new Error('只读媒体库');
        }
        
        return library.provider.deleteFile(filePath);
    }

    async createFolder(libraryId, dirPath, name) {
        const library = this.libraries.get(libraryId);
        
        if (!library) {
            throw new Error('媒体库不存在');
        }
        
        if (library.config.readonly) {
            throw new Error('只读媒体库');
        }
        
        return library.provider.createFolder(dirPath, name);
    }

    async deleteFolder(libraryId, folderPath) {
        const library = this.libraries.get(libraryId);
        
        if (!library) {
            throw new Error('媒体库不存在');
        }
        
        if (library.config.readonly) {
            throw new Error('只读媒体库');
        }
        
        return library.provider.deleteFolder(folderPath);
    }

    async getFile(libraryId, filePath) {
        const library = this.libraries.get(libraryId);

        if (!library) {
            throw new Error('媒体库不存在');
        }

        return library.provider.getFile(filePath);
    }

    async getFileStream(libraryId, filePath, range) {
        const library = this.libraries.get(libraryId);

        if (!library) {
            throw new Error('媒体库不存在');
        }

        return library.provider.getFileStream(filePath, range);
    }

    _loadConfig() {
        if (fs.existsSync(this.configPath)) {
            try {
                const content = fs.readFileSync(this.configPath, 'utf-8');
                return JSON.parse(content);
            } catch (err) {
                console.error('加载媒体库配置失败:', err.message);
                return { libraries: [] };
            }
        }
        return { libraries: [] };
    }

    saveConfig() {
        const config = {
            libraries: []
        };
        
        this.libraries.forEach((lib, id) => {
            const libConfig = {
                id: lib.config.id,
                name: lib.config.name,
                type: lib.config.type,
                isDefault: id === this.defaultLibraryId,
                readonly: lib.config.readonly || false
            };
            
            if (lib.config.type === 'http') {
                libConfig.url = lib.config.url;
                libConfig.username = lib.config.username;
                libConfig.password = lib.config.password;
            } else if (lib.config.type === 'smb') {
                libConfig.server = lib.config.server;
                libConfig.share = lib.config.share;
                libConfig.domain = lib.config.domain;
                libConfig.username = lib.config.username;
                libConfig.password = lib.config.password;
            } else {
                libConfig.path = lib.config.path;
            }
            
            config.libraries.push(libConfig);
        });
        
        const dir = path.dirname(this.configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    }

    async addLibraryFromConfig(configData) {
        const config = {
            id: configData.id || `lib_${Date.now()}`,
            name: configData.name,
            type: configData.type || 'local',
            readonly: configData.readonly || false
        };
        
        if (configData.type === 'http') {
            config.url = configData.url;
            config.username = configData.username;
            config.password = configData.password;
        } else if (configData.type === 'smb') {
            config.server = configData.server;
            config.share = configData.share;
            config.domain = configData.domain;
            config.username = configData.username;
            config.password = configData.password;
        } else {
            config.path = configData.path;
        }
        
        await this.addLibrary(config);
        this.saveConfig();
        
        return config;
    }

    updateLibraryConfig(id, updates) {
        const library = this.libraries.get(id);
        
        if (!library) {
            throw new Error('媒体库不存在');
        }
        
        Object.assign(library.config, updates);
        this.saveConfig();
        
        return library.config;
    }
    
    getLocalLibraryRoutes() {
        const routes = [];
        
        this.libraries.forEach((lib, id) => {
            if (lib.provider instanceof LocalProvider && !lib.provider.isUploadsDir) {
                routes.push({
                    id: id,
                    routePrefix: lib.provider.getRoutePrefix(),
                    basePath: lib.provider.getBasePath()
                });
            }
        });
        
        return routes;
    }
}

module.exports = {
    MediaLibraryProvider,
    LocalProvider,
    HttpProvider,
    SmbProvider,
    MediaLibraryManager
};
