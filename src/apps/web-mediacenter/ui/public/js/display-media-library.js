(function () {
    'use strict';

    const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    let options = null;
    let directoryVersion = 0;
    let pendingRequestId = null;
    let pendingSingleRequestId = null;
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

    async function requestJson(url) {
        const response = await fetch(url, { cache: 'no-store' });
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (!response.ok) {
            const error = new Error(payload?.error || '媒体库加载失败，请稍后重试');
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
            { title: '本地媒体', items: state.libraries.filter(item => item.type !== 'task') },
            { title: '任务媒体', items: state.libraries.filter(item => item.type === 'task') }
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
        for (const entry of state.entries) {
            const row = document.createElement('div');
            row.className = 'display-media-library-entry';
            const open = createButton(entry.name, () => {
                if (entry.type === 'directory') void openDirectory(entry.path);
                else playEntry(entry);
            });
            open.className = 'display-media-library-entry-name';
            row.appendChild(open);
            if (entry.type === 'directory') {
                const batch = createButton('批量播放', () => requestFolderPlayback(entry));
                batch.className = 'display-media-library-batch';
                row.appendChild(batch);
            }
            root.appendChild(row);
        }
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
        await loadDirectory('/');
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
        init, open, close, handleServerMessage, isLocalHostname
    };
})();
