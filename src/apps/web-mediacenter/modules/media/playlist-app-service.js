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
            fileName: item.name,
            mediaType: item.mediaType,
            ...(item.mediaType === 'text' ? { format: item.format } : {})
        }));
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
                ...(mediaType === 'text' ? { format: f.format } : {})
            };
        });
    }
}

module.exports = { PlaylistManager };
