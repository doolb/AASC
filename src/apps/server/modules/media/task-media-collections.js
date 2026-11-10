'use strict';

const { randomUUID } = require('node:crypto');
const KEY = 'media.taskMediaCollections';
const SOURCE = /^[a-z][a-z0-9._-]{1,63}$/;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

// 每个来源独立保存收藏和文件夹；所有变更一次写入并广播权威结果。
function createTaskMediaCollections({ config, broadcast }) {
    function state() {
        const raw = config.get(KEY, {});
        const result = {};
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
        for (const [sourceId, group] of Object.entries(raw).slice(0, 100)) {
            if (!SOURCE.test(sourceId) || BLOCKED.has(sourceId) || !group || typeof group !== 'object') continue;
            const folders = (Array.isArray(group.folders) ? group.folders : []).filter(item => item && typeof item.id === 'string' && typeof item.name === 'string').slice(0, 100);
            const ids = new Set(folders.map(folder => folder.id));
            const items = (Array.isArray(group.items) ? group.items : []).filter(item => item && typeof item.url === 'string' && typeof item.title === 'string').slice(0, 500).map(item => ({
                url: item.url, title: item.title, folderId: ids.has(item.folderId) ? item.folderId : ''
            }));
            result[sourceId] = { folders, items };
        }
        return result;
    }
    function snapshot() { return { type: 'taskMediaCollections', sources: state() }; }
    function handle(ws, data) {
        if (data.type === 'taskMediaCollectionsGet') { ws.send(JSON.stringify(snapshot())); return; }
        try {
            const sourceId = typeof data.sourceId === 'string' ? data.sourceId : '';
            if (!SOURCE.test(sourceId) || BLOCKED.has(sourceId)) throw new Error('媒体源标识不合法');
            const all = state();
            if (!Object.hasOwn(all, sourceId) && Object.keys(all).length >= 100) throw new Error('媒体源数量已达上限');
            const group = all[sourceId] || { folders: [], items: [] };
            all[sourceId] = group;
            const folderId = typeof data.folderId === 'string' ? data.folderId : '';
            const validFolder = !folderId || group.folders.some(folder => folder.id === folderId);
            if (data.type === 'taskMediaFolderCreate') {
                const name = typeof data.name === 'string' ? data.name.trim() : '';
                if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('请输入不超过 60 字的文件夹名称');
                if (group.folders.some(folder => folder.name === name)) throw new Error('文件夹名称已存在');
                if (group.folders.length >= 100) throw new Error('文件夹数量已达上限');
                group.folders.push({ id: randomUUID(), name });
            } else if (data.type === 'taskMediaFolderDelete') {
                if (!folderId || !validFolder) throw new Error('文件夹不存在');
                if (group.items.some(item => item.folderId === folderId)) throw new Error('请先移出文件夹内的链接');
                group.folders = group.folders.filter(folder => folder.id !== folderId);
            } else if (['taskMediaAdd', 'taskMediaMove', 'taskMediaRemove'].includes(data.type)) {
                const url = typeof data.url === 'string' ? data.url.trim() : '';
                if (!url || url.length > 2048 || /[\x00-\x1f\x7f]/.test(url)) throw new Error('链接或标识无效');
                if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
                    let parsed;
                    try { parsed = new URL(url); } catch { throw new Error('链接或标识无效'); }
                    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('链接或标识无效');
                    if ([...parsed.searchParams.keys()].some(key => /^(cookie|password|passwd|token|access_token|api_key|apikey)$/i.test(key))) throw new Error('链接不得包含凭据');
                }
                const existing = group.items.find(item => item.url === url);
                if (data.type === 'taskMediaRemove') group.items = group.items.filter(item => item.url !== url);
                if (data.type === 'taskMediaMove') {
                    if (!validFolder || !existing) throw new Error('链接或文件夹不存在');
                    existing.folderId = folderId;
                }
                if (data.type === 'taskMediaAdd') {
                    if (!validFolder) throw new Error('文件夹不存在');
                    const title = typeof data.title === 'string' ? data.title.trim().slice(0, 200) : '';
                    if (/[\x00-\x1f\x7f]/.test(title)) throw new Error('名称无效');
                    if (!existing && group.items.length >= 500) throw new Error('来源链接数量已达上限');
                    if (existing) { existing.folderId = folderId; existing.title = title || existing.title; }
                    else group.items.push({ url, title: title || url, folderId });
                }
            } else return;
            if (config.set(KEY, all) === false) throw new Error('媒体分类保存失败');
            broadcast(snapshot());
            if (data.type === 'taskMediaAdd' && typeof data.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(data.requestId)) ws.send(JSON.stringify({ type: 'taskMediaAddResult', requestId: data.requestId, status: 'success' }));
        } catch (error) {
            if (data.type === 'taskMediaAdd' && typeof data.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(data.requestId)) ws.send(JSON.stringify({ type: 'taskMediaAddResult', requestId: data.requestId, status: 'error', message: error.message }));
            else ws.send(JSON.stringify({ type: 'taskMediaCollectionsError', message: error.message }));
        }
    }
    return { handle, snapshot };
}
module.exports = { createTaskMediaCollections };
