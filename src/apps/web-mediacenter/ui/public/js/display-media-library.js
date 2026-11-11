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

    function renderSources() {
        const root = byId('displayMediaLibrarySources');
        if (!root) return;
        root.replaceChildren();
        const groups = [
            { title: '本地媒体', items: state.libraries.filter(item => !['task', 'quark', 'bilibili'].includes(item.type)) },
            { title: '国内媒体', items: state.libraries.filter(item => ['quark', 'bilibili'].includes(item.type) || (item.type === 'task' && item.region !== 'overseas')) },
            { title: '国外媒体', items: state.libraries.filter(item => item.type === 'task' && item.region === 'overseas') }
        ];
        for (const group of groups) {
            if (!group.items.length) continue;
            const heading = document.createElement('div');
            heading.className = 'display-media-library-group-title';
            heading.textContent = group.title;
            root.appendChild(heading);
            for (const library of group.items) {
                const button = createButton(library.name, () => void openLibrary(library.id));
                button.className = 'display-media-library-source';
                button.dataset.libraryId = library.id;
                if (library.id === state.libraryId) button.classList.add('active');
                root.appendChild(button);
            }
        }
    }

    function renderEntries() {
        const root = byId('displayMediaLibraryEntries');
        if (!root) return;
        root.replaceChildren();
        const path = byId('displayMediaLibraryPath');
        if (path) path.textContent = state.path;
        const up = byId('displayMediaLibraryUp');
        if (up) up.disabled = state.path === '/';
        const isBilibili = state.libraries.find(item => item.id === state.libraryId)?.type === 'bilibili';
        if (isBilibili) {
            const navigation = document.createElement('div');
            navigation.className = 'display-media-bilibili-nav';
            navigation.append(createButton('首页', () => void openDirectory('/d:home')),
                createButton('已保存', () => void openDirectory('/')));
            root.append(navigation);
        }
        if (isBilibili && state.path === '/d:home') {
            const heading = document.createElement('h3'); heading.textContent = 'B站热门'; root.append(heading);
        }
        for (const entry of state.entries) {
            const row = document.createElement('div');
            row.className = 'display-media-library-entry';
            const open = createButton(entry.name, () => {
                if (entry.type === 'directory') void openDirectory(entry.path);
                else playEntry(entry);
            });
            open.className = 'display-media-library-entry-name';
            if (isBilibili && entry.bvid && entry.cover) {
                const cover = document.createElement('img'); cover.src = entry.cover; cover.alt = ''; cover.loading = 'lazy';
                cover.referrerPolicy = 'no-referrer'; cover.className = 'display-media-bilibili-cover';
                cover.onerror = () => cover.remove(); row.append(cover);
            }
            row.appendChild(open);
            if (entry.type === 'directory') {
                const batch = createButton('批量播放', () => requestFolderPlayback(entry));
                batch.className = 'display-media-library-batch';
                row.appendChild(batch);
            }
            if (isBilibili && entry.bvid) { row.classList.add('display-media-bilibili-row'); row.append(createBilibiliActions(entry)); }
            root.appendChild(row);
        }
        if (isBilibili && currentBilibili && relatedEntries.length) {
            const heading = document.createElement('h3'); heading.textContent = '相关推荐'; root.append(heading);
            for (const [index, entry] of relatedEntries.entries()) {
                const row = document.createElement('div'); row.className = 'display-media-library-entry display-media-bilibili-row';
                if (entry.cover) {
                    const cover = document.createElement('img'); cover.src = entry.cover; cover.alt = ''; cover.loading = 'lazy';
                    cover.referrerPolicy = 'no-referrer'; cover.className = 'display-media-bilibili-cover'; cover.onerror = () => cover.remove(); row.append(cover);
                }
                const title = createButton((index === 0 ? '正在播放：' : '') + (index === 0 ? currentBilibili.title : entry.name), () => playEntry(entry));
                title.className = 'display-media-library-entry-name'; row.append(title, createBilibiliActions(entry)); root.append(row);
            }
        }
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
        setStatus('');
        try {
            const payload = await requestJson('/api/display-local/libraries');
            state.libraries = Array.isArray(payload.libraries) ? payload.libraries : [];
            renderSources();
            if (!state.libraries.length) {
                setStatus('此目录没有可播放的媒体');
                return;
            }
            const preferred = state.libraries.find(item => item.id === state.libraryId) || state.libraries[0];
            await openLibrary(preferred.id);
        } catch (error) {
            setStatus('媒体库加载失败，请稍后重试');
        }
    }

    async function openLibrary(libraryId) {
        state.libraryId = libraryId;
        state.path = '/';
        renderSources();
        await loadDirectory(state.libraries.find(item => item.id === libraryId)?.type === 'bilibili' ? '/d:home' : '/');
    }

    async function openDirectory(path) {
        state.path = path;
        await loadDirectory(path);
    }

    async function loadDirectory(path) {
        // 仅应用最后一次浏览请求，旧来源或旧目录的响应不能覆盖新目录。
        const version = ++directoryVersion;
        state.entries = [];
        renderEntries();
        setStatus('加载中…');
        try {
            const query = new URLSearchParams({ libraryId: state.libraryId, path });
            const payload = await requestJson(`/api/display-local/list?${query}`);
            if (version !== directoryVersion) return;
            setStatus('');
            state.path = typeof payload.path === 'string' ? payload.path : path;
            state.parent = typeof payload.parent === 'string' ? payload.parent : '/';
            state.entries = Array.isArray(payload.entries) ? payload.entries : [];
            renderEntries();
            if (!state.entries.length) setStatus('此目录没有可播放的媒体');
        } catch (error) {
            if (version !== directoryVersion) return;
            if (error.status === 410 || error.code === 'TASK_SOURCE_STOPPED') {
                state.path = '/';
                state.parent = '/';
                state.entries = [];
                renderEntries();
                setStatus('任务媒体源已停止');
                return;
            }
            setStatus('媒体库加载失败，请稍后重试');
        }
    }

    function playEntry(entry) {
        // 单文件只提交来源和路径，待服务端完成可信解析后播放一次。
        if (pendingRequestId) cancelledRequests.add(pendingRequestId);
        pendingRequestId = null;
        pendingSingleRequestId = `display-single-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        if (options?.send?.({ type: 'displayPlaylistCancel', libraryId: state.libraryId, path: entry.path, requestId: pendingSingleRequestId }) === false) {
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
        if (options?.send?.({ type: 'displayPlaylistRequest', libraryId: state.libraryId, path: entry.path, requestId: pendingRequestId }) === false) {
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
            if (state.path !== '/') void openDirectory(state.parent);
        };
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !byId('displayMediaLibraryPanel')?.hidden) close();
        });
    }

    window.DisplayMediaLibrary = {
        init, open, close, handleServerMessage, isLocalHostname, setCurrentMedia
    };
})();
