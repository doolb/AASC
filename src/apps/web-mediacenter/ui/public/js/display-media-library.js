(function () {
    'use strict';

    const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    let options = null;
    let directoryVersion = 0;
    let pendingRequestId = null;
    let pendingSingleRequestId = null;
    let currentBilibili = null, relatedVersion = 0, relatedEntries = [];
    const cancelledRequests = new Set();
    let state = { libraries: [], libraryId: '', path: '/', parent: '/', entries: [] };

    function byId(id) { return document.getElementById(id); }

    function isLocalHostname(hostname) {
        return LOCAL_HOSTS.has(String(hostname || '').toLowerCase());
    }

    function setStatus(text) {
        const node = byId('displayMediaLibraryStatus');
        if (node) node.textContent = text || '';
    }

    async function requestJson(url, init = {}) {
        const response = await fetch(url, { cache: 'no-store', ...init });
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (!response.ok) {
            const error = new Error(payload?.error || payload?.message || '媒体库加载失败，请稍后重试');
            error.code = payload?.code;
            error.status = response.status;
            throw error;
        }
        return payload || {};
    }

    function createButton(label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = onClick;
        return button;
    }

    // 同一汇总视图中的每个条目仍绑定原来源，避免同名目录或相同路径串库。
    function libraryFor(entry) {
        return state.libraries.find(item => item.id === (entry.libraryId || state.libraryId));
    }

    function createCover(entry, card) {
        const library = libraryFor(entry);
        const isVideo = entry.mediaType === 'video';
        const url = entry.cover || entry.proxyUrl || entry.directUrl;
        if (!url || (!entry.cover && !['image', 'video'].includes(entry.mediaType))) return;
        // 夸克视频没有可用封面时不额外请求整个远程视频。
        if (isVideo && !entry.cover && library?.type === 'quark') return;
        const media = document.createElement(isVideo && !entry.cover ? 'video' : 'img');
        media.className = 'display-media-card-cover';
        if (media.tagName === 'VIDEO') {
            media.preload = 'metadata'; media.muted = true; media.playsInline = true;
            // 首帧解码后略微前移，尽可能避开视频片头黑帧，不启动播放。
            media.addEventListener('loadeddata', () => {
                if (Number.isFinite(media.duration) && media.duration > 0.1 && media.currentTime === 0) media.currentTime = 0.1;
            }, { once: true });
        }
        else { media.loading = 'lazy'; media.alt = ''; media.referrerPolicy = 'no-referrer'; }
        const update = () => {
            const width = media.videoWidth || media.naturalWidth;
            const height = media.videoHeight || media.naturalHeight;
            if (width > 0 && height > 0) card.style.setProperty('--display-card-aspect', `${width} / ${height}`);
        };
        media.addEventListener(media.tagName === 'VIDEO' ? 'loadedmetadata' : 'load', update);
        media.addEventListener('error', () => { card.classList.remove('has-cover'); media.remove(); }, { once: true });
        media.src = url;
        card.classList.add('has-cover');
        card.append(media);
    }

    function createEntry(entry) {
        const card = document.createElement('div');
        card.className = 'display-media-library-entry';
        card.dataset.libraryId = entry.libraryId || state.libraryId;
        const library = libraryFor(entry);
        if (entry.type === 'directory') {
            card.classList.add('is-directory');
            const icon = document.createElement('div'); icon.className = 'display-media-library-icon'; icon.textContent = '📁'; card.append(icon);
        } else createCover(entry, card);
        const title = createButton(entry.name, () => {
            if (entry.type === 'directory') void enterDirectory(entry);
            else playEntry(entry);
        });
        title.className = 'display-media-library-entry-name';
        card.append(title);
        if (entry.type === 'directory') {
            const batch = createButton('批量播放', () => requestFolderPlayback(entry));
            batch.className = 'display-media-library-batch'; card.append(batch);
        }
        if (library?.type === 'bilibili' && entry.bvid) {
            card.classList.add('display-media-bilibili-row'); card.append(createBilibiliActions(entry));
        }
        return card;
    }

    function renderEntries() {
        const root = byId('displayMediaLibraryEntries');
        if (!root) return;
        root.replaceChildren();
        const path = byId('displayMediaLibraryPath');
        if (path) path.textContent = state.libraryId ? state.path : '全部媒体';
        const up = byId('displayMediaLibraryUp');
        if (up) up.disabled = !state.libraryId;
        const isBilibili = state.libraries.find(item => item.id === state.libraryId)?.type === 'bilibili';
        if (isBilibili) {
            const navigation = document.createElement('div'); navigation.className = 'display-media-bilibili-nav';
            navigation.append(createButton('首页', () => void openDirectory('/d:home')),
                createButton('已保存', () => void openDirectory('/')));
            root.append(navigation);
        }
        const fragment = document.createElement('div');
        fragment.className = 'display-media-card-grid';
        for (const entry of state.entries) fragment.append(createEntry(entry));
        if ((!state.libraryId || isBilibili) && currentBilibili && relatedEntries.length) {
            for (const [index, entry] of relatedEntries.entries()) {
                fragment.append(createEntry({ ...entry, libraryId: 'display-bilibili',
                    name: index === 0 ? `正在播放：${currentBilibili.title}` : entry.name }));
            }
        }
        root.append(fragment);
    }

    function createBilibiliActions(entry) {
        const actions = document.createElement('div'); actions.className = 'display-media-bilibili-actions';
        const url = `https://www.bilibili.com/video/${entry.bvid}${entry.page > 1 ? `?p=${entry.page}` : ''}`;
        actions.append(createButton('播放', () => playEntry(entry)), createButton('加入', async () => {
            try {
                await requestJson('/api/display-local/bilibili/add', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bvid: entry.bvid, page: entry.page }) });
                showNotice('已加入 B 站视频');
            } catch (error) { showNotice(error.message); }
        }), createButton('下载', () => showDownload(entry, url)), createButton('复制链接', async () => {
            try { await navigator.clipboard.writeText(url); showNotice('链接已复制'); }
            catch { showNotice('复制失败，请检查剪贴板权限'); }
        }));
        return actions;
    }

    function showDownload(entry, url) {
        const targets = state.libraries.filter(item => item.type === 'local' && !item.readonly);
        if (!targets.length) { showNotice('请先添加可写本地媒体库'); return; }
        const dialog = document.createElement('dialog'); dialog.className = 'display-media-download-dialog';
        const title = document.createElement('p'); title.textContent = entry.name;
        const select = document.createElement('select'); select.setAttribute('aria-label', '目标本地媒体库');
        for (const target of targets) { const option = document.createElement('option'); option.value = target.id; option.textContent = target.name; select.append(option); }
        const cancel = createButton('取消', () => dialog.close());
        const start = createButton('开始下载', async () => {
            start.disabled = true;
            try {
                await requestJson('/api/bilibili/download', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, title: entry.name, targetId: select.value, category: '' }) });
                dialog.close(); showNotice('已开始下载');
            } catch (error) { title.textContent = `下载失败：${error.message}`; start.disabled = false; }
        });
        dialog.append(title, select, cancel, start); document.body.append(dialog);
        dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
    }

    function setCurrentMedia(media) {
        let bvid = '', page = 1;
        try {
            const url = new URL(media?.url || '', location.href);
            const host = /(^|\.)bilibili\.com$/i.test(url.hostname);
            const local = /^\/api\/bilibili\/(?:video|dash|local)\//.test(url.pathname);
            if (host || local) bvid = (url.searchParams.get('bvid') || url.pathname.match(/\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1] || '');
            page = Number(url.searchParams.get('p') || 1);
        } catch {}
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) bvid = '';
        currentBilibili = bvid ? { bvid, page: Number.isSafeInteger(page) && page > 0 && page <= 10000 ? page : 1, title: media.fileName || bvid } : null;
        relatedEntries = []; const version = ++relatedVersion;
        if (!currentBilibili) { renderEntries(); return; }
        const query = new URLSearchParams({ libraryId: 'display-bilibili', path: `/d:related:${bvid}:${currentBilibili.page}` });
        void requestJson(`/api/display-local/list?${query}`).then(result => {
            if (version !== relatedVersion) return;
            relatedEntries = Array.isArray(result.entries) ? result.entries : []; renderEntries();
        }).catch(() => { if (version === relatedVersion) renderEntries(); });
    }

    async function loadLibraries() {
        const version = ++directoryVersion;
        state.libraryId = ''; state.path = '/'; state.parent = '/'; state.entries = [];
        renderEntries(); setStatus('加载中…');
        try {
            const payload = await requestJson('/api/display-local/libraries');
            if (version !== directoryVersion) return;
            state.libraries = Array.isArray(payload.libraries) ? payload.libraries : [];
            const requests = state.libraries.flatMap(library => (library.type === 'bilibili' ? ['/', '/d:home'] : ['/'])
                .map(path => ({ library, path })));
            renderEntries();
            if (!requests.length) { setStatus('此目录没有可播放的媒体'); return; }
            const seen = new Set();
            let pending = requests.length;
            let failed = 0;
            await Promise.allSettled(requests.map(async ({ library, path }) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 8000);
                try {
                    const query = new URLSearchParams({ libraryId: library.id, path });
                    const result = await requestJson(`/api/display-local/list?${query}`, { signal: controller.signal });
                    if (version !== directoryVersion) return;
                    const fragment = document.createDocumentFragment();
                    for (const item of Array.isArray(result.entries) ? result.entries : []) {
                        const entry = { ...item, libraryId: library.id };
                        const key = `${entry.libraryId}\0${entry.path}`;
                        if (seen.has(key)) continue;
                        seen.add(key); state.entries.push(entry); fragment.append(createEntry(entry));
                    }
                    byId('displayMediaLibraryEntries')?.querySelector('.display-media-card-grid')?.append(fragment);
                } catch (error) {
                    failed++;
                } finally {
                    clearTimeout(timer);
                    pending--;
                    if (version === directoryVersion) {
                        setStatus(failed ? '部分媒体来源加载失败，请稍后重试'
                            : pending ? '加载中…' : state.entries.length ? '' : '此目录没有可播放的媒体');
                    }
                }
            }));
        } catch (error) {
            if (version === directoryVersion) setStatus('媒体库加载失败，请稍后重试');
        }
    }

    async function enterDirectory(entry) {
        state.libraryId = entry.libraryId || state.libraryId;
        await openDirectory(entry.path);
    }

    async function openDirectory(path) {
        state.path = path;
        await loadDirectory(path);
    }

    async function loadDirectory(path) {
        const version = ++directoryVersion;
        state.entries = []; renderEntries(); setStatus('加载中…');
        try {
            const query = new URLSearchParams({ libraryId: state.libraryId, path });
            const payload = await requestJson(`/api/display-local/list?${query}`);
            if (version !== directoryVersion) return;
            state.path = typeof payload.path === 'string' ? payload.path : path;
            state.parent = typeof payload.parent === 'string' ? payload.parent : '/';
            state.entries = (Array.isArray(payload.entries) ? payload.entries : []).map(entry => ({ ...entry, libraryId: state.libraryId }));
            renderEntries(); setStatus(state.entries.length ? '' : '此目录没有可播放的媒体');
        } catch (error) {
            if (version !== directoryVersion) return;
            state.entries = []; renderEntries();
            setStatus(error.status === 410 || error.code === 'TASK_SOURCE_STOPPED' ? '任务媒体源已停止' : '媒体库加载失败，请稍后重试');
        }
    }

    function playEntry(entry) {
        // 单文件只提交来源和路径，待服务端完成可信解析后播放一次。
        if (pendingRequestId) cancelledRequests.add(pendingRequestId);
        pendingRequestId = null;
        pendingSingleRequestId = `display-single-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        if (options?.send?.({ type: 'displayPlaylistCancel', libraryId: entry.libraryId || state.libraryId, path: entry.path, requestId: pendingSingleRequestId }) === false) {
            pendingSingleRequestId = null;
            setStatus('连接已断开，请稍后重试');
            return;
        }
        setStatus('正在准备播放…');
        close();
    }

    function requestFolderPlayback(entry) {
        pendingSingleRequestId = null;
        setStatus('');
        pendingRequestId = `display-library-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        if (options?.send?.({ type: 'displayPlaylistRequest', libraryId: entry.libraryId || state.libraryId, path: entry.path, requestId: pendingRequestId }) === false) {
            pendingRequestId = null;
            setStatus('连接已断开，请稍后重试');
            return;
        }
        close();
    }

    function open() {
        if (!isLocalHostname(options?.hostname ?? window.location.hostname)) return;
        const panel = byId('displayMediaLibraryPanel');
        if (!panel) return;
        panel.hidden = false;
        void loadLibraries();
    }

    function close() {
        const panel = byId('displayMediaLibraryPanel');
        if (panel) panel.hidden = true;
    }

    function handleBack() {
        const dialog = document.querySelector('.display-media-download-dialog[open]');
        if (dialog) { dialog.close(); return true; }
        const panel = byId('displayMediaLibraryPanel');
        if (!panel || panel.hidden) return false;
        close();
        return true;
    }

    function showNotice(message) {
        const notice = byId('displayMediaLibraryNotice');
        if (!notice) return;
        notice.textContent = String(message || '');
        notice.hidden = !message;
        if (notice._timer) clearTimeout(notice._timer);
        if (message) {
            notice._timer = setTimeout(() => {
                notice.hidden = true;
                notice.textContent = '';
            }, 4000);
        }
    }

    function handleServerMessage(data) {
        if (data?.type === 'displayMediaStart') {
            if (!pendingSingleRequestId || data.requestId !== pendingSingleRequestId) return false;
            pendingSingleRequestId = null;
            options?.playMedia?.(data.media);
            close();
            return true;
        }
        if (data?.type === 'displayMediaDisconnected') {
            if (pendingSingleRequestId) showNotice('连接已断开，请稍后重试');
            pendingSingleRequestId = null;
            cancelledRequests.clear();
            return;
        }
        if (data?.type === 'displayPlaylistError') {
            if (data.requestId && data.requestId !== pendingSingleRequestId && data.requestId !== pendingRequestId) return;
            if (data.requestId === pendingSingleRequestId) {
                pendingSingleRequestId = null;
                // 失败前服务端可能已经提交了本地尚未接收的批量列表，按权威快照补齐。
                const playlist = data.authoritativePlaylist;
                const restoredRequestId = playlist?.startData?.requestId;
                if (restoredRequestId && cancelledRequests.has(restoredRequestId)) {
                    cancelledRequests.delete(restoredRequestId);
                    options?.restorePlaylist?.(playlist);
                }
            }
            showNotice(data.message || '媒体库加载失败，请稍后重试');
            return;
        }
        if (data?.type === 'playlistStart') {
            if (cancelledRequests.has(data.requestId)) return false;
            pendingRequestId = null;
            pendingSingleRequestId = null;
            close();
        }
        return true;
    }

    function init(nextOptions = {}) {
        options = nextOptions;
        close();
        const opacity = byId('displayMediaLibraryOpacity');
        const opacityValue = byId('displayMediaLibraryOpacityValue');
        const panel = byId('displayMediaLibraryPanel');
        if (opacity && panel) {
            // 只改变背景 alpha，不降低文字、控件和封面的透明度。
            const applyOpacity = value => {
                const amount = Math.max(0, Math.min(100, Math.round(Number(value))));
                opacity.value = String(amount);
                if (opacityValue) opacityValue.textContent = `${amount}%`;
                panel.style.setProperty('--display-media-background-alpha', String((100 - amount) / 100));
            };
            try {
                const stored = localStorage.getItem('aasc.display.mediaLibraryTransparency');
                applyOpacity(stored !== null && stored.trim() && Number.isFinite(Number(stored)) ? stored : 6);
            } catch { applyOpacity(6); }
            opacity.addEventListener('input', () => {
                applyOpacity(opacity.value);
                try { localStorage.setItem('aasc.display.mediaLibraryTransparency', opacity.value); } catch {}
            });
        }
        const toggle = byId('displayMediaLibraryToggle');
        if (!toggle) return;
        if (!isLocalHostname(options.hostname ?? window.location.hostname)) {
            toggle.hidden = true;
            return;
        }
        toggle.hidden = false;
        toggle.onclick = open;
        const closeButton = byId('displayMediaLibraryClose');
        if (closeButton) closeButton.onclick = close;
        const up = byId('displayMediaLibraryUp');
        if (up) up.onclick = () => {
            if (!state.libraryId) return;
            if (state.path === '/' || state.parent === '/') void loadLibraries();
            else void openDirectory(state.parent);
        };
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !byId('displayMediaLibraryPanel')?.hidden) close();
        });
    }

    window.DisplayMediaLibrary = {
        init, open, close, handleBack, handleServerMessage, isLocalHostname, setCurrentMedia
    };
})();
