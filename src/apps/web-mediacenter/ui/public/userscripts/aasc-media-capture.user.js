// ==UserScript==
// @name         AASC 媒体采集
// @namespace    aasc
// @version      1.0.0
// @description  预览当前页面可发现的媒体并保存到 AASC 用户文件
// @match        http://*/*
// @match        https://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==
(function () {
    'use strict';
    function configure() {
        const server = prompt('AASC 服务地址，例如 http://192.168.1.10:8081', GM_getValue('server', ''));
        if (server === null) return;
        let parsed;
        try { parsed = new URL(server); } catch { alert('服务地址无效'); return; }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) { alert('服务地址无效'); return; }
        const token = prompt('粘贴 AASC 用户文件页中的油猴采集凭据', GM_getValue('token', ''));
        if (token === null) return;
        if (!/^[a-f0-9]{64}$/.test(token)) { alert('采集凭据无效'); return; }
        GM_setValue('server', parsed.origin);
        GM_setValue('token', token);
        alert('AASC 采集设置已保存');
    }
    function scan() {
        const values = [];
        const add = (value, title, mediaType) => {
            if (typeof value !== 'string' || !value.trim()) return;
            try {
                const url = new URL(value, location.href);
                if (!['http:', 'https:'].includes(url.protocol) || values.some(item => item.url === url.href)) return;
                values.push({ url: url.href, title: String(title || '').slice(0, 100), mediaType: mediaType || 'video' });
            } catch { /* 忽略 blob 和不完整地址。 */ }
        };
        for (const element of document.querySelectorAll('video, audio, video source, audio source')) {
            const mediaType = element.closest('audio') ? 'audio' : 'video';
            add(element.currentSrc || element.src, element.title || element.getAttribute('aria-label'), mediaType);
        }
        for (const element of document.querySelectorAll('img')) {
            if ((element.naturalWidth || element.width || 0) < 200 && (element.naturalHeight || element.height || 0) < 200) continue;
            add(element.currentSrc || element.src, element.alt || element.title, 'image');
        }
        for (const entry of performance.getEntriesByType('resource')) if (/\.(?:mp4|webm|mp3|m4a|m3u8)(?:[?#]|$)/i.test(entry.name)) add(entry.name, '', /\.(?:mp3|m4a)(?:[?#]|$)/i.test(entry.name) ? 'audio' : 'video');
        // 结构化数据中有时提供标题和内容地址；只读取当前文档，不主动爬取其他页面。
        const walk = (value, depth = 0) => {
            if (!value || typeof value !== 'object' || depth > 30) return;
            if (typeof value.contentUrl === 'string') add(value.contentUrl, value.name, 'video');
            for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, depth + 1);
        };
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try { if (script.textContent.length < 1024 * 1024) walk(JSON.parse(script.textContent)); } catch { /* 页面数据无效时跳过。 */ }
        }
        return values.slice(0, 200);
    }
    function capture() {
        const server = GM_getValue('server', ''); const token = GM_getValue('token', '');
        if (!server || !token) { configure(); return; }
        const candidates = scan();
        if (!candidates.length) { alert('未发现可保存的媒体地址；请先开始播放后重试。'); return; }
        const selected = prompt('输入要保存的序号，使用逗号分隔；留空保存全部：\n' + candidates.map((item, index) => `${index + 1}. ${item.title || item.url.slice(0, 150)}`).join('\n'), '');
        if (selected === null) return;
        const indexes = selected.trim() ? [...new Set(selected.split(/[,，\s]+/).map(value => Number(value) - 1))] : candidates.map((_, index) => index);
        if (indexes.some(index => !Number.isInteger(index) || !candidates[index]) || !indexes.length) { alert('选择的序号无效'); return; }
        const detected = document.querySelector('meta[property="og:title"]')?.content || document.title || '未命名内容';
        const content = prompt('内容名称', detected); if (content === null) return;
        const playlist = document.querySelector('[data-playlist-title]')?.getAttribute('data-playlist-title') || detected;
        const title = prompt('播放列表名称', playlist); if (title === null) return;
        const items = indexes.map((index, order) => ({ ...candidates[index], title: candidates[index].title || `第 ${order + 1} 项` }));
        GM_xmlhttpRequest({ method: 'POST', url: `${server}/api/user-media/capture`, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: JSON.stringify({ sourceUrl: location.href, content, title, items }), timeout: 30000,
            onload(response) { try { const result = JSON.parse(response.responseText); alert(response.status === 200 ? `已保存 ${result.count} 个媒体` : (result.message || '保存失败')); } catch { alert('服务器响应无效'); } },
            onerror() { alert('无法连接 AASC'); }, ontimeout() { alert('AASC 请求超时'); } });
    }
    GM_registerMenuCommand('AASC：配置服务地址和凭据', configure);
    GM_registerMenuCommand('AASC：采集当前页面媒体', capture);
})();
