'use strict';

const REMOTE_MEDIA_LIBRARY_COMMANDS = new Set([
    'media.library.add',
    'media.library.update',
    'media.library.remove',
    'media.library.delete-file',
    'media.library.create-folder',
    'media.library.delete-folder',
    'media.library.set-default',
    'media.library.playlist'
]);

/**
 * 创建子服务器侧的媒体库命令处理器。
 *
 * 该模块只编排媒体库管理器，不直接依赖 Express 或 WebSocket，便于主服务
 * 和测试分别验证节点命令与本地媒体库之间的边界。媒体库配置中的密码只
 * 传给目标节点的管理器，响应摘要会主动移除敏感字段。
 */
function createRemoteMediaLibraryHandlers(options = {}) {
    const {
        mediaLibraryManager,
        registerLocalRoutes = async () => {},
        buildPlaylist = null
    } = options;

    if (!mediaLibraryManager) {
        throw new TypeError('mediaLibraryManager 必须提供');
    }

    const handlers = new Map();
    handlers.set('media.library.add', async payload => {
        const library = await mediaLibraryManager.addLibraryFromConfig(normalizeConfig(payload));
        await registerLocalRoutes(library);
        return { library: sanitizeLibrary(library) };
    });
    handlers.set('media.library.update', async payload => {
        const library = mediaLibraryManager.updateLibraryConfig(payload.id, {
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.readonly !== undefined ? { readonly: payload.readonly } : {})
        });
        if (payload.isDefault === true) {
            mediaLibraryManager.setDefault(payload.id);
        }
        return { library: sanitizeLibrary(library) };
    });
    handlers.set('media.library.remove', async payload => {
        await mediaLibraryManager.removeLibrary(payload.id);
        mediaLibraryManager.saveConfig();
        return { removed: true, id: payload.id };
    });
    handlers.set('media.library.delete-file', async payload => {
        await mediaLibraryManager.delete(payload.id, payload.path);
        return { deleted: true, id: payload.id, path: payload.path };
    });
    handlers.set('media.library.create-folder', async payload => {
        const folder = await mediaLibraryManager.createFolder(payload.id, payload.path || '/', payload.name);
        return { folder };
    });
    handlers.set('media.library.delete-folder', async payload => {
        await mediaLibraryManager.deleteFolder(payload.id, payload.path);
        return { deleted: true, id: payload.id, path: payload.path };
    });
    handlers.set('media.library.set-default', async payload => {
        mediaLibraryManager.setDefault(payload.id);
        return { id: payload.id, isDefault: true };
    });
    handlers.set('media.library.playlist', async payload => {
        if (typeof buildPlaylist !== 'function') {
            throw new Error('子服务器未配置媒体库播放列表能力');
        }
        const playlist = await buildPlaylist(payload);
        return { playlist: Array.isArray(playlist) ? playlist : [] };
    });
    return handlers;
}

/**
 * 主服务器侧的远程命令入口，只允许明确登记过的媒体库命令。
 */
async function requestRemoteMediaLibrary(options = {}) {
    const {
        registry,
        nodeId,
        command,
        payload = {},
        timeoutMs
    } = options;

    if (!REMOTE_MEDIA_LIBRARY_COMMANDS.has(command)) {
        throw new Error(`不支持的远程媒体库命令: ${command}`);
    }
    if (!registry || typeof registry.request !== 'function') {
        throw new TypeError('registry 必须提供 request 方法');
    }

    const node = typeof registry.get === 'function' ? registry.get(nodeId) : null;
    if (!node || node.nodeId === 'main-server' || node.status !== 'online' || node.connected === false) {
        throw new Error(`AASC 子服务器不可用: ${nodeId}`);
    }
    if (typeof registry.getConnection === 'function' && !registry.getConnection(nodeId)) {
        throw new Error(`AASC 子服务器连接不可用: ${nodeId}`);
    }

    return registry.request(nodeId, command, payload, timeoutMs);
}

function buildRemoteMediaProxyPath(nodeId, libraryId, filePath) {
    const cleanPath = String(filePath || '').replace(/^\/+/, '');
    const encodedPath = cleanPath
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
    const prefix = `/api/aasc/servers/${encodeURIComponent(String(nodeId))}/media-libraries/${encodeURIComponent(String(libraryId))}/proxy`;
    return encodedPath ? `${prefix}/${encodedPath}` : `${prefix}/`;
}

function normalizeConfig(payload = {}) {
    const fields = ['id', 'name', 'type', 'path', 'url', 'server', 'share', 'domain', 'username', 'password', 'readonly'];
    return fields.reduce((config, field) => {
        if (payload[field] !== undefined) {
            config[field] = payload[field];
        }
        return config;
    }, {});
}

function sanitizeLibrary(library = {}) {
    const source = library.config && typeof library.config === 'object'
        ? { ...library.config, id: library.config.id || library.id }
        : library;
    const safe = {};
    for (const field of ['id', 'name', 'type', 'path', 'url', 'server', 'share', 'domain', 'readonly', 'isDefault']) {
        if (source[field] !== undefined) {
            safe[field] = source[field];
        }
    }
    return safe;
}

module.exports = {
    REMOTE_MEDIA_LIBRARY_COMMANDS,
    createRemoteMediaLibraryHandlers,
    requestRemoteMediaLibrary,
    buildRemoteMediaProxyPath,
    sanitizeLibrary
};
