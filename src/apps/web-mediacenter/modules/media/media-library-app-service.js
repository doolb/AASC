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
        return 'image';
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
                    const stat = fs.lstatSync(itemPath);
                    
                    if (stat.isSymbolicLink()) {
                        try {
                            fs.statSync(itemPath);
                        } catch (e) {
                            return null;
                        }
                    }
                    
                    const relativePath = path.join(dirPath, name).replace(/\\/g, '/');
                    
                    return {
                        name: name,
                        path: relativePath,
                        type: stat.isDirectory() ? 'folder' : 'file',
                        mediaType: stat.isDirectory() ? 'folder' : this.detectMediaType(name),
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
        
        return {
            name: path.basename(filePath),
            path: filePath,
            type: 'file',
            mediaType: this.detectMediaType(filePath),
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

    async getFileStream(filePath) {
        const fullPath = this._resolvePath(filePath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error('文件不存在');
        }
        
        return fs.createReadStream(fullPath);
    }

    getPublicUrl(filePath) {
        const localIP = this.getLocalIP();
        const port = this.getPort();
        const protocol = this.isHttps() ? 'https' : 'http';
        const cleanPath = filePath.replace(/^\//, '');
        if (this.isUploadsDir) {
            return `${protocol}://${localIP}:${port}/uploads/${encodeURIComponent(cleanPath)}`;
        }
        return `${protocol}://${localIP}:${port}${this.routePrefix}/${encodeURIComponent(cleanPath)}`;
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
        this.getPort = options.getPort || (() => 8081);
        this.getLocalIP = options.getLocalIP || (() => 'localhost');
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
        const url = this._buildUrl(filePath);
        
        return {
            name: path.basename(filePath),
            path: filePath,
            type: 'file',
            mediaType: this.detectMediaType(filePath),
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

    async getFileStream(filePath) {
        const url = this._buildUrl(filePath);
        const client = url.startsWith('https') ? https : http;
        
        return new Promise((resolve, reject) => {
            const req = client.get(url, {
                auth: this.username && this.password 
                    ? `${this.username}:${this.password}` 
                    : undefined
            }, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP错误: ${res.statusCode}`));
                    return;
                }
                resolve(res);
            });
            
            req.on('error', reject);
        });
    }

    getPublicUrl(filePath) {
        return this._buildUrl(filePath).replace(/\/$/, '');
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
        
        this.cache.set(cacheKey, { data: items, time: Date.now() });
        
        return items;
    }

    _buildUrl(dirPath) {
        const baseUrl = this.baseUrl.replace(/\/$/, '');
        const cleanPath = dirPath.replace(/^\//, '');
        return cleanPath ? `${baseUrl}/${cleanPath}/` : `${baseUrl}/`;
    }

    async _fetchHtml(url) {
        const client = url.startsWith('https') ? https : http;
        
        return new Promise((resolve, reject) => {
            const req = client.get(url, {
                auth: this.username && this.password 
                    ? `${this.username}:${this.password}` 
                    : undefined
            }, (res) => {
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
        });
    }

    _parseHtml(html, dirPath) {
        const items = [];
        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
        let match;
        
        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1];
            const name = match[2].trim();
            
            if (name === '..' || name === '../' || name === '.') continue;
            
            const isFolder = href.endsWith('/');
            const cleanName = name.replace(/\/$/, '');
            
            if (cleanName) {
                const itemPath = dirPath === '/' 
                    ? '/' + cleanName 
                    : dirPath + '/' + cleanName;
                
                items.push({
                    name: cleanName,
                    path: itemPath,
                    type: isFolder ? 'folder' : 'file',
                    mediaType: isFolder ? 'folder' : this.detectMediaType(cleanName),
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
            
            return {
                name: file.name,
                path: itemPath,
                type: file.isDirectory ? 'folder' : 'file',
                mediaType: file.isDirectory ? 'folder' : this.detectMediaType(file.name),
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
        
        return {
            name: path.basename(filePath),
            path: filePath,
            type: 'file',
            mediaType: this.detectMediaType(filePath),
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

    async getFileStream(filePath) {
        const cleanPath = filePath.replace(/^\//, '');
        const buffer = await this._readFile(cleanPath);
        
        const { Readable } = require('stream');
        const CHUNK_SIZE = 256 * 1024;
        let offset = 0;
        let bufferRef = buffer;
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
        
        return stream;
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

    async getFileStream(libraryId, filePath) {
        const library = this.libraries.get(libraryId);
        
        if (!library) {
            throw new Error('媒体库不存在');
        }
        
        return library.provider.getFileStream(filePath);
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
