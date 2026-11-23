'use strict';

const MEDIA_TYPES = ['image', 'video', 'gif', 'html', 'audio', 'text'];
const MEDIA_TYPE_ALIAS_MAP = {
    image: ['image', 'gif'],
    gif: ['gif'],
    video: ['video'],
    audio: ['audio'],
    text: ['text'],
    web: ['html'],
    html: ['html']
};

class PlaylistManager {
    constructor(mediaLibraryManager) {
        this.manager = mediaLibraryManager;
    }

    // 统一在服务端规范化媒体类型，确保媒体库与临时文件两条路径使用同一套筛选语义。
    // 兼容旧控制端：未传、空数组或全部未知值时都回退为“全部类型”。
    _normalizeMediaTypes(mediaTypes) {
        if (!Array.isArray(mediaTypes) || mediaTypes.length === 0) {
            return new Set(MEDIA_TYPES);
        }

        const normalized = new Set();
        mediaTypes.forEach((mediaType) => {
            const typeKey = String(mediaType || '').trim().toLowerCase();
            const mappedTypes = MEDIA_TYPE_ALIAS_MAP[typeKey] || [];
            mappedTypes.forEach((mappedType) => normalized.add(mappedType));
        });

        if (normalized.size === 0) {
            return new Set(MEDIA_TYPES);
        }

        return normalized;
    }

    // 按模式排序或洗牌
    _sortPlaylist(items, mode, sortBy, direction) {
        if (mode === 'random') {
            return this._shuffle(items);
        }
        const dir = direction === 'desc' ? -1 : 1;
        return [...items].sort((a, b) => {
            let cmp;
            if (sortBy === 'time') {
                cmp = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
            } else {
                cmp = String(a.name).localeCompare(String(b.name));
            }
            return cmp * dir;
        });
    }

    // Fisher-Yates 洗牌
    _shuffle(arr) {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    // 从媒体库文件夹构建播放列表（递归或单层）
    async buildFromLibrary(libraryId, path, options = {}) {
        const { recursive = false, mode = 'sequence', sortBy = 'name', direction = 'asc', mediaTypes } = options;
        const allowedMediaTypes = this._normalizeMediaTypes(mediaTypes);
        const all = [];
        const queue = [path || '/'];
        while (queue.length > 0) {
            const dir = queue.shift();
            const items = await this.manager.list(libraryId, dir);
            for (const item of items) {
                if (item.type === 'folder') {
                    if (recursive) queue.push(item.path);
                } else if (MEDIA_TYPES.includes(item.mediaType) && allowedMediaTypes.has(item.mediaType)) {
                    all.push(item);
                }
            }
        }
        const sorted = this._sortPlaylist(all, mode, sortBy, direction);
        return sorted.map(item => ({
            url: item.url,
            // 保留原始媒体路径，主服务器聚合远程播放列表时用它生成代理回退地址。
            path: item.path,
            fileName: item.name,
            mediaType: item.mediaType,
            ...(item.mediaType === 'text' ? { format: item.format } : {})
        }));
    }

    // 深度优先遍历，每次只读取到下一个包含媒体的目录。
    createDirectoryCursor(libraryId, root, options = {}) {
        return { libraryId, root: root || '/', stack: [root || '/'], recursive: !!options.recursive,
            loop: !!options.loop, mode: options.mode, sortBy: options.sortBy,
            direction: options.direction, mediaTypes: options.mediaTypes, hadItems: false };
    }

    async nextDirectoryBatch(cursor, listDirectory = (id, dir) => this.manager.list(id, dir)) {
        const next = { ...cursor, stack: [...cursor.stack] };
        // 每次调用最多跨越一次轮次边界，避免空目录树在循环模式下无限扫描。
        let restarted = false;
        while (true) {
            if (!next.stack.length) {
                if (!next.loop || !next.hadItems || restarted) return { playlist: [], cursor: next };
                next.stack = [next.root];
                next.hadItems = false;
                restarted = true;
            }
            const dir = next.stack.pop();
            let items;
            try { items = await listDirectory(next.libraryId, dir); }
            catch (error) {
                // 分享中已移除的目录可以跳过；认证或网络错误必须上报并保留重试位置。
                if (/夸克分享目录不存在/.test(error.message)) continue;
                throw error;
            }
            if (next.recursive) {
                const folders = items.filter(item => item.type === 'folder').sort((a, b) => String(a.name).localeCompare(String(b.name)));
                if (next.direction === 'desc') folders.reverse();
                for (const folder of folders.reverse()) next.stack.push(folder.path);
            }
            const allowed = this._normalizeMediaTypes(next.mediaTypes);
            const files = items.filter(item => item.type !== 'folder' && MEDIA_TYPES.includes(item.mediaType) && allowed.has(item.mediaType));
            if (!files.length) continue;
            next.hadItems = true;
            const playlist = this._sortPlaylist(files, next.mode, next.sortBy, next.direction).map(item => ({
                url: item.url, path: item.path, fileName: item.name, mediaType: item.mediaType,
                ...(item.mediaType === 'text' ? { format: item.format } : {})
            }));
            return { playlist, cursor: next };
        }
    }

    // URL 列表直接下发给显示端，按调用方提供的顺序播放，不读取媒体内容。
    buildFromUrls(items) {
        if (!Array.isArray(items) || !items.length || items.length > 10000) throw new Error('URL 列表数量须为 1 至 10000 项');
        return items.map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.url !== 'string' || item.url.length > 16384) throw new Error(`第 ${index + 1} 项地址无效`);
            let url;
            try { url = new URL(item.url); } catch { throw new Error(`第 ${index + 1} 项地址无效`); }
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`第 ${index + 1} 项地址无效`);
            if (!MEDIA_TYPES.includes(item.mediaType)) throw new Error(`第 ${index + 1} 项媒体类型无效`);
            if (item.mediaType === 'text' && item.format !== undefined && !['plain', 'markdown'].includes(item.format)) throw new Error(`第 ${index + 1} 项文本格式无效`);
            if (item.fileName !== undefined && typeof item.fileName !== 'string') throw new Error(`第 ${index + 1} 项文件名无效`);
            return { url: url.href, fileName: (item.fileName || `媒体 ${index + 1}`).trim().slice(0, 200) || `媒体 ${index + 1}`, mediaType: item.mediaType, ...(item.mediaType === 'text' && item.format ? { format: item.format } : {}) };
        });
    }

    // 从控制端上传的 base64 文件构建播放列表
    buildFromTemp(files, options = {}) {
        const { mode = 'sequence', sortBy = 'name', direction = 'asc', mediaTypes } = options;
        const allowedMediaTypes = this._normalizeMediaTypes(mediaTypes);
        const filteredFiles = (files || []).filter((file) => {
            const mediaType = file.mediaType || 'image';
            return MEDIA_TYPES.includes(mediaType) && allowedMediaTypes.has(mediaType);
        });
        const sorted = this._sortPlaylist(filteredFiles, mode, sortBy, direction);
        return sorted.map(f => {
            const mediaType = f.mediaType || 'image';
            return {
                data: f.data,
                fileName: f.name,
                mediaType,
                mimeType: f.mimeType,
                tempPreviewKey: f.tempPreviewKey,
                width: f.width,
                height: f.height,
                ...(mediaType === 'text' ? { format: f.format } : {})
            };
        });
    }
}

module.exports = { PlaylistManager };
