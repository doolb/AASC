'use strict';
const { randomUUID } = require('crypto');
const KEY = 'media.shareFolders';
const TYPES = new Set(['quark', 'bilibili']);

/** 文件夹只保存分类关系，源链接仍由各自的媒体库和视频列表管理。 */
function createShareFoldersService({ config, broadcast }) {
    function state() {
        const raw = config.get(KEY, {}) || {};
        const result = {};
        for (const type of TYPES) {
            const source = raw[type] || {};
            const folders = Array.isArray(source.folders) ? source.folders.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string').slice(0, 100) : [];
            const ids = new Set(folders.map(x => x.id));
            const entries = Object.fromEntries(Object.entries(source.entries || {}).filter(([key, id]) => key.length <= 2048 && ids.has(id)).slice(0, 2000));
            result[type] = { folders, entries };
        }
        return result;
    }
    function snapshot() { return { type: 'shareFolders', folders: state(), quarkCookieConfigured: Boolean(config.get('media.quarkCookie', '') || process.env.KUAKE_COOKIE || (process.env.KUAKE_PUS && process.env.KUAKE_PUUS)), bilibiliCookieConfigured: Boolean(config.get('media.bilibiliCookie', '') || process.env.BILIBILI_COOKIE) }; }
    return {
        handle(ws, data) {
            if (data.type === 'shareFoldersGet') { ws.send(JSON.stringify(snapshot())); return; }
            try {
                if (['quarkCookieSet', 'bilibiliCookieSet'].includes(data.type)) {
                    const cookie = String(data.cookie || '').trim();
                    if (cookie.length > 16384 || /[\r\n]/.test(cookie)) throw new Error('Cookie 格式无效');
                    if (config.set(data.type === 'quarkCookieSet' ? 'media.quarkCookie' : 'media.bilibiliCookie', cookie) === false) throw new Error('Cookie 保存失败');
                    broadcast(snapshot());
                    return;
                }
                if (!TYPES.has(data.category)) throw new Error('文件夹类型无效');
                const all = state();
                const group = all[data.category];
                if (data.type === 'shareFolderCreate') {
                    const name = String(data.name || '').trim();
                    if (!name || name.length > 60 || /[\x00-\x1f]/.test(name)) throw new Error('请输入不超过 60 字的文件夹名称');
                    if (group.folders.some(folder => folder.name === name)) throw new Error('文件夹名称已存在');
                    if (group.folders.length >= 100) throw new Error('文件夹数量已达上限');
                    group.folders.push({ id: randomUUID(), name });
                } else if (data.type === 'shareFolderMove') {
                    const key = String(data.key || '');
                    const id = String(data.folderId || '');
                    if (!key || key.length > 2048 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('链接标识无效');
                    if (id && !Object.hasOwn(group.entries, key) && Object.keys(group.entries).length >= 2000) throw new Error('分类链接数量已达上限');
                    if (id && !group.folders.some(folder => folder.id === id)) throw new Error('文件夹不存在');
                    if (id) group.entries[key] = id; else delete group.entries[key];
                } else if (data.type === 'shareFolderDelete') {
                    const id = String(data.folderId || '');
                    if (!group.folders.some(folder => folder.id === id)) throw new Error('文件夹不存在');
                    if (Object.values(group.entries).includes(id)) throw new Error('请先移出文件夹内的链接');
                    group.folders = group.folders.filter(folder => folder.id !== id);
                } else return;
                if (config.set(KEY, all) === false) throw new Error('文件夹保存失败');
                broadcast(snapshot());
            } catch (error) { ws.send(JSON.stringify({ type: 'shareFoldersError', message: error.message })); }
        }
    };
}
module.exports = { createShareFoldersService };
