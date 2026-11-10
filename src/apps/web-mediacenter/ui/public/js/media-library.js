const MediaLibrary = {
    libraries: [],
    networkIndex: null,
    currentLibrary: null,
    currentPath: '/',
    activeTab: 'libraries',
    taskMediaSources: [],
    activeTaskSourceId: '',
    taskMediaRevision: 0,
    // 服务端下发的全局代理配置与每个任务媒体源的代理开关状态。
    webProxyConfig: {},
    quarkAdding: false,
    mediaPlaySequence: 0,
    quarkCookieConfigured: false,
    bilibiliCookieConfigured: false,
    quarkCacheCard: null,
    // 夸克文件条目元数据，用于单文件下载时提交与目录下载一致的指纹信息。
    quarkFileMeta: null,
    bilibiliVideos: [],
    bilibiliSearch: null,
    bilibiliSearchSequence: 0,
    bilibiliCollection: null,
    bilibiliCollectionSequence: 0,
    // 首页是否已自动加载；弹幕开关状态由 localStorage 恢复。
    bilibiliHomeLoaded: false,
    bilibiliDanmakuEnabled: false,
    bilibiliRelatedSequence: 0,
    bilibiliCurrentKey: '',
    shareFolders: { quark: { folders: [], entries: {} }, bilibili: { folders: [], entries: {} } },
    selectedShareFolder: { quark: '', bilibili: '' },
    currentMediaUrl: null,
    tempPlaylistFiles: null,
    
    async init() {
        await this.loadLibraries();
        window.WebSocketManager?.send({ type: 'getWebProxyConfig' });
        // 恢复 B 站弹幕开关的本地偏好，切换时写回 localStorage。
        const danmakuToggle = document.getElementById('bilibiliDanmakuToggle');
        if (danmakuToggle) {
            this.bilibiliDanmakuEnabled = localStorage.getItem('aasc.bilibiliDanmaku') === '1';
            danmakuToggle.checked = this.bilibiliDanmakuEnabled;
            danmakuToggle.onchange = () => {
                this.bilibiliDanmakuEnabled = danmakuToggle.checked;
                localStorage.setItem('aasc.bilibiliDanmaku', danmakuToggle.checked ? '1' : '0');
            };
        }
        void this.refreshTaskMediaSources();
        this.setupDragDrop();
        this.render();
        void this.refreshQuarkDirectoryDownload();
    },

    async refreshQuarkDirectoryDownload() {
        try {
            const response = await fetch('/api/quark-directory-downloads', { cache: 'no-store' });
            const result = await this.parseResponse(response);
            if (result.job) this.handleQuarkDirectoryDownload(result.job);
        } catch { /* 服务重连后可继续通过进度消息恢复。 */ }
    },
    
    async loadLibraries() {
        try {
            const res = await fetch('/api/aasc/media-index?path=%2F', { cache: 'no-store' });
            const data = await this.parseResponse(res);

            if (data.status === 'success' && data.index) {
                this.networkIndex = data.index;
                this.libraries = this.flattenNetworkLibraries(data.index);
                if (this.libraries.length > 0) {
                    const defaultLibrary = this.libraries.find(library => library.isLocal && library.isDefault && !['task', 'quark'].includes(library.type))
                        || this.libraries.find(library => library.isLocal && !['task', 'quark'].includes(library.type))
                        || this.libraries.find(library => !['task', 'quark'].includes(library.type));
                    if (defaultLibrary) await this.switchLibrary(defaultLibrary.id);
                }
            }
        } catch (err) {
            console.error('加载媒体库列表失败:', err);
        }
    },

    flattenNetworkLibraries(index) {
        const sources = Array.isArray(index?.sources) ? index.sources : [];
        const currentOrigin = typeof window !== 'undefined' && window.location
            ? window.location.origin
            : '';
        return sources.flatMap(source => {
            const node = source?.node || {};
            const nodeId = String(node.nodeId || node.id || 'unknown-node');
            const ownerUrl = String(node.url || '').replace(/\/+$/, '');
            const isLocal = nodeId === 'main-server' || (currentOrigin && ownerUrl === currentOrigin);
            const libraries = Array.isArray(source?.libraries) ? source.libraries : [];
            return libraries.map(library => ({
                ...library,
                id: isLocal ? String(library.id) : `${nodeId}::${library.id}`,
                sourceLibraryId: String(library.id || ''),
                ownerNodeId: nodeId,
                ownerNodeName: node.name || nodeId,
                ownerUrl,
                isLocal,
                remote: !isLocal,
                readonly: library.readonly === true,
                targetAvailable: isLocal || node.status === 'online',
                items: (Array.isArray(library.items) ? library.items : []).map(item => ({
                    ...item,
                    directUrl: item.directUrl || item.url || '',
                    proxyUrl: item.proxyUrl || this.buildLibraryProxyItemUrl(library, item.path) || item.url || ''
                })),
                name: isLocal ? library.name : `${node.name || nodeId} / ${library.name}`
            }));
        });
    },

    buildLibraryProxyItemUrl(library, itemPath) {
        const baseUrl = String(library?.proxyUrl || '');
        if (!baseUrl || !itemPath) return '';
        const encodedPath = String(itemPath).replace(/^\/+/, '').split('/')
            .filter(Boolean)
            .map(segment => encodeURIComponent(segment))
            .join('/');
        return encodedPath ? `${baseUrl.replace(/\/+$/, '')}/${encodedPath}` : baseUrl;
    },

    getPlaybackUrl(item) {
        const directUrl = this.normalizePlaybackUrl(item?.directUrl || item?.url);
        return directUrl || this.normalizePlaybackUrl(item?.proxyUrl) || '';
    },

    getPlaybackFallbackUrl(item) {
        const directUrl = this.normalizePlaybackUrl(item?.directUrl || item?.url);
        const fallback = this.normalizePlaybackUrl(item?.proxyUrl);
        return directUrl && fallback && fallback !== directUrl ? fallback : '';
    },

    normalizePlaybackUrl(value) {
        if (typeof value !== 'string') return '';
        const normalized = value.trim();
        return normalized && !['null', 'undefined'].includes(normalized.toLowerCase())
            ? normalized
            : '';
    },

    getLibraryRequest(library, operation) {
        const sourceId = encodeURIComponent(String(library?.sourceLibraryId || library?.id || ''));
        if (library?.remote) {
            const nodeId = encodeURIComponent(String(library.ownerNodeId || ''));
            const base = `/api/aasc/servers/${nodeId}/media-libraries/${sourceId}`;
            const remoteOperations = {
                update: { url: base, method: 'PUT' },
                remove: { url: base, method: 'DELETE' },
                upload: { url: `${base}/upload`, method: 'POST' },
                deleteFile: { url: `${base}/file`, method: 'DELETE' },
                createFolder: { url: `${base}/folder`, method: 'POST' },
                deleteFolder: { url: `${base}/folder`, method: 'DELETE' },
                setDefault: { url: `${base}/set-default`, method: 'POST' }
            };
            return remoteOperations[operation] || null;
        }
        const localBase = `/api/media-libraries/${sourceId}`;
        const localOperations = {
            update: { url: localBase, method: 'PUT' },
            remove: { url: localBase, method: 'DELETE' },
            upload: { url: `${localBase}/upload`, method: 'POST' },
            deleteFile: { url: `${localBase}/file`, method: 'DELETE' },
            createFolder: { url: `${localBase}/folder`, method: 'POST' },
            deleteFolder: { url: `${localBase}/folder`, method: 'DELETE' },
            setDefault: { url: `${localBase}/set-default`, method: 'POST' }
        };
        return localOperations[operation] || null;
    },

    async parseResponse(res) {
        let data = {};
        try {
            data = await res.json();
        } catch (error) {
            data = { message: '服务器返回了无法解析的响应' };
        }
        if (!res.ok || data.status === 'error') {
            throw new Error(`HTTP ${res.status}: ${data.message || '请求失败'}`);
        }
        return data;
    },

    async switchLibrary(id) {
        this.currentLibrary = this.libraries.find(library => library.id === id) || null;
        if (this.currentLibrary) this.activeTab = ['quark', 'task'].includes(this.currentLibrary.type) ? this.currentLibrary.type : 'libraries';
        this.renderTabs();
        this.currentPath = '/';
        this.renderLibraryList();
        this.renderLibraryToolbarState();
        await this.loadContent('/');
    },

    renderTabs() {
        const ordinary = document.getElementById('mediaTabLibraries');
        const quark = document.getElementById('mediaTabQuark');
        this.renderTaskMediaTabs();
        const bar = document.getElementById('quarkShareBar');
        const bilibili = document.getElementById('mediaTabBilibili');
        const bilibiliBar = document.getElementById('bilibiliVideoBar');
        const bilibiliList = document.getElementById('bilibiliVideoList');
        const bilibiliSearchBar = document.getElementById('bilibiliSearchBar');
        if (bilibiliSearchBar) bilibiliSearchBar.style.display = this.activeTab === 'bilibili' ? 'flex' : 'none';
        if (ordinary) ordinary.classList.toggle('active', this.activeTab === 'libraries');
        if (quark) quark.classList.toggle('active', this.activeTab === 'quark');
        if (bar) bar.style.display = this.activeTab === 'quark' ? 'flex' : 'none';
        if (bilibili) bilibili.classList.toggle('active', this.activeTab === 'bilibili');
        if (bilibiliBar) bilibiliBar.style.display = this.activeTab === 'bilibili' ? 'flex' : 'none';
        if (bilibiliList) bilibiliList.style.display = this.activeTab === 'bilibili' ? 'grid' : 'none';
        const browsingShares = this.activeTab === 'quark' && this.currentLibrary?.type !== 'quark';
        const shareList = document.getElementById('quarkShareList');
        if (shareList) shareList.style.display = browsingShares ? 'grid' : 'none';
        const folders = document.getElementById('shareFolderNavigation');
        if (folders) folders.style.display = ['quark', 'bilibili'].includes(this.activeTab) ? 'flex' : 'none';
        this.renderShareFolders();
        if (browsingShares) this.renderQuarkShares();
        for (const id of ['mediaLibraryHeader', 'mediaLibraryToolbar', 'mediaLibraryContent']) {
            const el = document.getElementById(id);
            if (el) el.style.display = this.activeTab === 'bilibili' || browsingShares || (['quark', 'task'].includes(this.activeTab) && id === 'mediaLibraryHeader') ? 'none' : '';
        }
        // 相关推荐只在 B 站页签且存在卡片时展示，避免跨页签残留空面板。
        const related = document.getElementById('bilibiliRelated');
        if (related) related.hidden = this.activeTab !== 'bilibili' || !related.querySelector('.bilibili-video-card');
    },

    async switchTab(tab) {
        this.activeTab = ['quark', 'bilibili'].includes(tab) ? tab : 'libraries';
        this.activeTaskSourceId = '';
        if (this.activeTab !== 'bilibili') this.bilibiliCollection = null;
        if (this.activeTab === 'quark') { this.currentLibrary = null; this.renderTabs(); return; }
        if (this.activeTab === 'bilibili') {
            this.renderTabs();
            this.renderBilibiliVideos();
            // 首次进入 B 站页签自动加载热门首页，之后由“首页”按钮手动刷新。
            if (!this.bilibiliHomeLoaded) {
                this.bilibiliHomeLoaded = true;
                void this.loadBilibiliHome();
            }
            return;
        }
        const matches = this.libraries.filter(lib => !['quark', 'task'].includes(lib.type));
        const selected = matches.find(lib => lib.id === this.currentLibrary?.id) || matches[0];
        this.renderTabs();
        if (selected) return this.switchLibrary(selected.id);
        this.currentLibrary = null;
        this.currentPath = '/';
        this.renderLibraryList();
        this.renderBreadcrumb();
        this.renderLibraryToolbarState();
        this.renderFileList([]);
    },

    handleBilibiliList(data) {
        this.bilibiliVideos = Array.isArray(data.videos) ? data.videos : [];
        this.renderBilibiliVideos();
    },

    sendBilibiliListCommand(type, url) {
        const socket = window.WebSocketManager?.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            showToast('服务未连接，请稍后重试', 'error');
            return false;
        }
        socket.send(JSON.stringify({ type, url }));
        return true;
    },

    addBilibiliVideo() {
        const url = document.getElementById('bilibiliVideoInput')?.value.trim() || '';
        this.addBilibiliUrl(url);
    },

    addBilibiliUrl(url) {
        if (!window.Upload?.getBilibiliPlayerUrl(url) && !this.canonicalBilibiliCollectionUrl(url)) { showToast('请输入 B 站 BV 视频或收藏列表链接', 'error'); return; }
        if (this.sendBilibiliListCommand('bilibiliListAdd', url)) {
            if (this.selectedShareFolder.bilibili) this.sendShareFolder('shareFolderMove', { category: 'bilibili', key: this.canonicalBilibiliUrl(url), folderId: this.selectedShareFolder.bilibili });
            showToast('正在加入 B 站视频…', 'loading');
        }
    },

    async playBilibiliUrl(url) {
        const sequence = ++this.mediaPlaySequence;
        const playerUrl = window.Upload?.getBilibiliPlayerUrl(url);
        if (!playerUrl) { showToast('请输入 B 站 BV 视频链接', 'error'); return; }
        let media = { type: 'url', url: playerUrl, mediaType: 'html' };
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            let result;
            try {
                const response = await fetch(`/api/bilibili/resolve?url=${encodeURIComponent(url)}`, { signal: controller.signal });
                result = await this.parseResponse(response);
            } finally { clearTimeout(timeout); }
            if (!/^\/api\/bilibili\/(?:video|dash|local)\/BV[0-9A-Za-z]{10}\?p=[1-9]\d*$/.test(result.url || '')) throw new Error('视频地址无效');
            if (result.dash && !/^\/api\/bilibili\/video\/BV[0-9A-Za-z]{10}\?p=[1-9]\d*$/.test(result.fallbackUrl || '')) throw new Error('回退视频地址无效');
            media = { type: 'url', url: new URL(result.url, window.location.origin).href, mediaType: 'video',
                bilibiliFallback: playerUrl, ...(result.dash ? { bilibiliDash: true, bilibiliMp4: new URL(result.fallbackUrl, window.location.origin).href } : {}),
                ...(result.width && result.height ? { width: result.width, height: result.height } : {}) };
        } catch (error) {
            showToast('原生视频暂不可用，使用 B 站播放器', 'info');
        }
        // B 站播放器地址带 bvid/p 查询参数：开启弹幕时附加弹幕地址，并加载相关推荐。
        const parsed = new URL(playerUrl);
        const bvid = parsed.searchParams.get('bvid')?.match(/^BV[0-9A-Za-z]{10}$/)?.[0]
            || parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1] || '';
        const page = Number(parsed.searchParams.get('p') || 1);
        if (this.bilibiliDanmakuEnabled && bvid) {
            media = { ...media, bilibiliDanmaku: true, bilibiliDanmakuUrl: `/api/bilibili/danmaku/${bvid}/${page}` };
        }
        if (sequence !== this.mediaPlaySequence) return;
        await window.WebSocketManager?.sendMedia(media);
        // 请求显示端权威状态，避免未选设备或发送失败时将请求中的视频误标为正在播放。
        if (sequence === this.mediaPlaySequence && window.currentDisplayId) {
            window.WebSocketManager?.send?.({ type: 'getState', displayId: window.currentDisplayId });
        }
    },

    playBilibiliInput() {
        const url = document.getElementById('bilibiliVideoInput')?.value.trim() || '';
        if (this.canonicalBilibiliCollectionUrl(url)) this.showBilibiliBatchPlayDialog(url);
        else this.playBilibiliUrl(url);
    },

    showBilibiliBatchPlayDialog(collectionUrl = '') {
        collectionUrl = collectionUrl || this.bilibiliCollection?.url || '';
        const folderId = this.selectedShareFolder.bilibili;
        const videos = this.bilibiliVideos.filter(video => (this.shareFolders.bilibili.entries[video.url] || '') === folderId);
        if (!collectionUrl && !videos.length) { showToast('此文件夹暂无 B 站视频', 'error'); return; }
        this.showPlaylistSettingsDialog({
            title: '批量播放 B 站视频', hideRecursive: true, bilibiliOnly: true,
            onConfirm: settings => {
                this.mediaPlaySequence++;
                this._lastCropPreviewUrl = null;
                this.tempPlaylistFiles = null;
                if (window.WebSocketManager.sendPlaylistRequest({ libraryType: 'bilibili', folderId, ...(collectionUrl ? { collectionUrl: this.canonicalBilibiliCollectionUrl(collectionUrl) } : {}), danmaku: this.bilibiliDanmakuEnabled === true, ...settings })) {
                    showToast('批量播放请求已发送', 'success');
                }
            }
        });
    },

    async searchBilibili(page = 1) {
        const keyword = document.getElementById('bilibiliSearchInput')?.value.trim() || '';
        if (!keyword) { showToast('请输入搜索内容', 'error'); return; }
        const sequence = ++this.bilibiliSearchSequence;
        this.bilibiliCollection = null;
        this.bilibiliSearch = { keyword, page, loading: true, videos: [] };
        this.renderBilibiliVideos();
        try {
            const response = await fetch(`/api/bilibili/search?keyword=${encodeURIComponent(keyword)}&page=${page}`);
            const result = await this.parseResponse(response);
            if (sequence !== this.bilibiliSearchSequence || !this.bilibiliSearch || this.bilibiliSearch.keyword !== keyword) return;
            Object.assign(this.bilibiliSearch, result, { loading: false });
        } catch (error) {
            if (sequence !== this.bilibiliSearchSequence || !this.bilibiliSearch) return;
            this.bilibiliSearch.loading = false; this.bilibiliSearch.error = error.message;
        }
        this.renderBilibiliVideos();
    },
    renderBilibiliSearch(list) {
        const state = this.bilibiliSearch;
        const header = document.createElement('div'); header.style.gridColumn = '1 / -1';
        const back = document.createElement('button'); back.textContent = '← 返回分类'; back.onclick = () => { this.bilibiliSearch = null; this.renderBilibiliVideos(); };
        const label = document.createElement('span'); label.textContent = ` 搜索：${state.keyword} · 第 ${state.page} 页 `;
        header.append(back, label);
        if (!state.loading && !state.error) {
            const prev = document.createElement('button'); prev.textContent = '上一页'; prev.disabled = state.page <= 1; prev.onclick = () => this.searchBilibili(state.page - 1);
            const next = document.createElement('button'); next.textContent = '下一页'; next.disabled = state.page >= state.totalPages; next.onclick = () => this.searchBilibili(state.page + 1);
            header.append(prev, next);
        }
        list.appendChild(header);
        if (state.loading || state.error || !state.videos?.length) {
            const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = state.loading ? '正在搜索…' : state.error || '没有找到视频'; list.appendChild(empty); return;
        }
        for (const video of state.videos) {
            const card = document.createElement('div'); card.className = 'bilibili-video-card';
            card.dataset.bilibiliVideo = '1';
            card.dataset.bvid = video.bvid;
            card.dataset.page = String(video.page || 1);
            const image = document.createElement('img'); image.className = 'bilibili-video-cover'; image.alt = '视频封面'; image.referrerPolicy = 'no-referrer'; if (video.cover) image.src = video.cover;
            image.onerror = () => { image.removeAttribute('src'); image.onerror = null; };
            const title = document.createElement('div'); title.className = 'bilibili-video-title'; title.textContent = video.title; title.title = video.title;
            const author = document.createElement('div'); author.textContent = video.author || '';
            const actions = document.createElement('div'); actions.className = 'bilibili-video-actions';
            const play = document.createElement('button'); play.textContent = '播放'; play.onclick = () => this.playBilibiliUrl(video.url);
            const add = document.createElement('button'); add.textContent = '加入'; add.onclick = () => this.addBilibiliUrl(video.url);
            const download = document.createElement('button'); download.className = 'btn-bilibili-download';
            download.textContent = video.downloaded ? '已下载' : '下载';
            download.disabled = Boolean(video.downloaded);
            download.onclick = () => this.showBilibiliDownloadDialog(video.url, video.title);
            const copy = document.createElement('button'); copy.textContent = '复制链接'; copy.onclick = () => this.copyShareLink(video.url);
            actions.append(play, add, download, copy); card.append(image, title, author, actions); list.appendChild(card);
        }
        this.checkBilibiliDownloaded();
    },
    async refreshBilibiliDownload() {
        try { const response = await fetch('/api/bilibili/download'); const result = await this.parseResponse(response); if (result.job) this.handleBilibiliDownload(result.job); } catch {}
    },
    handleBilibiliDownload(job) {
        const panel = document.getElementById('bilibiliDownloadStatus');
        if (!panel || !job) return;
        panel.style.display = '';
        const count = `已下载 ${job.completed || 0}，已存在 ${job.skipped || 0}${job.total ? ` / ${job.total}` : ''}`;
        panel.textContent = job.status === 'done' ? `B 站下载完成：${count}` : job.status === 'error' ? `B 站下载失败：${job.message || '未知错误'}（${count}）` : `正在下载 B 站视频：${count}${job.fileName ? ` · ${job.fileName} ${this.formatSize(job.received || 0)}` : ''}`;
    },
    downloadBilibiliInput() {
        const url = document.getElementById('bilibiliVideoInput')?.value.trim() || '';
        if (!this.canonicalBilibiliCollectionUrl(url) && !window.Upload?.getBilibiliPlayerUrl(url)) { showToast('请输入 B 站视频或收藏列表链接', 'error'); return; }
        this.showBilibiliDownloadDialog(url);
    },
    showBilibiliDownloadDialog(url, title = '') {
        const targets = this.libraries.filter(lib => lib.type === 'local' && !lib.readonly && !lib.remote && lib.isLocal !== false);
        if (!targets.length) { showToast('请先添加主服务器上的可写本地媒体库', 'error'); return; }
        const mask = document.createElement('div'); mask.className = 'modal-mask';
        const dialog = document.createElement('div'); dialog.className = 'playlist-settings-dialog';
        const heading = document.createElement('div'); heading.className = 'dialog-title'; heading.textContent = '下载 B 站视频到本地媒体库';
        const body = document.createElement('div'); body.className = 'dialog-body';
        const label = document.createElement('p'); label.textContent = title || url;
        const select = document.createElement('select'); select.setAttribute('aria-label', '目标本地媒体库');
        for (const lib of targets) { const option = document.createElement('option'); option.value = lib.sourceLibraryId || lib.id; option.textContent = lib.name; select.appendChild(option); }
        body.append(label, select);
        const footer = document.createElement('div'); footer.className = 'dialog-footer';
        const cancel = document.createElement('button'); cancel.className = 'btn-cancel'; cancel.textContent = '取消'; cancel.onclick = () => mask.remove();
        const start = document.createElement('button'); start.className = 'btn-confirm'; start.textContent = '开始下载';
        start.onclick = async () => {
            start.disabled = true;
            try {
                const response = await fetch('/api/bilibili/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, title, targetId: select.value }) });
                const result = await this.parseResponse(response); this.handleBilibiliDownload(result.job); mask.remove();
            } catch (error) { showToast(`B 站下载失败：${error.message}`, 'error'); start.disabled = false; }
        };
        footer.append(cancel, start); dialog.append(heading, body, footer); mask.appendChild(dialog); document.body.appendChild(mask);
    },

    openBilibiliCollection(video) {
        const url = this.canonicalBilibiliCollectionUrl(video?.url);
        if (!url) { showToast('B 站收藏列表链接无效', 'error'); return; }
        const socket = window.WebSocketManager?.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) { showToast('服务未连接，请稍后重试', 'error'); return; }
        const requestId = String(++this.bilibiliCollectionSequence);
        this.bilibiliSearch = null;
        this.bilibiliCollection = { url, title: video.title || '收藏列表', requestId, loading: true, videos: [] };
        this.renderBilibiliVideos();
        socket.send(JSON.stringify({ type: 'bilibiliCollectionGet', url, requestId }));
    },

    handleBilibiliCollection(data) {
        const current = this.bilibiliCollection;
        if (!current || current.requestId !== data.requestId) return;
        current.loading = false;
        current.error = data.error || '';
        if (!current.error) {
            current.title = data.title || current.title;
            current.videos = Array.isArray(data.videos) ? data.videos : [];
        }
        this.renderBilibiliVideos();
    },

    renderBilibiliCollection(list) {
        const collection = this.bilibiliCollection;
        const header = document.createElement('div');
        header.className = 'bilibili-collection-header';
        header.style.gridColumn = '1 / -1';
        const back = document.createElement('button');
        back.type = 'button'; back.textContent = '← 返回分类';
        back.onclick = () => { this.bilibiliCollection = null; this.renderBilibiliVideos(); };
        const name = document.createElement('span');
        name.textContent = ` ${collection.title} `;
        const playAll = document.createElement('button');
        playAll.type = 'button'; playAll.textContent = '批量播放此列表';
        playAll.onclick = () => this.showBilibiliBatchPlayDialog(collection.url);
        const downloadAll = document.createElement('button'); downloadAll.type = 'button'; downloadAll.textContent = '下载此列表'; downloadAll.onclick = () => this.showBilibiliDownloadDialog(collection.url, collection.title);
        header.append(back, name, playAll, downloadAll);
        list.appendChild(header);
        if (collection.loading || collection.error || !collection.videos.length) {
            const message = document.createElement('div');
            message.className = 'empty-list';
            message.textContent = collection.loading ? '正在读取收藏列表…' : collection.error || '收藏列表中没有可播放的视频';
            list.appendChild(message);
            if (collection.error) {
                const retry = document.createElement('button');
                retry.type = 'button'; retry.textContent = '重试';
                retry.onclick = () => this.openBilibiliCollection(collection);
                list.appendChild(retry);
            }
            return;
        }
        for (const video of collection.videos) {
            if (!/^BV[0-9A-Za-z]{10}$/.test(video.bvid || '') || !Number.isInteger(video.page) || video.page < 1 || video.page > 10000) continue;
            const url = `https://www.bilibili.com/video/${video.bvid}${video.page > 1 ? `?p=${video.page}` : ''}`;
            const card = document.createElement('div'); card.className = 'bilibili-video-card';
            // 收藏列表分集卡片同样参与“已下载”状态检查。
            card.dataset.bilibiliVideo = '1'; card.dataset.bvid = video.bvid; card.dataset.page = String(video.page);
            const image = document.createElement('img'); image.className = 'bilibili-video-cover'; image.alt = '视频封面'; image.referrerPolicy = 'no-referrer';
            if (video.cover) image.src = video.cover;
            image.onerror = () => { image.removeAttribute('src'); image.onerror = null; };
            const title = document.createElement('div'); title.className = 'bilibili-video-title';
            title.textContent = `${video.title || video.bvid}${video.page > 1 ? ` · P${video.page}` : ''}`; title.title = title.textContent;
            const actions = document.createElement('div'); actions.className = 'bilibili-video-actions';
            const play = document.createElement('button'); play.type = 'button'; play.textContent = '播放'; play.onclick = () => this.playBilibiliUrl(url);
            const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制链接'; copy.onclick = () => this.copyShareLink(url);
            const download = document.createElement('button'); download.className = 'btn-bilibili-download'; download.type = 'button'; download.textContent = '下载'; download.onclick = () => this.showBilibiliDownloadDialog(url, video.title);
            actions.append(play, copy, download); card.append(image, title, actions); list.appendChild(card);
        }
        this.checkBilibiliDownloaded();
    },

    renderBilibiliVideos() {
        const list = document.getElementById('bilibiliVideoList');
        if (!list) return;
        list.replaceChildren();
        if (this.bilibiliSearch) { this.renderBilibiliSearch(list); return; }
        if (this.bilibiliCollection) { this.renderBilibiliCollection(list); return; }
        if (!this.bilibiliVideos.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-list';
            empty.textContent = '暂无 B 站视频';
            list.appendChild(empty);
            return;
        }
        const selected = this.selectedShareFolder.bilibili;
        const visible = this.bilibiliVideos.filter(video => (this.shareFolders.bilibili.entries[video.url] || '') === selected);
        if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = '此文件夹暂无 B 站视频'; list.appendChild(empty); }
        for (const video of visible) {
            const card = document.createElement('div');
            card.className = 'bilibili-video-card';
            // 带单一 bvid 的保存视频卡片参与“已下载”状态检查；收藏列表卡片没有单一 bvid，跳过。
            if (/^BV[0-9A-Za-z]{10}$/.test(video.bvid || '')) {
                card.dataset.bilibiliVideo = '1'; card.dataset.bvid = video.bvid; card.dataset.page = String(video.page || 1);
            }
            const image = document.createElement('img');
            image.className = 'bilibili-video-cover';
            image.alt = '视频封面';
            image.referrerPolicy = 'no-referrer';
            if (video.cover) image.src = video.cover;
            image.onerror = () => { image.removeAttribute('src'); image.onerror = null; };
            const title = document.createElement('div');
            title.className = 'bilibili-video-title';
            title.textContent = `${video.collection ? '收藏列表 · ' : ''}${video.title || video.bvid}${video.page > 1 ? ` · P${video.page}` : ''}`;
            title.title = title.textContent;
            const actions = document.createElement('div');
            actions.className = 'bilibili-video-actions';
            const play = document.createElement('button');
            play.textContent = '播放';
            play.onclick = () => video.collection ? this.showBilibiliBatchPlayDialog(video.url) : this.playBilibiliUrl(video.url);
            const remove = document.createElement('button');
            remove.textContent = '移除';
            remove.onclick = () => { this.sendBilibiliListCommand('bilibiliListRemove', video.url); this.sendShareFolder('shareFolderMove', { category: 'bilibili', key: video.url, folderId: '' }); };
            const move = document.createElement('button');
            move.textContent = '移动';
            move.onclick = () => this.moveShare('bilibili', video.url);
            const copy = document.createElement('button');
            copy.textContent = '复制链接';
            copy.onclick = () => this.copyShareLink(video.url);
            if (video.collection) {
                const open = document.createElement('button'); open.type = 'button'; open.textContent = '打开';
                open.onclick = event => { event.stopPropagation(); this.openBilibiliCollection(video); };
                for (const button of [play, remove, move, copy]) button.addEventListener('click', event => event.stopPropagation());
                actions.append(open);
                card.setAttribute('role', 'button'); card.tabIndex = 0;
                card.onclick = () => this.openBilibiliCollection(video);
                card.onkeydown = event => { if (event.target === card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.openBilibiliCollection(video); } };
            }
            const download = document.createElement('button'); download.className = 'btn-bilibili-download';
            download.textContent = video.downloaded ? '已下载' : '下载';
            download.disabled = Boolean(video.downloaded);
            download.onclick = event => { event.stopPropagation(); this.showBilibiliDownloadDialog(video.url, video.title); };
            actions.append(play, remove, move, copy, download);
            card.append(image, title, actions);
            list.appendChild(card);
        }
        this.checkBilibiliDownloaded();
    },

    // 加载 B 站热门首页；渲染前清理搜索/收藏视图，避免再次渲染时回到旧视图。
    async loadBilibiliHome() {
        try {
            const response = await fetch('/api/bilibili/home?page=1');
            const result = await this.parseResponse(response);
            this.bilibiliSearch = null;
            this.bilibiliCollection = null;
            this.renderBilibiliCards(result.videos, 'B站热门');
        } catch (error) { showToast(`B站首页加载失败：${error.message}`, 'error'); }
    },

    // 从实际播放地址提取 BV/分 P，不把其他网站的查询参数误认作 B 站视频。
    parseBilibiliCurrent(url) {
        if (!url || typeof url !== 'string') return null;
        try {
            const parsed = new URL(url, window.location.href);
            // 批量播放可能返回同一服务的 LAN 地址，与控制页访问域名不同。
            const local = /^https?:$/.test(parsed.protocol) && /^\/api\/bilibili\/(?:video|dash|local)\//.test(parsed.pathname);
            const bilibili = /(^|\.)bilibili\.com$/i.test(parsed.hostname);
            if (!local && !bilibili) return null;
            const bvid = (local ? parsed.pathname.match(/\/(BV[0-9A-Za-z]{10})$/)?.[1]
                : parsed.searchParams.get('bvid') || parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1]) || '';
            if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return null;
            const rawPage = Number(parsed.searchParams.get('p') || 1);
            const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 10000 ? rawPage : 1;
            return { bvid, page, url: `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}` };
        } catch { return null; }
    },

    // 优先复用已有卡片元数据；直接输入或刷新没有元数据时安全回退到 BV 编号。
    currentBilibiliMetadata(item, title) {
        const cards = document.querySelectorAll('[data-bilibili-video]');
        const card = [...cards].find(entry => entry.dataset.bvid === item.bvid && Number(entry.dataset.page || 1) === item.page);
        const saved = this.bilibiliVideos.find(video => video.bvid === item.bvid && Number(video.page || 1) === item.page);
        return { ...item, title: title || card?.querySelector('.bilibili-video-title')?.textContent || saved?.title || item.bvid,
            cover: card?.querySelector('img')?.getAttribute('src') || saved?.cover || '' };
    },

    async loadBilibiliRelated(item, title) {
        const root = document.getElementById('bilibiliRelated');
        const list = document.getElementById('bilibiliRelatedList');
        if (!root || !list) return;
        const sequence = ++this.bilibiliRelatedSequence;
        const current = this.currentBilibiliMetadata(item, title);
        const render = videos => {
            if (sequence !== this.bilibiliRelatedSequence) return;
            const recommendations = (Array.isArray(videos) ? videos : []).filter(video => video.bvid !== item.bvid);
            const cards = this.buildBilibiliCards([current, ...recommendations]);
            cards[0].classList.add('bilibili-current-video');
            const badge = document.createElement('span'); badge.className = 'bilibili-current-badge'; badge.textContent = '正在播放';
            cards[0].prepend(badge);
            list.replaceChildren(...cards);
            root.hidden = this.activeTab !== 'bilibili';
            this.checkBilibiliDownloaded();
        };
        render([]);
        try {
            const response = await fetch(`/api/bilibili/related?bvid=${encodeURIComponent(item.bvid)}`);
            const result = await this.parseResponse(response);
            render(result.videos);
        } catch { /* 当前项保留，推荐失败不影响播放。 */ }
    },

    // 通用 B 站卡片渲染：封面加空值与加载失败守卫，带 bvid 的卡片标记已下载检查。
    buildBilibiliCards(videos) {
        return (Array.isArray(videos) ? videos : []).map(video => {
            const card = document.createElement('div');
            card.className = 'bilibili-video-card';
            const cover = document.createElement('img');
            cover.className = 'bilibili-video-cover'; cover.loading = 'lazy'; cover.alt = '视频封面';
            cover.referrerPolicy = 'no-referrer';
            if (video.cover) cover.src = video.cover;
            cover.onerror = () => { cover.removeAttribute('src'); cover.onerror = null; };
            const title = document.createElement('div');
            title.className = 'bilibili-video-title'; title.textContent = video.title; title.title = video.title;
            const actions = document.createElement('div');
            actions.className = 'bilibili-video-actions';
            const play = document.createElement('button'); play.textContent = '播放'; play.onclick = () => this.playBilibiliUrl(video.url);
            const add = document.createElement('button'); add.textContent = '加入'; add.onclick = () => this.addBilibiliUrl(video.url);
            const download = document.createElement('button'); download.className = 'btn-bilibili-download';
            download.textContent = video.downloaded ? '已下载' : '下载';
            download.disabled = Boolean(video.downloaded);
            download.onclick = () => this.showBilibiliDownloadDialog(video.url, video.title);
            const copy = document.createElement('button'); copy.textContent = '复制链接'; copy.onclick = () => this.copyShareLink(video.url);
            actions.append(play, add, download, copy);
            card.append(cover, title, actions);
            if (/^BV[0-9A-Za-z]{10}$/.test(video.bvid || '')) {
                card.dataset.bilibiliVideo = '1'; card.dataset.bvid = video.bvid; card.dataset.page = String(video.page || 1);
            }
            return card;
        });
    },

    // 用卡片替换 B 站视频列表，可附带分组标题。
    renderBilibiliCards(videos, titleText) {
        const root = document.getElementById('bilibiliVideoList');
        if (!root) return;
        root.replaceChildren();
        if (titleText) {
            const title = document.createElement('div');
            title.className = 'bilibili-section-title'; title.textContent = titleText;
            root.appendChild(title);
        }
        root.append(...this.buildBilibiliCards(videos));
        this.checkBilibiliDownloaded();
    },

    // 查询每张 B 站卡片的下载状态，命中时禁用下载按钮；失败不影响列表展示。
    async checkBilibiliDownloaded() {
        document.querySelectorAll('[data-bilibili-video]').forEach(async card => {
            try {
                const response = await fetch(`/api/bilibili/downloaded?bvid=${encodeURIComponent(card.dataset.bvid)}&page=${card.dataset.page || 1}`);
                const result = await this.parseResponse(response);
                if (!result.downloaded) return;
                const button = card.querySelector('.btn-bilibili-download');
                if (button) { button.textContent = '已下载'; button.disabled = true; }
            } catch { /* 已下载状态失败不阻塞列表展示。 */ }
        });
    },

    async copyShareLink(value) {
        try {
            if (navigator.clipboard?.writeText && window.isSecureContext) await navigator.clipboard.writeText(value);
            else {
                const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
                document.body.appendChild(input); input.select();
                const copied = document.execCommand('copy'); input.remove();
                if (!copied) throw new Error('copy failed');
            }
            showToast('链接已复制', 'success');
        } catch { window.prompt('请复制链接', value); }
    },
    async prepareQuarkVideo(url, onProgress) {
        const source = new URL(url, window.location.href);
        if (!/^\/api\/(?:aasc\/servers\/[^/]+\/)?media-libraries\/[^/]+\/proxy\//.test(source.pathname)) throw new Error('缓存地址无效');
        const target = new URL(source.pathname + source.search, window.location.origin);
        return window.QuarkCacheProgress.prepare(target.href, onProgress);
    },
    cacheCardKey(data) {
        return data.cacheNodeId && data.cacheLibraryId && data.cachePath ? JSON.stringify([data.cacheNodeId, data.cacheLibraryId, data.cachePath]) : '';
    },
    updateQuarkCacheCards() {
        const container = document.getElementById('mediaLibraryContent');
        if (!container?.querySelectorAll) return;
        for (const card of container.querySelectorAll('[data-cache-key]')) {
            const overlay = card.querySelector('.quark-card-cache');
            if (!overlay) continue;
            const state = this.quarkCacheCard;
            const visible = !!state && card.dataset.cacheKey === state.key;
            overlay.hidden = !visible;
            if (!visible) continue;
            const progress = overlay.querySelector('progress');
            const label = overlay.querySelector('span');
            const total = Math.max(0, Number(state.total) || 0);
            const received = Math.max(0, Number(state.received) || 0);
            const complete = state.status === 'ready' || state.phase === 'ready';
            const percent = complete ? 100 : total ? Math.min(100, Math.floor(received * 100 / total)) : 0;
            if (total || complete) progress.value = percent; else progress.removeAttribute('value');
            label.textContent = state.status === 'error' ? '缓存失败' : complete ? '缓存完成' : state.phase === 'queued' ? '等待缓存' : total ? `缓存 ${percent}%` : '正在缓存';
            overlay.classList.toggle('error', state.status === 'error');
        }
    },
    handleQuarkCacheProgress(data) {
        const key = this.cacheCardKey(data);
        if (data.status === 'cancelled') {
            if (key && this.quarkCacheCard?.key === key) {
                this.quarkCacheCard = null;
                const panel = document.getElementById('quarkCacheStatus');
                if (panel) panel.style.display = 'none';
            }
            this.updateQuarkCacheCards();
            return;
        }
        if (key) {
            clearTimeout(this.quarkCacheCardTimer);
            this.quarkCacheCard = { ...data, key };
            this.updateQuarkCacheCards();
            if (data.status === 'ready' || data.phase === 'ready' || data.status === 'error') {
                const state = this.quarkCacheCard;
                this.quarkCacheCardTimer = setTimeout(() => { if (this.quarkCacheCard === state) { this.quarkCacheCard = null; this.updateQuarkCacheCards(); } }, 5000);
            }
        }
        const panel = document.getElementById('quarkCacheStatus');
        const text = document.getElementById('quarkCacheStatusText');
        const bar = document.getElementById('quarkCacheProgress');
        if (!panel || !text || !bar) return;
        clearTimeout(this.quarkCacheStatusTimer);
        panel.style.display = 'flex';
        const total = Math.max(0, Number(data.total) || 0);
        const received = Math.min(total || Infinity, Math.max(0, Number(data.received) || 0));
        const percent = total ? Math.min(100, Math.floor(received * 100 / total)) : 0;
        if (data.status === 'error') {
            text.textContent = '夸克缓存失败：' + (data.message || '未知错误');
            bar.style.display = 'none';
            return;
        }
        bar.style.display = '';
        bar.value = (data.status === 'ready' || data.phase === 'ready') ? 100 : percent;
        const name = data.fileName ? ` ${data.fileName}` : '';
        if (data.phase === 'queued') text.textContent = `夸克视频${name} 等待缓存`;
        else if (data.status === 'ready' || data.phase === 'ready') text.textContent = `夸克视频${name} 缓存完成`;
        else text.textContent = `夸克视频${name} 缓存 ${percent}%（${this.formatSize(received)} / ${total ? this.formatSize(total) : '未知'}）`;
        if (data.status === 'ready' || data.phase === 'ready') this.quarkCacheStatusTimer = setTimeout(() => { panel.style.display = 'none'; }, 5000);
    },
    canonicalBilibiliCollectionUrl(value) {
        try {
            const u = new URL(value);
            const match = /^\/list\/ml([1-9]\d{0,19})\/?$/.exec(u.pathname);
            return ['http:', 'https:'].includes(u.protocol) && ['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(u.hostname.toLowerCase()) && !u.username && !u.password && match ? `https://www.bilibili.com/list/ml${match[1]}` : '';
        } catch { return ''; }
    },
    canonicalBilibiliUrl(value) {
        const collection = this.canonicalBilibiliCollectionUrl(value);
        if (collection) return collection;
        try { const u = new URL(value); const match = /^\/video\/(BV[0-9A-Za-z]{10})/.exec(u.pathname); const page = Number(u.searchParams.get('p') || 1); return match ? `https://www.bilibili.com/video/${match[1]}${page > 1 ? `?p=${page}` : ''}` : value; } catch { return value; }
    },
    sendShareFolder(type, data = {}) {
        const socket = window.WebSocketManager?.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) { showToast('服务未连接，请稍后重试', 'error'); return false; }
        socket.send(JSON.stringify({ type, ...data })); return true;
    },
    handleShareFolders(data) {
        this.quarkCookieConfigured = data.quarkCookieConfigured === true;
        this.bilibiliCookieConfigured = data.bilibiliCookieConfigured === true;
        for (const type of ['quark', 'bilibili']) {
            const value = data.folders?.[type];
            this.shareFolders[type] = { folders: Array.isArray(value?.folders) ? value.folders : [], entries: value?.entries || {} };
            if (this.selectedShareFolder[type] && !this.shareFolders[type].folders.some(folder => folder.id === this.selectedShareFolder[type])) this.selectedShareFolder[type] = '';
        }
        this.renderTabs(); this.renderBilibiliVideos();
    },
    renderShareFolders() {
        const root = document.getElementById('shareFolderNavigation');
        if (!root) return;
        root.replaceChildren();
        if (!['quark', 'bilibili'].includes(this.activeTab)) return;
        const type = this.activeTab;
        const group = this.shareFolders[type];
        const make = (text, action) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = action; return button; };
        root.appendChild(make('📁 未分类', () => this.selectShareFolder(type, '')));
        for (const folder of group.folders) {
            const button = make(`📁 ${folder.name}`, () => this.selectShareFolder(type, folder.id));
            if (folder.id === this.selectedShareFolder[type]) button.className = 'active';
            root.appendChild(button);
        }
        if (type === 'quark') root.appendChild(make(this.quarkCookieConfigured ? 'Cookie 已配置' : '配置 Cookie', () => { const cookie = window.prompt('粘贴夸克 Cookie；留空则清除保存的 Cookie'); if (cookie !== null) this.sendShareFolder('quarkCookieSet', { cookie }); }));
        if (type === 'bilibili') root.appendChild(make(this.bilibiliCookieConfigured ? 'Cookie 已配置' : '配置 Cookie', () => { const cookie = window.prompt('粘贴 B 站 Cookie；留空则清除保存的 Cookie'); if (cookie !== null) this.sendShareFolder('bilibiliCookieSet', { cookie }); }));
        root.appendChild(make('＋ 新建文件夹', () => { const name = window.prompt('文件夹名称'); if (name?.trim()) this.sendShareFolder('shareFolderCreate', { category: type, name }); }));
        if (this.selectedShareFolder[type]) root.appendChild(make('删除空文件夹', () => { if (window.confirm('删除当前空文件夹？')) this.sendShareFolder('shareFolderDelete', { category: type, folderId: this.selectedShareFolder[type] }); }));
        if (type === 'quark' && this.currentLibrary?.type === 'quark') root.appendChild(make('返回分享列表', () => this.selectShareFolder('quark', this.selectedShareFolder.quark)));
    },
    selectShareFolder(type, folderId) {
        this.selectedShareFolder[type] = folderId;
        if (type === 'bilibili') { this.bilibiliCollection = null; this.bilibiliSearch = null; }
        if (type === 'quark') this.currentLibrary = null;
        this.renderTabs();
        if (type === 'bilibili') this.renderBilibiliVideos();
    },
    moveShare(type, key) {
        const folders = this.shareFolders[type].folders;
        if (!folders.length) { showToast('请先新建文件夹', 'info'); return; }
        const choices = ['0. 未分类', ...folders.map((folder, index) => `${index + 1}. ${folder.name}`)];
        const answer = window.prompt(`移动到哪个文件夹？\n${choices.join('\n')}`, '0');
        if (answer === null) return;
        const index = Number(answer.trim());
        if (!/^\d+$/.test(answer.trim()) || index > folders.length) { showToast('文件夹编号无效', 'error'); return; }
        this.sendShareFolder('shareFolderMove', { category: type, key, folderId: index ? folders[index - 1].id : '' });
    },
    async refreshTaskMediaSources() {
        const revision = this.taskMediaRevision;
        try {
            const result = await this.parseResponse(await fetch('/api/media-library-providers', { cache: 'no-store' }));
            if (revision === this.taskMediaRevision) this.handleTaskMediaSources(result);
        } catch (error) { console.warn('加载任务媒体源失败:', error); }
    },
    handleTaskMediaSources(data) {
        this.taskMediaRevision++;
        this.taskMediaSources = Array.isArray(data.providers) ? data.providers.filter(source => source && /^[a-z][a-z0-9._-]{1,63}$/.test(source.id || '') && typeof source.libraryId === 'string' && source.libraryId) : [];
        if (this.activeTab === 'task' && !this.taskMediaSources.some(source => source.id === this.activeTaskSourceId)) {
            this.currentLibrary = null;
            void this.switchTab('libraries');
            return;
        }
        this.renderTaskMediaTabs();
    },
    // 接收服务端代理配置；数据缺失时按空配置处理，保证任务页签仍能正常渲染。
    handleWebProxyConfig(data) {
        this.webProxyConfig = data || {};
        const enabled = Boolean(data?.providerProxy?.bilibili);
        const toggle = document.getElementById('bilibiliProxyToggle');
        if (toggle && document.activeElement !== toggle) toggle.checked = enabled;
        this.renderTaskMediaTabs();
    },
    // 发送单个媒体源的代理开关，服务端保存成功后广播权威配置。
    toggleProviderProxy(sourceId, enabled) {
        window.WebSocketManager?.send({ type: 'setProviderProxy', sourceId, enabled });
    },
    renderTaskMediaTabs() {
        // 先清理旧节点，避免任务源变化后残留页签或“使用代理”复选框。
        document.querySelectorAll('.media-task-source-wrap').forEach(node => node.remove());
        document.querySelectorAll('[data-task-media-source]').forEach(node => node.remove());
        const groups = { domestic: document.getElementById('domesticMediaTabs'), overseas: document.getElementById('overseasMediaTabs') };
        if (!groups.domestic || !groups.overseas) return;
        groups.domestic.replaceChildren(); groups.overseas.replaceChildren();
        for (const source of this.taskMediaSources || []) {
            const host = groups[source.region === 'overseas' ? 'overseas' : 'domestic'];
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'media-library-tab media-task-source';
            tab.dataset.taskMediaSource = source.id;
            tab.textContent = source.name || source.id;
            tab.classList.toggle('active', this.activeTab === 'task' && this.activeTaskSourceId === source.id);
            tab.onclick = () => this.switchTaskMediaSource(source.id);

            // 每个任务源附带“使用代理”开关：显式开关优先，否则沿用服务端计算的有效状态。
            const label = document.createElement('label');
            label.className = 'media-source-proxy';
            label.dataset.taskMediaProxy = source.id;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.providerProxy = source.id;
            // 复选框同样标记为任务代理，供设置面板批量同步时排除，避免覆盖任务页签状态。
            checkbox.dataset.taskMediaProxy = source.id;
            const switches = this.webProxyConfig?.providerProxy || {};
            checkbox.checked = Object.prototype.hasOwnProperty.call(switches, source.id)
                ? switches[source.id] === true
                : source.proxyEnabled === true;
            checkbox.onchange = () => this.toggleProviderProxy(source.id, checkbox.checked);
            label.append(checkbox, document.createTextNode(' 使用代理'));

            const wrap = document.createElement('span');
            wrap.className = 'media-task-source-wrap';
            wrap.append(tab, label);
            host.appendChild(wrap);
        }
    },
    async switchTaskMediaSource(id) {
        const source = this.taskMediaSources.find(item => item.id === id);
        if (!source) return;
        this.activeTab = 'task'; this.activeTaskSourceId = id;
        this.currentLibrary = { id: source.libraryId, sourceLibraryId: source.libraryId, providerId: id, type: 'task', name: source.name, ownerNodeId: 'main-server', ownerNodeName: '主服务器', isLocal: true, remote: false, readonly: true };
        this.currentPath = '/'; this.renderTabs(); this.renderLibraryToolbarState();
        await this.loadContent('/');
    },
    renderQuarkShares() {
        const root = document.getElementById('quarkShareList');
        if (!root) return;
        root.replaceChildren();
        const group = this.shareFolders.quark;
        const selected = this.selectedShareFolder.quark;
        const libraries = this.libraries.filter(lib => lib.type === 'quark' && (group.entries[lib.id] || '') === selected);
        if (!libraries.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = '此文件夹暂无夸克分享'; root.appendChild(empty); }
        for (const library of libraries) {
            const card = document.createElement('div'); card.className = 'media-library-item folder share-link-card';
            const icon = document.createElement('div'); icon.className = 'folder-icon'; icon.textContent = '📁';
            const name = document.createElement('div'); name.className = 'item-name'; name.textContent = library.name; name.title = library.name;
            const owner = document.createElement('div'); owner.className = 'item-meta'; owner.textContent = library.remote ? library.ownerNodeName || library.ownerNodeId : '主服务器';
            const actions = document.createElement('div'); actions.className = 'share-link-actions';
            const move = document.createElement('button'); move.textContent = '移动'; move.onclick = event => { event.stopPropagation(); this.moveShare('quark', library.id); };
            const edit = document.createElement('button'); edit.textContent = '设置'; edit.onclick = event => { event.stopPropagation(); this.showEditLibraryDialog(library.id); };
            const copy = document.createElement('button'); copy.textContent = '复制链接'; copy.onclick = event => { event.stopPropagation(); if (library.shareId) this.copyShareLink(`https://pan.quark.cn/s/${library.shareId}`); else showToast('该分享没有可复制的链接', 'error'); };
            const download = document.createElement('button');
            download.textContent = library.downloaded ? '已下载' : '下载';
            download.disabled = Boolean(library.downloaded);
            download.onclick = event => { event.stopPropagation(); this.showQuarkDirectoryDownloadDialog('/', library); };
            actions.append(move, edit, copy, download); card.append(icon, name, owner, actions); card.onclick = () => this.switchLibrary(library.id); root.appendChild(card);
        }
    },

    parseQuarkShare(value) {
        const text = String(value || '');
        const match = text.match(/https?:\/\/pan\.quark\.cn\/s\/([a-zA-Z0-9]+)(?:\?[^\s，。；！）]*)?/i);
        if (!match) throw new Error('请输入有效的夸克分享链接');
        const parsed = new URL(match[0]);
        if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'pan.quark.cn') throw new Error('请输入 HTTPS 夸克分享链接');
        const textCode = text.match(/(?:提取码|访问码|密码)\s*[:：]?\s*([a-zA-Z0-9]{4,8})/i);
        const passcode = parsed.searchParams.get('pwd') || parsed.searchParams.get('passcode') || parsed.searchParams.get('code') || (textCode && textCode[1]) || '';
        return { id: match[1], url: `https://pan.quark.cn/s/${match[1]}`, passcode };
    },

    async addQuarkShare(play = false) {
        if (this.quarkAdding) return;
        this.quarkAdding = true;
        try {
            const parsed = this.parseQuarkShare(document.getElementById('quarkShareInput')?.value);
            const manualPasscode = document.getElementById('quarkSharePasscode')?.value.trim() || '';
            let library = this.libraries.find(lib => lib.type === 'quark' && lib.shareId === parsed.id && lib.isLocal)
                || this.libraries.find(lib => lib.type === 'quark' && lib.shareId === parsed.id && lib.targetAvailable);
            if (!library) {
                const response = await fetch('/api/media-libraries', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: `夸克分享 ${parsed.id}`, type: 'quark', url: parsed.url, passcode: manualPasscode || parsed.passcode, readonly: true })
                });
                const result = await this.parseResponse(response);
                await this.loadLibraries();
                library = this.libraries.find(lib => lib.isLocal && lib.sourceLibraryId === result.library?.id);
                if (!library) throw new Error('分享已添加，但媒体索引暂不可用，请刷新');
                if (this.selectedShareFolder.quark) this.sendShareFolder('shareFolderMove', { category: 'quark', key: library.id, folderId: this.selectedShareFolder.quark });
                showToast('夸克分享已加入', 'success');
            }
            await this.switchLibrary(library.id);
            if (play) this.showBatchPlayDialog('/');
        } catch (err) {
            showToast('夸克分享操作失败: ' + err.message, 'error');
        } finally {
            this.quarkAdding = false;
        }
    },

    renderLibraryToolbarState() {
        const writable = Boolean(this.currentLibrary && !this.currentLibrary.readonly);
        document.querySelectorAll('[data-media-write-control]').forEach(element => {
            element.style.display = writable ? '' : 'none';
        });
        const downloadButton = document.getElementById('quarkDirectoryDownloadButton');
        if (downloadButton) downloadButton.style.display = this.currentLibrary?.type === 'quark' ? '' : 'none';
        const status = document.getElementById('mediaLibraryRouteStatus');
        if (!status) return;
        if (!this.currentLibrary) {
            status.textContent = '未选择媒体库';
            return;
        }
        const mode = this.currentLibrary.remote ? '子服务器媒体库' : '主服务器媒体库';
        const permission = this.currentLibrary.readonly ? '只读' : '可写';
        status.textContent = `${mode} · ${permission} · ${this.currentLibrary.ownerNodeName || '主服务器'}`;
    },

    async loadContent(path) {
        if (!this.currentLibrary) return;

        this.currentPath = path;
        const libraryId = this.currentLibrary.id;

        try {
            if (this.activeTab === 'task') {
                const res = await fetch(`/api/media-libraries/${encodeURIComponent(libraryId)}/list?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
                const result = await this.parseResponse(res);
                if (this.currentLibrary?.id !== libraryId || this.currentPath !== path) return;
                this.renderFileList(Array.isArray(result.items) ? result.items : []);
                this.renderBreadcrumb(); this.renderLibraryToolbarState();
                return;
            }
            const res = await fetch(`/api/aasc/media-index?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
            const data = await this.parseResponse(res);
            if (!data.index) throw new Error('媒体索引响应缺少 index');

            const refreshed = this.flattenNetworkLibraries(data.index).find(library =>
                library.ownerNodeId === this.currentLibrary.ownerNodeId
                && library.sourceLibraryId === this.currentLibrary.sourceLibraryId
            );
            if (!refreshed) {
                throw new Error('当前媒体库在网络索引中不可用');
            }
            if (refreshed.error) {
                this.renderFileList([]);
                throw new Error(refreshed.error);
            }

            this.currentLibrary = { ...this.currentLibrary, ...refreshed };
            this.renderFileList(Array.isArray(refreshed.items) ? refreshed.items : []);
            this.renderBreadcrumb();
            this.renderLibraryToolbarState();
        } catch (err) {
            if (this.currentLibrary?.id !== libraryId || this.currentPath !== path) return;
            console.error('加载内容失败:', err);
            showToast(`加载媒体库失败：${err.message}`, 'error');
        }
    },
    
    async uploadFile(file, dirPath) {
        if (!this.currentLibrary) {
            showToast('请先选择媒体库', 'error');
            return { success: false, error: '请先选择媒体库' };
        }
        
        if (this.currentLibrary.readonly) {
            showToast('只读媒体库，无法上传', 'error');
            return { success: false, error: '只读媒体库，无法上传' };
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', dirPath || this.currentPath);
        
        try {
            const request = this.getLibraryRequest(this.currentLibrary, 'upload');
            const res = await fetch(request.url, {
                method: request.method,
                body: formData
            });
            const data = await this.parseResponse(res);
            return { success: true, data };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    
    async uploadFiles(files) {
        const fileArray = Array.from(files);
        const total = fileArray.length;
        let successCount = 0;
        let failCount = 0;
        
        showToast(`开始上传 ${total} 个文件...`, 'loading');
        
        for (let i = 0; i < fileArray.length; i++) {
            const file = fileArray[i];
            const result = await this.uploadFile(file);
            
            if (result.success) {
                successCount++;
            } else {
                failCount++;
                console.error(`上传失败: ${file.name}`, result.error);
            }
            
            if (i < fileArray.length - 1) {
                showToast(`上传中... (${i + 1}/${total})`, 'loading');
            }
        }
        
        await this.loadContent(this.currentPath);
        
        if (failCount === 0) {
            showToast(`上传完成: ${successCount} 个文件`, 'success');
        } else {
            showToast(`上传完成: 成功 ${successCount} 个，失败 ${failCount} 个`, 'warning');
        }
    },
    
    async uploadFolder(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;
        
        const folderName = this.extractFolderName(files[0]);
        if (!folderName) {
            showToast('无法识别文件夹', 'error');
            return;
        }
        
        showToast(`开始上传文件夹: ${folderName}`, 'loading');
        
        await this.createFolder(folderName);
        
        const folderPath = this.currentPath === '/' 
            ? '/' + folderName 
            : this.currentPath + '/' + folderName;
        
        const folderMap = new Map();
        
        files.forEach(file => {
            const relativePath = file.webkitRelativePath;
            const parts = relativePath.split('/');
            
            if (parts.length > 2) {
                const subFolderPath = '/' + parts.slice(1, -1).join('/');
                if (!folderMap.has(subFolderPath)) {
                    folderMap.set(subFolderPath, []);
                }
            }
        });
        
        for (const [subPath] of folderMap) {
            const fullPath = folderPath + subPath;
            await this.createFolderRecursive(fullPath);
        }
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relativePath = file.webkitRelativePath;
            const parts = relativePath.split('/');
            
            let targetPath;
            if (parts.length > 2) {
                targetPath = folderPath + '/' + parts.slice(1, -1).join('/');
            } else {
                targetPath = folderPath;
            }
            
            const result = await this.uploadFile(file, targetPath);
            
            if (result.success) {
                successCount++;
            } else {
                failCount++;
            }
            
            if (i < files.length - 1 && i % 5 === 0) {
                showToast(`上传中... (${i + 1}/${files.length})`, 'loading');
            }
        }
        
        await this.loadContent(this.currentPath);
        
        if (failCount === 0) {
            showToast(`文件夹上传完成: ${successCount} 个文件`, 'success');
        } else {
            showToast(`上传完成: 成功 ${successCount} 个，失败 ${failCount} 个`, 'warning');
        }
    },
    
    extractFolderName(file) {
        if (file.webkitRelativePath) {
            return file.webkitRelativePath.split('/')[0];
        }
        return null;
    },
    
    async createFolderRecursive(fullPath) {
        const parts = fullPath.split('/').filter(Boolean);
        let currentPath = '';
        
        for (const part of parts) {
            currentPath = currentPath + '/' + part;
            
            try {
                const request = this.getLibraryRequest(this.currentLibrary, 'createFolder');
                const res = await fetch(request.url, {
                    method: request.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        path: currentPath.substring(0, currentPath.lastIndexOf('/')) || '/', 
                        name: part 
                    })
                });
                await this.parseResponse(res);
            } catch (err) {
                console.error('创建文件夹失败:', err);
            }
        }
    },
    
    async deleteItem(itemPath, isFolder = false) {
        if (!this.currentLibrary) return;
        
        if (this.currentLibrary.readonly) {
            showToast('只读媒体库，无法删除', 'error');
            return;
        }
        
        if (!confirm(isFolder ? '确定删除此文件夹及其所有内容？' : '确定删除此文件？')) return;
        
        try {
            const operation = isFolder ? 'deleteFolder' : 'deleteFile';
            const request = this.getLibraryRequest(this.currentLibrary, operation);
            const res = await fetch(`${request.url}?path=${encodeURIComponent(itemPath)}`, {
                method: request.method
            });
            await this.parseResponse(res);
            showToast(isFolder ? '文件夹已删除' : '文件已删除', 'success');
            await this.loadContent(this.currentPath);
        } catch (err) {
            showToast('删除失败: ' + err.message, 'error');
        }
    },
    
    async createFolder(name) {
        if (!this.currentLibrary) return;
        
        if (this.currentLibrary.readonly) {
            showToast('只读媒体库，无法创建文件夹', 'error');
            return;
        }
        
        try {
            const request = this.getLibraryRequest(this.currentLibrary, 'createFolder');
            const res = await fetch(request.url, {
                method: request.method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.currentPath, name })
            });
            await this.parseResponse(res);
            showToast('文件夹已创建', 'success');
            await this.loadContent(this.currentPath);
        } catch (err) {
            showToast('创建失败: ' + err.message, 'error');
        }
    },
    
    navigateToFolder(folderPath) {
        this.loadContent(folderPath);
    },
    
    navigateUp() {
        if (this.currentPath === '/') return;
        const parts = this.currentPath.split('/').filter(Boolean);
        parts.pop();
        const parentPath = parts.length > 0 ? '/' + parts.join('/') : '/';
        this.loadContent(parentPath);
    },
    
    async playMedia(url, mediaType, fileName, format, fallbackUrl = '', cachePath = '') {
        clearTimeout(this.quarkCacheCardTimer);
        this.quarkCacheCard = null;
        this.updateQuarkCacheCards();
        const requestSequence = ++this.mediaPlaySequence;
        const directUrl = this.normalizePlaybackUrl(url);
        const safeFallbackUrl = this.normalizePlaybackUrl(fallbackUrl);
        let playbackUrl = directUrl || safeFallbackUrl;
        if (this.currentLibrary?.type === 'quark' && this.currentLibrary.remote && safeFallbackUrl) playbackUrl = new URL(safeFallbackUrl, window.location.origin).href;
        const sourceNodeId = this.currentLibrary?.remote
            ? String(this.currentLibrary.ownerNodeId || '')
            : 'main-server';
        if (!playbackUrl) {
            showToast('媒体地址不可用，无法播放', 'error');
            return;
        }
        if (mediaType === 'video' && this.currentLibrary?.type === 'quark') {
            const cacheIdentity = { cacheNodeId: sourceNodeId, cacheLibraryId: String(this.currentLibrary.sourceLibraryId || this.currentLibrary.id || ''), cachePath };
            showToast('正在缓存夸克视频，完成后开始播放…', 'loading');
            try {
                // 远程库优先使用主服务器同源代理，避免跨域或子服务器地址不可达。
                this.handleQuarkCacheProgress({ status: 'caching', fileName, ...cacheIdentity });
                await this.prepareQuarkVideo(this.currentLibrary.remote && safeFallbackUrl ? safeFallbackUrl : playbackUrl, progress => { if (requestSequence === this.mediaPlaySequence) this.handleQuarkCacheProgress({ ...progress, status: progress.phase === 'ready' ? 'ready' : 'progress', fileName, ...cacheIdentity }); });
                if (requestSequence !== this.mediaPlaySequence) return;
                this.handleQuarkCacheProgress({ status: 'ready', fileName, ...cacheIdentity });
            } catch (error) {
                if (requestSequence === this.mediaPlaySequence) { this.handleQuarkCacheProgress({ status: 'error', message: error.message, ...cacheIdentity }); showToast('夸克视频缓存失败：' + error.message, 'error'); }
                return;
            }
        }
        if (mediaType === 'html') {
            this.sendHtmlMedia(playbackUrl, directUrl ? safeFallbackUrl : '', sourceNodeId);
            return;
        }
        if (window.Crop) {
            window.Crop.showPreview(playbackUrl, mediaType);
        }

        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            const mediaData = {
                type: 'url',
                url: playbackUrl,
                mediaType: mediaType,
                sourceNodeId
            };
            if (directUrl && safeFallbackUrl && safeFallbackUrl !== directUrl) {
                mediaData.fallbackUrl = safeFallbackUrl;
            }
            if (mediaType === 'text') {
                mediaData.fileName = fileName;
                mediaData.format = format;
                mediaData.mimeType = format === 'markdown' ? 'text/markdown' : 'text/plain';
            }
            window.WebSocketManager.sendMedia(mediaData);
        }

        this.setCurrentMedia(playbackUrl);
    },

    // HTML 媒体：不弹滚动设置（沿用显示面板「HTML 播放模式」），直接发送
    sendHtmlMedia(url, fallbackUrl = '', sourceNodeId = 'main-server') {
        if (window.Crop) {
            window.Crop.showPreview(url, 'html');
        }
        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            window.WebSocketManager.sendMedia({
                type: 'url',
                url: url,
                mediaType: 'html',
                sourceNodeId,
                ...(fallbackUrl && fallbackUrl !== url ? { fallbackUrl } : {})
            });
        }
        this.setCurrentMedia(url);
    },

    // 批量播放模式设置框（媒体库与临时模式共用）
    showPlaylistSettingsDialog(options = {}) {
        const { title = '批量播放设置', hideRecursive = false, bilibiliOnly = false, onConfirm } = options;
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="playlist-settings-dialog">
                <div class="dialog-title">${title}</div>
                <div class="dialog-body">
                    ${hideRecursive ? '' : `
                    <div class="settings-row">
                        <span class="settings-label">扫描范围</span>
                        <label><input type="radio" name="plRecursive" value="false" checked> 当前文件夹</label>
                        <label><input type="radio" name="plRecursive" value="true"> 递归子文件夹</label>
                    </div>`}
                    <div class="settings-row">
                        <span class="settings-label">间隔时间</span>
                        <input type="number" id="plInterval" value="5" min="1" class="settings-input"> 秒
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">播放模式</span>
                        <label><input type="radio" name="plMode" value="sequence" checked> 顺序</label>
                        <label><input type="radio" name="plMode" value="random"> 随机</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">排序方式</span>
                        <label><input type="radio" name="plSortBy" value="name" checked> ${bilibiliOnly ? '按标题' : '按文件名'}</label>
                        <label><input type="radio" name="plSortBy" value="time"> ${bilibiliOnly ? '按加入顺序' : '按时间'}</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">播放方向</span>
                        <label><input type="radio" name="plDirection" value="asc" checked> 正序</label>
                        <label><input type="radio" name="plDirection" value="desc"> 反序</label>
                    </div>
                    ${bilibiliOnly ? '' : `<div class="settings-row">
                        <span class="settings-label">媒体类型</span>
                        <label><input type="checkbox" name="plMediaType" value="text" checked> 文本</label>
                        <label><input type="checkbox" name="plMediaType" value="audio" checked> 音频</label>
                        <label><input type="checkbox" name="plMediaType" value="image" checked> 图片</label>
                        <label><input type="checkbox" name="plMediaType" value="video" checked> 视频</label>
                        <label><input type="checkbox" name="plMediaType" value="web" checked> 网页</label>
                    </div>`}
                    <div class="settings-row">
                        <span class="settings-label">循环播放</span>
                        <input type="checkbox" id="plLoop" checked>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">播报文件名</span>
                        <input type="checkbox" id="plAnnounceName">
                    </div>
                </div>
                <div class="dialog-footer">
                    <button class="btn-cancel" id="plCancelBtn">取消</button>
                    <button class="btn-confirm" id="plConfirmBtn">开始播放</button>
                </div>
            </div>`;
        document.body.appendChild(mask);

        // 随机模式下排序/方向置灰
        const onModeChange = () => {
            const random = mask.querySelector('input[name="plMode"]:checked').value === 'random';
            const rows = mask.querySelectorAll('.settings-row');
            rows.forEach(row => {
                const label = row.querySelector('.settings-label');
                if (label && (label.textContent === '排序方式' || label.textContent === '播放方向')) {
                    const inputs = row.querySelectorAll('input');
                    inputs.forEach(inp => { inp.disabled = random; });
                    row.style.opacity = random ? '0.4' : '1';
                }
            });
        };
        mask.querySelectorAll('input[name="plMode"]').forEach(r => r.addEventListener('change', onModeChange));

        mask.querySelector('#plCancelBtn').addEventListener('click', () => mask.remove());
        mask.querySelector('#plConfirmBtn').addEventListener('click', () => {
            const settings = {
                recursive: mask.querySelector('input[name="plRecursive"]:checked')?.value === 'true',
                interval: parseInt(mask.querySelector('#plInterval').value) || 5,
                mode: mask.querySelector('input[name="plMode"]:checked').value,
                sortBy: mask.querySelector('input[name="plSortBy"]:checked').value,
                direction: mask.querySelector('input[name="plDirection"]:checked').value,
                mediaTypes: Array.from(mask.querySelectorAll('input[name="plMediaType"]:checked')).map((input) => input.value),
                loop: mask.querySelector('#plLoop').checked,
                announceName: mask.querySelector('#plAnnounceName').checked
            };
            mask.remove();
            if (typeof onConfirm === 'function') {
                onConfirm(settings);
            }
        });
    },

    // 媒体面板「发送 HTML」：选择本地 .html 文件 → 滚动设置 + 去向 → 发送
    async sendHtmlFile(file) {
        if (!file) {
            showToast('请选择 .html 文件', 'error');
            return;
        }
        if (!/\.(html|htm)$/i.test(file.name)) {
            showToast('请选择 .html/.htm 文件', 'error');
            return;
        }
        const result = await this._showHtmlFileDialog(file);
        if (!result) {
            showToast('已取消发送', 'warning');
            return;
        }
        const { saveToLibrary } = result;
        if (saveToLibrary) {
            if (!this.currentLibrary) {
                showToast('请先选择媒体库', 'error');
                return;
            }
            if (this.currentLibrary.readonly) {
                showToast('只读媒体库，无法保存', 'error');
                return;
            }
            const up = await this.uploadFile(file, this.currentPath);
            if (!up.success) {
                showToast('保存到媒体库失败: ' + up.error, 'error');
                return;
            }
            const url = up.data.file.url;
            if (window.Crop) {
                window.Crop.showPreview(url, 'html');
            }
            if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
                window.WebSocketManager.sendMedia({
                    type: 'url',
                    url: url,
                    mediaType: 'html'
                });
            }
            this.setCurrentMedia(url);
            showToast('已保存到媒体库并发送', 'success');
            return;
        }
        // 临时发送：base64 直传
        const base64 = await window.Upload.fileToBase64(file);
        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            window.WebSocketManager.sendMedia({
                type: 'base64',
                data: base64,
                fileName: file.name,
                mediaType: 'html',
                mimeType: file.type || 'text/html',
                temp: true
            });
        }
        if (window.Crop) {
            window.Crop.showPreview('data:text/html;base64,' + base64, 'html');
        }
        showToast('已发送到显示端', 'success');
    },

    // 发送 HTML 文件对话框：文件信息 + 去向，返回 Promise<{saveToLibrary}|null>
    // 滚动模式不在此设置（沿用显示面板「HTML 播放模式」）
    _showHtmlFileDialog(file) {
        return new Promise((resolve) => {
            const sizeText = file.size > 1024 ? (file.size / 1024).toFixed(1) + ' KB' : file.size + ' B';
            const mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = `
                <div class="playlist-settings-dialog">
                    <div class="dialog-title">发送 HTML</div>
                    <div class="dialog-body">
                        <div class="settings-row">
                            <span class="settings-label">文件</span>
                            <span style="color:#4f9cf7;font-weight:500;word-break:break-all;">${this._escapeHtml(file.name)}（${sizeText}）</span>
                        </div>
                        <div class="settings-row">
                            <span class="settings-label">去向</span>
                            <label><input type="checkbox" id="sendHtmlSaveToLibrary"> 同时保存到媒体库（当前目录）</label>
                        </div>
                    </div>
                    <div class="dialog-footer">
                        <button class="btn-cancel" id="sendHtmlCancelBtn">取消</button>
                        <button class="btn-confirm" id="sendHtmlConfirmBtn">发送</button>
                    </div>
                </div>`;
            mask.querySelector('#sendHtmlCancelBtn').addEventListener('click', () => {
                mask.remove();
                resolve(null);
            });
            mask.querySelector('#sendHtmlConfirmBtn').addEventListener('click', () => {
                const saveToLibrary = mask.querySelector('#sendHtmlSaveToLibrary').checked;
                mask.remove();
                resolve({ saveToLibrary });
            });
            document.body.appendChild(mask);
        });
    },

    _escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    },

    handleQuarkDirectoryDownload(job) {
        const panel = document.getElementById('quarkDirectoryDownloadStatus');
        if (!panel || !job) return;
        panel.style.display = '';
        const count = `已下载 ${job.completed || 0}，已存在 ${job.skipped || 0}`;
        const percent = job.total ? ` ${Math.min(100, Math.floor((job.received || 0) * 100 / job.total))}%` : '';
        const label = job.fileMode ? '文件' : '目录';
        panel.textContent = job.status === 'done' ? `${label}下载完成：${count}` : job.status === 'error' ? `${label}下载失败：${job.message || '未知错误'}（${count}）` : `正在下载${label}：${count}${job.fileName ? ` · ${job.fileName}${percent}` : ''}`;
        if (job.status === 'done') this.refreshQuarkDownloadedState(job);
    },

    // 下载完成后刷新卡片状态；根目录任务同时把分享卡片标记为已下载。
    refreshQuarkDownloadedState(job) {
        if (this.currentLibrary?.type === 'quark') void this.loadContent(this.currentPath);
        if (job?.dirPath !== '/' || !job?.source) return;
        const id = job.source.nodeId === 'main-server' ? String(job.source.libraryId) : `${job.source.nodeId}::${job.source.libraryId}`;
        const library = this.libraries.find(lib => lib.id === id);
        if (!library) return;
        library.downloaded = true;
        if (this.activeTab === 'quark' && this.currentLibrary?.type !== 'quark') this.renderQuarkShares();
    },

    showQuarkDirectoryDownloadDialog(folderPath, sourceLibrary = null) {
        const source = sourceLibrary || this.currentLibrary;
        if (!source || source.type !== 'quark') return;
        const targets = this.libraries.filter(lib => lib.type === 'local' && !lib.readonly && !lib.remote && lib.isLocal !== false);
        if (!targets.length) { showToast('请先添加主服务器上的可写本地媒体库', 'error'); return; }
        const mask = document.createElement('div'); mask.className = 'modal-mask';
        const dialog = document.createElement('div'); dialog.className = 'playlist-settings-dialog';
        const title = document.createElement('div'); title.className = 'dialog-title'; title.textContent = '下载文件夹到本地媒体库';
        const body = document.createElement('div'); body.className = 'dialog-body';
        const description = document.createElement('p'); description.textContent = `来源目录：${folderPath || '/'}（包含子文件夹）`;
        const select = document.createElement('select'); select.setAttribute('aria-label', '目标本地媒体库');
        for (const lib of targets) { const option = document.createElement('option'); option.value = lib.sourceLibraryId || lib.id; option.textContent = lib.name; select.appendChild(option); }
        body.append(description, select);
        const footer = document.createElement('div'); footer.className = 'dialog-footer';
        const cancel = document.createElement('button'); cancel.className = 'btn-cancel'; cancel.textContent = '取消'; cancel.onclick = () => mask.remove();
        const start = document.createElement('button'); start.className = 'btn-confirm'; start.textContent = '开始下载';
        start.onclick = async () => {
            start.disabled = true;
            try {
                const response = await fetch('/api/quark-directory-downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: source.remote ? source.ownerNodeId : 'main-server', libraryId: source.sourceLibraryId || source.id, targetId: select.value, path: folderPath || '/' }) });
                const result = await this.parseResponse(response);
                this.handleQuarkDirectoryDownload(result.job); mask.remove();
            } catch (error) { showToast(`目录下载失败：${error.message}`, 'error'); start.disabled = false; }
        };
        footer.append(cancel, start); dialog.append(title, body, footer); mask.appendChild(dialog); document.body.appendChild(mask);
    },

    // 单文件下载到本地媒体库，复用目录下载的目标库选择对话框样式与状态面板。
    showQuarkFileDownloadDialog(filePath) {
        const source = this.currentLibrary;
        if (!source || source.type !== 'quark') return;
        const targets = this.libraries.filter(lib => lib.type === 'local' && !lib.readonly && !lib.remote && lib.isLocal !== false);
        if (!targets.length) { showToast('请先添加主服务器上的可写本地媒体库', 'error'); return; }
        const meta = this.quarkFileMeta?.get(filePath) || {};
        const mask = document.createElement('div'); mask.className = 'modal-mask';
        const dialog = document.createElement('div'); dialog.className = 'playlist-settings-dialog';
        const title = document.createElement('div'); title.className = 'dialog-title'; title.textContent = '下载文件到本地媒体库';
        const body = document.createElement('div'); body.className = 'dialog-body';
        const description = document.createElement('p'); description.textContent = `来源文件：${filePath}`;
        const select = document.createElement('select'); select.setAttribute('aria-label', '目标本地媒体库');
        for (const lib of targets) { const option = document.createElement('option'); option.value = lib.sourceLibraryId || lib.id; option.textContent = lib.name; select.appendChild(option); }
        body.append(description, select);
        const footer = document.createElement('div'); footer.className = 'dialog-footer';
        const cancel = document.createElement('button'); cancel.className = 'btn-cancel'; cancel.textContent = '取消'; cancel.onclick = () => mask.remove();
        const start = document.createElement('button'); start.className = 'btn-confirm'; start.textContent = '开始下载';
        start.onclick = async () => {
            start.disabled = true;
            try {
                const response = await fetch('/api/quark-file-downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodeId: source.remote ? source.ownerNodeId : 'main-server', libraryId: source.sourceLibraryId || source.id, targetId: select.value, path: filePath, size: meta.size, modifiedTime: meta.modifiedTime }) });
                const result = await this.parseResponse(response);
                this.handleQuarkDirectoryDownload(result.job); mask.remove();
            } catch (error) { showToast(`文件下载失败：${error.message}`, 'error'); start.disabled = false; }
        };
        footer.append(cancel, start); dialog.append(title, body, footer); mask.appendChild(dialog); document.body.appendChild(mask);
    },

    // 媒体库文件夹批量播放入口
    showBatchPlayDialog(folderPath) {
        if (!this.currentLibrary) {
            showToast('请先选择媒体库', 'error');
            return;
        }
        this.showPlaylistSettingsDialog({
            onConfirm: (settings) => {
                this.mediaPlaySequence++;
                this._lastCropPreviewUrl = null;
                this.tempPlaylistFiles = null;
                const ok = window.WebSocketManager.sendPlaylistRequest({
                    libraryId: this.currentLibrary.sourceLibraryId || this.currentLibrary.id,
                    libraryType: this.currentLibrary.type,
                    ...(this.currentLibrary.remote ? { remoteNodeId: this.currentLibrary.ownerNodeId } : {}),
                    path: folderPath,
                    ...settings
                });
                if (ok) {
                    showToast('批量播放请求已发送', 'success');
                }
            }
        });
    },

    // 批量播放进度面板（动态创建）
    ensurePlaylistPanel() {
        let panel = document.getElementById('playlistProgressPanel');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'playlistProgressPanel';
        panel.className = 'playlist-progress-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <span id="plProgressText" class="pl-progress-text"></span>
            <span class="pl-controls">
                <button id="plToggleBtn" onclick="MediaLibrary.controlPlaylist('toggle', this)">暂停</button>
                <button onclick="MediaLibrary.controlPlaylist('prev')">上一个</button>
                <button onclick="MediaLibrary.controlPlaylist('next')">下一个</button>
                <button onclick="MediaLibrary.controlPlaylist('stop')">停止</button>
            </span>`;
        const content = document.getElementById('mediaLibraryContent');
        const parent = content ? content.parentElement : document.body;
        parent.insertBefore(panel, content || null);
        return panel;
    },

    // 切换显示端或收到无批量状态时，清理上一个显示端遗留的批量 UI 和临时预览标记。
    clearPlaylistPanel() {
        ['playlistProgressPanel', 'displayPlaylistStatus', 'floatingPlaylistStatus'].forEach((id) => {
            const panel = document.getElementById(id);
            if (panel) panel.style.display = 'none';
        });
        this._lastCropPreviewUrl = null;
        this.removeTempPreviewPlaceholder();
    },

    // 批量播放进度：同步更新 媒体库面板/显示控制界面/快捷控制面板/裁剪预览区
    renderPlaylistPanel(info) {
        if (!info || info.state === 'stopped' || info.state === 'finished') {
            this.clearPlaylistPanel();
            return;
        }
        this.renderMediaLibraryPanel(info);
        this.renderDisplayControlPanel(info);
        this.renderFloatingControlPanel(info);
        this.updateCropPreview(info);
    },

    setPendingTempPlaylistFiles(files) {
        this.tempPlaylistFiles = Array.isArray(files) ? files : null;
    },

    handleTempPlaylistStarted(playlist) {
        if (!Array.isArray(playlist) || playlist.length === 0) {
            return;
        }

        if (window.TempPlaylistPreview) {
            this.tempPlaylistFiles = window.TempPlaylistPreview.buildServerOrderedFiles(playlist, this.tempPlaylistFiles);
        } else {
            this.tempPlaylistFiles = playlist;
        }
        this._lastCropPreviewUrl = null;
    },

    // 画面裁剪预览区跟随批量播放的当前项
    updateCropPreview(info) {
        if (!window.Crop) return;
        if (!info || info.state === 'stopped' || info.state === 'finished') return;
        let url = info.url;
        if (url) {
            if (url === this._lastCropPreviewUrl) return;
            this._lastCropPreviewUrl = url;
            window.Crop.showPreview(url, info.mediaType || 'image', undefined, info.fileName);
            this.removeTempPreviewPlaceholder();
            return;
        }
        // 临时模式：优先用控制端缓存数据
        if (this.tempPlaylistFiles) {
            const item = window.TempPlaylistPreview
                ? window.TempPlaylistPreview.findCachedFile(this.tempPlaylistFiles, info)
                : this.tempPlaylistFiles[info.index || 0];
            if (item && item.data) {
                const dataUrl = 'data:' + (item.mimeType || 'application/octet-stream') + ';base64,' + item.data;
                if (dataUrl === this._lastCropPreviewUrl) return;
                this._lastCropPreviewUrl = dataUrl;
                window.Crop.showPreview(dataUrl, item.mediaType || 'image', undefined, item.fileName);
                this.removeTempPreviewPlaceholder();
                return;
            }
        }
        // 控制端刷新后缓存丢失：显示占位提示（尺寸用显示端回传）
        this.showTempPreviewPlaceholder(info);
    },

    // 临时模式数据不可用时在裁剪预览区显示占位提示（批量/单文件共用）
    showTempPreviewPlaceholder(info) {
        const container = document.getElementById('cropPreviewContainer');
        if (!container) return;
        const key = 'placeholder:' + (info.fileName || info.index || 0);
        if (this._lastCropPreviewUrl === key) return;
        this._lastCropPreviewUrl = key;
        this.removeTempPreviewPlaceholder();
        const dim = info.width && info.height ? ` · ${info.width}x${info.height}` : '';
        const pos = info.total ? `第 ${(info.index || 0) + 1}/${info.total} 项 · ` : '';
        const div = document.createElement('div');
        div.className = 'temp-preview-placeholder';
        div.textContent = `临时模式数据不可预览（控制端刷新后缓存丢失）\n${pos}${info.fileName || ''}${dim}`;
        container.appendChild(div);
        // 无媒体数据时也显示裁剪框，允许拖动/缩放发送裁剪指令到显示端
        if (window.Crop) {
            window.Crop.box.style.display = 'block';
            window.Crop.updateBox();
        }
    },

    // 单文件临时媒体：控制端刷新后本地无预览数据，显示占位提示
    handleTempMediaInfo(info) {
        const sent = this.lastTempFileSent;
        if (sent && sent.name === info.fileName) {
            // 未刷新，本地已有预览
            this.removeTempPreviewPlaceholder();
            return;
        }
        this.showTempPreviewPlaceholder(info);
    },

    removeTempPreviewPlaceholder() {
        const old = document.querySelector('.temp-preview-placeholder');
        if (old) old.remove();
        // 重置占位 key，允许后续同名文件重新显示占位
        if (this._lastCropPreviewUrl && this._lastCropPreviewUrl.startsWith('placeholder:')) {
            this._lastCropPreviewUrl = null;
        }
    },

    renderMediaLibraryPanel(info) {
        const panel = this.ensurePlaylistPanel();
        if (!info || info.state === 'stopped' || info.state === 'finished') {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'flex';
        const stateText = { playing: '▶ 播放中', paused: '⏸ 已暂停' }[info.state] || info.state;
        const textProgress = info.mediaType === 'text' && Number.isFinite(info.pageTotal)
            ? ` · 文档第 ${(info.pageIndex || 0) + 1}/${info.pageTotal} 页`
            : '';
        document.getElementById('plProgressText').textContent =
            `第 ${(info.index || 0) + 1}/${info.total} 项 · ${info.fileName || ''}${textProgress} · ${stateText}`;
        const toggleBtn = document.getElementById('plToggleBtn');
        toggleBtn.textContent = info.state === 'paused' ? '继续' : '暂停';
        toggleBtn.dataset.action = info.state === 'paused' ? 'resume' : 'pause';
    },

    // 显示控制界面的批量播放状态
    renderDisplayControlPanel(info) {
        const panel = document.getElementById('displayPlaylistStatus');
        if (!panel) return;
        if (!info || info.state === 'stopped' || info.state === 'finished') {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'flex';
        const stateText = { playing: '▶ 播放中', paused: '⏸ 已暂停' }[info.state] || info.state;
        const textProgress = info.mediaType === 'text' && Number.isFinite(info.pageTotal)
            ? ` · 文档第 ${(info.pageIndex || 0) + 1}/${info.pageTotal} 页`
            : '';
        document.getElementById('displayPlText').textContent =
            `第 ${(info.index || 0) + 1}/${info.total} 项 · ${info.fileName || ''}${textProgress} · ${stateText}`;
        const toggleBtn = document.getElementById('displayPlToggleBtn');
        toggleBtn.textContent = info.state === 'paused' ? '继续' : '暂停';
        toggleBtn.dataset.action = info.state === 'paused' ? 'resume' : 'pause';
        toggleBtn.classList.toggle('playing', info.state === 'playing');
        toggleBtn.classList.toggle('paused', info.state === 'paused');
    },

    // 快捷控制面板的批量播放状态
    renderFloatingControlPanel(info) {
        const panel = document.getElementById('floatingPlaylistStatus');
        if (!panel) return;
        if (!info || info.state === 'stopped' || info.state === 'finished') {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = '';
        const stateText = { playing: '▶ 播放中', paused: '⏸ 已暂停' }[info.state] || info.state;
        const textProgress = info.mediaType === 'text' && Number.isFinite(info.pageTotal)
            ? ` · 文档第 ${(info.pageIndex || 0) + 1}/${info.pageTotal} 页`
            : '';
        document.getElementById('floatingPlText').textContent =
            `第 ${(info.index || 0) + 1}/${info.total} 项 · ${info.fileName || ''}${textProgress} · ${stateText}`;
        const toggleBtn = document.getElementById('floatingPlToggleBtn');
        toggleBtn.textContent = info.state === 'paused' ? '继续' : '暂停';
        toggleBtn.dataset.action = info.state === 'paused' ? 'resume' : 'pause';
        toggleBtn.classList.toggle('playing', info.state === 'playing');
        toggleBtn.classList.toggle('paused', info.state === 'paused');
    },

    controlPlaylist(action, btn) {
        const displayIds = window.DisplayList ? window.DisplayList.getSelectedDisplayIds() : [];
        if (displayIds.length === 0) {
            showToast('请先选择显示端', 'error');
            return;
        }
        if (action === 'toggle') {
            action = btn && btn.dataset.action === 'resume' ? 'resume' : 'pause';
        }
        window.WebSocketManager.sendPlaylistControl(displayIds, action);
    },

    setCurrentMedia(url, title = '') {
        this.currentMediaUrl = url;
        const current = this.parseBilibiliCurrent(url);
        const key = current ? `${current.bvid}:${current.page}` : '';
        if (key !== this.bilibiliCurrentKey) {
            this.bilibiliCurrentKey = key;
            if (current) void this.loadBilibiliRelated(current, title);
            else {
                this.bilibiliRelatedSequence++;
                const related = document.getElementById('bilibiliRelated');
                const list = document.getElementById('bilibiliRelatedList');
                if (related) related.hidden = true;
                if (list) list.replaceChildren();
            }
        }

        
        document.querySelectorAll('.media-library-item').forEach(el => {
            const itemUrl = el.dataset.url;
            const badge = el.querySelector('.playing-badge');
            
            if (itemUrl === url) {
                el.classList.add('playing');
                if (!badge) {
                    const wrapper = el.querySelector('.media-thumb-wrapper');
                    if (wrapper) {
                        const newBadge = document.createElement('span');
                        newBadge.className = 'playing-badge';
                        newBadge.textContent = '正在播放';
                        wrapper.appendChild(newBadge);
                    }
                }
            } else {
                el.classList.remove('playing');
                if (badge) badge.remove();
            }
        });
    },
    
    render() {
        this.renderTabs();
        this.renderLibraryList();
        this.renderBreadcrumb();
    },
    
    renderLibraryList() {
        const container = document.getElementById('mediaLibraryList');
        if (!container) return;
        
        const visibleLibraries = this.libraries.filter(lib => !['quark', 'task'].includes(lib.type));
        if (visibleLibraries.length === 0) {
            container.innerHTML = `
                <div class="empty-list">${this.activeTab === 'quark' ? '暂无夸克分享' : '暂无媒体库'}</div>
                <button class="library-add-btn" onclick="MediaLibrary.showAddLibraryDialog()" title="添加媒体库">+ 添加</button>
            `;
            return;
        }
        
        container.innerHTML = visibleLibraries.map(lib => `
            <div class="library-item ${lib.id === this.currentLibrary?.id ? 'active' : ''}" 
                 onclick="MediaLibrary.switchLibrary('${lib.id}')"
                 title="${lib.name}">
                <span class="library-icon">${this.getLibraryIcon(lib.type)}</span>
                <span class="library-name">${lib.name}</span>
                ${lib.remote ? `<span class="library-owner">${lib.ownerNodeName || lib.ownerNodeId}</span>` : '<span class="library-owner">主服务器</span>'}
                ${lib.isDefault ? '<span class="library-default">默认</span>' : ''}
                ${lib.readonly ? '<span class="library-readonly">只读</span>' : ''}
                <button class="library-edit-btn" onclick="event.stopPropagation(); MediaLibrary.showEditLibraryDialog('${lib.id}')" title="编辑">⚙️</button>
            </div>
        `).join('') + `
            <button class="library-add-btn" onclick="MediaLibrary.showAddLibraryDialog()" title="添加媒体库">+ 添加</button>
        `;
    },
    
    renderBreadcrumb() {
        const container = document.getElementById('mediaLibraryBreadcrumb');
        if (!container) return;
        
        const parts = this.currentPath.split('/').filter(Boolean);
        let path = '';
        
        let html = `<span class="breadcrumb-item" onclick="MediaLibrary.loadContent('/')">根目录</span>`;
        
        parts.forEach(part => {
            path += '/' + part;
            html += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item" onclick="MediaLibrary.loadContent('${path}')">${part}</span>`;
        });
        
        container.innerHTML = html;
    },
    
    renderFileList(items) {
        const container = document.getElementById('mediaLibraryContent');
        if (!container) return;

        // 缓存文件条目元数据，单文件下载时提交 size/modifiedTime 生成与目录下载一致的指纹。
        this.quarkFileMeta = this.currentLibrary?.type === 'quark'
            ? new Map(items.filter(item => item.type !== 'folder').map(item => [item.path, item]))
            : null;

        if (items.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无文件</div>';
            return;
        }
        
        container.innerHTML = items.map(item => {
            const isFolder = item.type === 'folder';
            const directUrl = this.normalizePlaybackUrl(item?.directUrl || item?.url);
            const fallbackUrl = this.getPlaybackFallbackUrl(item);
            const playbackUrl = directUrl || fallbackUrl;
            // 文件夹本身没有媒体 URL，但必须保留目录导航入口；只有文件条目才需要校验播放地址。
            if (!playbackUrl && !isFolder) {
                return `<div class="media-library-item unavailable">
                    <div class="media-thumb-wrapper"><div class="media-thumb audio-thumb">⚠️</div></div>
                    <div class="item-name">${this._escapeHtml(item.name || '未命名媒体')}</div>
                    <div class="item-meta">媒体地址不可用</div>
                </div>`;
            }
            const fallbackAttributes = fallbackUrl
                ? `data-fallback-url="${this._escapeHtml(fallbackUrl)}" onerror="if (this.dataset.fallbackUrl && this.src !== this.dataset.fallbackUrl) { this.src = this.dataset.fallbackUrl; }"`
                : '';
            const writeAction = this.currentLibrary?.readonly
                ? ''
                : `<button class="btn-delete" onclick="event.stopPropagation(); MediaLibrary.deleteItem('${item.path}', true)">删除</button>`;
            if (isFolder) {
                return `
                    <div class="media-library-item folder" data-directory-path="${this._escapeHtml(item.path || '')}" onclick="MediaLibrary.navigateToFolder('${item.path}')">
                        <div class="folder-icon">📁</div>
                        <div class="item-name">${this._escapeHtml(item.name || '')}</div>
                        <div class="item-actions">
                            <button class="btn-batch" onclick="event.stopPropagation(); MediaLibrary.showBatchPlayDialog('${item.path}')">批量播放</button>
                            ${this.currentLibrary?.type === 'quark' ? `<button class="btn-download" ${item.downloaded ? 'disabled' : ''} onclick="event.stopPropagation(); MediaLibrary.showQuarkDirectoryDownloadDialog(this.closest('.media-library-item').dataset.directoryPath)">${item.downloaded ? '已下载' : (item.downloadedCount ? `已下载 ${item.downloadedCount}` : '下载到媒体库')}</button>` : ''}
                            ${writeAction}
                        </div>
                    </div>
                `;
            } else {
                const isPlaying = this.currentMediaUrl === playbackUrl
                    || this.currentMediaUrl === directUrl;
                let thumbHtml;
                
                if (item.mediaType === 'video' && this.currentLibrary?.type === 'quark') {
                    if (item.hasThumbnail) {
                        const thumb = new URL(playbackUrl, window.location.href); thumb.searchParams.set('thumbnail', '1');
                        let thumbFallback = '';
                        if (directUrl && fallbackUrl) { const fallback = new URL(fallbackUrl, window.location.href); fallback.searchParams.set('thumbnail', '1'); thumbFallback = fallback.href; }
                        thumbHtml = `<img class="media-thumb" src="${this._escapeHtml(thumb.href)}" data-thumb-fallback="${this._escapeHtml(thumbFallback)}" alt="视频缩略图" loading="lazy" onerror="if(this.dataset.thumbFallback &amp;&amp; this.src !== this.dataset.thumbFallback){this.src=this.dataset.thumbFallback}else{this.style.display='none';this.nextElementSibling.style.display='flex'}">` + '<div class="media-thumb audio-thumb" style="display:none" aria-label="夸克视频">🎬</div>';
                    } else thumbHtml = '<div class="media-thumb audio-thumb" aria-label="夸克视频">🎬</div>';
                } else if (item.mediaType === 'video') {
                    thumbHtml = `<video class="media-thumb" src="${this._escapeHtml(playbackUrl)}" ${fallbackAttributes} muted preload="metadata" onloadeddata="this.currentTime=0.1"></video>`;
                } else if (item.mediaType === 'audio') {
                    // 音频没有画面，使用稳定的占位图标，避免 img 请求音频导致破图。
                    thumbHtml = '<div class="media-thumb audio-thumb" aria-label="音频">🎵</div>';
                } else if (item.mediaType === 'text') {
                    thumbHtml = '<div class="media-thumb" style="background:#f4d35e;color:#3d3d3d" aria-label="文本">📄</div>';
                } else {
                    thumbHtml = `<img class="media-thumb" src="${this._escapeHtml(playbackUrl)}" ${fallbackAttributes} loading="lazy">`;
                }
                
                const isQuarkVideo = item.mediaType === 'video' && this.currentLibrary?.type === 'quark';
                const cacheKey = isQuarkVideo ? this.cacheCardKey({ cacheNodeId: this.currentLibrary.remote ? String(this.currentLibrary.ownerNodeId || '') : 'main-server', cacheLibraryId: String(this.currentLibrary.sourceLibraryId || this.currentLibrary.id || ''), cachePath: item.path }) : '';
                return `
                    <div class="media-library-item ${isPlaying ? 'playing' : ''}" data-url="${this._escapeHtml(playbackUrl)}" ${cacheKey ? `data-cache-key="${this._escapeHtml(cacheKey)}" data-cache-path="${this._escapeHtml(item.path)}"` : ''}>
                        <div class="media-thumb-wrapper">
                            ${thumbHtml}
                            ${isQuarkVideo ? '<div class="quark-card-cache" hidden><span></span><progress max="100"></progress></div>' : ''}
                            ${isPlaying ? '<span class="playing-badge">正在播放</span>' : ''}
                        </div>
                        <div class="item-name">${this._escapeHtml(item.name || '')}</div>
                        <div class="item-meta">${item.mediaType} · ${this.formatSize(item.size)}</div>
                        <div class="item-actions">
                            <button class="btn-play" onclick="MediaLibrary.playMedia('${this._escapeHtml(playbackUrl)}', '${this._escapeHtml(item.mediaType)}', '${this._escapeHtml(item.name)}', '${this._escapeHtml(item.format || '')}', '${this._escapeHtml(directUrl ? fallbackUrl : '')}', this.closest('.media-library-item').dataset.cachePath || '')">播放</button>
                            ${this.currentLibrary?.type === 'quark'
                                ? `<button class="btn-download" ${item.downloaded ? 'disabled' : ''} onclick="event.stopPropagation(); MediaLibrary.showQuarkFileDownloadDialog('${this._escapeHtml(item.path)}')">${item.downloaded ? '已下载' : '下载'}</button>`
                                : ''}
                            ${this.currentLibrary?.readonly ? '' : `<button class="btn-delete" onclick="MediaLibrary.deleteItem('${item.path}')">删除</button>`}
                        </div>
                    </div>
                `;
            }
        }).join('');
        this.updateQuarkCacheCards();
    },
    
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    
    getLibraryIcon(type) {
        const icons = { local: '💾', http: '🌐', smb: '🖥️', quark: '☁️', task: '🧩' };
        return icons[type] || '📁';
    },
    
    setupDragDrop() {
        const container = document.getElementById('mediaLibraryContent');
        if (!container) return;
        
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            container.classList.add('drag-over');
        });
        
        container.addEventListener('dragleave', (e) => {
            if (!container.contains(e.relatedTarget)) {
                container.classList.remove('drag-over');
            }
        });
        
        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            container.classList.remove('drag-over');
            
            const items = e.dataTransfer.items;
            const files = e.dataTransfer.files;
            
            if (items) {
                const hasFolder = Array.from(items).some(item => 
                    item.webkitGetAsEntry && item.webkitGetAsEntry()?.isDirectory
                );
                
                if (hasFolder) {
                    const entries = await this.getEntriesFromDataTransfer(items);
                    await this.uploadEntries(entries);
                    return;
                }
            }
            
            if (files.length > 0) {
                const hasFolder = Array.from(files).some(f => f.webkitRelativePath);
                if (hasFolder) {
                    await this.uploadFolder(files);
                } else {
                    await this.uploadFiles(files);
                }
            }
        });
    },
    
    async getEntriesFromDataTransfer(items) {
        const entries = [];
        
        for (const item of items) {
            if (item.webkitGetAsEntry) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    entries.push(entry);
                }
            }
        }
        
        return entries;
    },
    
    async uploadEntries(entries) {
        for (const entry of entries) {
            if (entry.isDirectory) {
                await this.uploadDirectoryEntry(entry, this.currentPath);
            } else {
                const file = await this.getFileFromEntry(entry);
                if (file) {
                    await this.uploadFile(file);
                }
            }
        }
        
        await this.loadContent(this.currentPath);
        showToast('文件夹上传完成', 'success');
    },
    
    async uploadDirectoryEntry(dirEntry, basePath) {
        const folderPath = basePath === '/' 
            ? '/' + dirEntry.name 
            : basePath + '/' + dirEntry.name;
        
        await this.createFolder(dirEntry.name);
        
        const reader = dirEntry.createReader();
        const entries = await new Promise((resolve, reject) => {
            reader.readEntries(resolve, reject);
        });
        
        for (const entry of entries) {
            if (entry.isDirectory) {
                await this.uploadDirectoryEntry(entry, folderPath);
            } else {
                const file = await this.getFileFromEntry(entry);
                if (file) {
                    await this.uploadFile(file, folderPath);
                }
            }
        }
    },
    
    getFileFromEntry(entry) {
        return new Promise((resolve, reject) => {
            entry.file(resolve, reject);
        });
    },
    
    showCreateFolderDialog() {
        const name = prompt('请输入文件夹名称:');
        if (name && name.trim()) {
            this.createFolder(name.trim());
        }
    },
    
    async setDefaultLibrary(id) {
        const library = this.libraries.find(item => item.id === id);
        const request = this.getLibraryRequest(library, 'setDefault');
        if (!request) return;
        try {
            const res = await fetch(request.url, { method: request.method });
            await this.parseResponse(res);
            this.libraries = this.libraries.map(lib => ({
                ...lib,
                isDefault: lib.id === id
            }));
            this.renderLibraryList();
            showToast('已设为默认媒体库', 'success');
        } catch (err) {
            showToast('设置失败: ' + err.message, 'error');
        }
    },
    
    getTargetNodes(targetNodeId = '') {
        const sources = Array.isArray(this.networkIndex?.sources) ? this.networkIndex.sources : [];
        const nodes = sources.map(source => source?.node || {})
            .filter(node => node.nodeId && (node.nodeId === 'main-server' || node.status !== 'offline'))
            .map(node => ({
                nodeId: String(node.nodeId),
                name: node.name || node.nodeId,
                isLocal: node.nodeId === 'main-server'
            }));
        if (!nodes.some(node => node.isLocal)) {
            nodes.unshift({ nodeId: 'main-server', name: '主服务器', isLocal: true });
        }
        if (targetNodeId && !nodes.some(node => node.nodeId === targetNodeId)) {
            nodes.push({ nodeId: targetNodeId, name: targetNodeId, isLocal: false });
        }
        return nodes;
    },

    showAddLibraryDialog(targetNodeId = 'main-server', initialType = 'local') {
        const existingModal = document.getElementById('libraryModal');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.id = 'libraryModal';
        modal.className = 'library-modal';
        modal.innerHTML = `
            <div class="library-modal-content">
                <div class="library-modal-header">
                    <h3>添加媒体库</h3>
                    <button class="modal-close" onclick="this.closest('.library-modal').remove()">×</button>
                </div>
                <div class="library-modal-body">
                    <div class="form-group">
                        <label>目标服务器</label>
                        <select id="libTargetNode">
                            ${this.getTargetNodes(targetNodeId).map(node => `<option value="${node.nodeId}" ${node.nodeId === targetNodeId ? 'selected' : ''}>${node.name}${node.isLocal ? '（本机）' : '（在线）'}</option>`).join('')}
                        </select>
                        <small class="library-form-help">本地磁盘路径按目标服务器的文件系统解析。</small>
                    </div>
                    <div class="form-group">
                        <label>名称 <span class="required">*</span></label>
                        <input type="text" id="libName" placeholder="输入媒体库名称">
                    </div>
                    <div class="form-group">
                        <label>类型</label>
                        <select id="libType" onchange="MediaLibrary.onTypeChange(this.value)">
                            <option value="local">本地磁盘</option>
                            <option value="http">HTTP远程</option>
                            <option value="smb">SMB网络共享</option>
                            <option value="quark">夸克网盘分享</option>
                            <option value="task">用户任务媒体源</option>
                        </select>
                    </div>
                    <div class="form-group" id="libPathGroup">
                        <label>路径</label>
                        <input type="text" id="libPath" placeholder="例如: ./uploads 或 /data/media">
                    </div>
                    <div class="form-group http-only" style="display:none;">
                        <label>URL</label>
                        <input type="text" id="libUrl" placeholder="例如: http://192.168.1.100/media">
                    </div>
                    <div class="form-group task-only" style="display:none;">
                        <label>媒体源</label>
                        <select id="libTaskProvider"><option value="">请先启动媒体源任务</option></select>
                    </div>
                    <div class="form-group task-only" style="display:none;">
                        <label>来源地址</label>
                        <input type="url" id="libTaskUrl" placeholder="输入任务支持的网站或清单地址">
                        <small>可用来源由运行中的本机用户服务任务提供。</small>
                    </div>
                    <div class="form-group quark-only" style="display:none;">
                        <label>分享链接 <span class="required">*</span></label>
                        <input type="url" id="libQuarkUrl" placeholder="https://pan.quark.cn/s/...">
                        <small>只读；支持目录浏览、图片预览和视频播放。视频需要在服务端配置夸克 Cookie。</small>
                    </div>
                    <div class="form-group quark-only" style="display:none;">
                        <label>提取码（可选）</label>
                        <input type="password" id="libQuarkPasscode" autocomplete="off">
                    </div>
                    <div class="form-group http-only smb-only" style="display:none;">
                        <label>用户名</label>
                        <input type="text" id="libUsername" placeholder="用户名（可选）">
                    </div>
                    <div class="form-group http-only smb-only" style="display:none;">
                        <label>密码</label>
                        <input type="password" id="libPassword" placeholder="密码（可选）">
                    </div>
                    <div class="form-group smb-only" style="display:none;">
                        <label>服务器地址 <span class="required">*</span></label>
                        <input type="text" id="libServer" placeholder="例如: 192.168.1.100">
                    </div>
                    <div class="form-group smb-only" style="display:none;">
                        <label>共享路径 <span class="required">*</span></label>
                        <input type="text" id="libShare" placeholder="例如: share 或 share/subfolder">
                    </div>
                    <div class="form-group smb-only" style="display:none;">
                        <label>域</label>
                        <input type="text" id="libDomain" placeholder="域（可选）">
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="libReadonly">
                            只读模式（禁止上传和删除）
                        </label>
                    </div>
                </div>
                <div class="library-modal-footer">
                    <button class="btn-cancel" onclick="this.closest('.library-modal').remove()">取消</button>
                    <button class="btn-save" onclick="MediaLibrary.addLibraryFromForm()">添加</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('libType').value = initialType;
        this.onTypeChange(document.getElementById('libType').value);
        void this.loadTaskMediaProviders();
    },
    
    async loadTaskMediaProviders() {
        try {
            const result = await this.parseResponse(await fetch('/api/media-library-providers'));
            const select = document.getElementById('libTaskProvider');
            if (!select) return;
            select.replaceChildren();
            for (const provider of result.providers || []) {
                const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.name; select.appendChild(option);
            }
            if (!select.options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = '请先启动媒体源任务'; select.appendChild(option); }
        } catch { /* 未连接时保留提示。 */ }
    },

    showEditLibraryDialog(id) {
        const lib = this.libraries.find(l => l.id === id);
        if (!lib) return;
        
        const existingModal = document.getElementById('libraryModal');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.id = 'libraryModal';
        modal.className = 'library-modal';
        modal.dataset.libraryId = id;
        modal.innerHTML = `
            <div class="library-modal-content">
                <div class="library-modal-header">
                    <h3>编辑媒体库</h3>
                    <button class="modal-close" onclick="this.closest('.library-modal').remove()">×</button>
                </div>
                <div class="library-modal-body">
                    <div class="form-group">
                        <label>名称 <span class="required">*</span></label>
                        <input type="text" id="libName" value="${lib.name || ''}" placeholder="输入媒体库名称">
                    </div>
                    <div class="form-group">
                        <label>类型</label>
                        <select id="libType" disabled>
                            <option value="local" ${lib.type === 'local' ? 'selected' : ''}>本地磁盘</option>
                            <option value="http" ${lib.type === 'http' ? 'selected' : ''}>HTTP远程</option>
                            <option value="smb" ${lib.type === 'smb' ? 'selected' : ''}>SMB网络共享</option>
                            <option value="quark" ${lib.type === 'quark' ? 'selected' : ''}>夸克网盘分享</option>
                            <option value="task" ${lib.type === 'task' ? 'selected' : ''}>用户任务媒体源</option>
                        </select>
                        <small style="color: rgba(255,255,255,0.5);">类型创建后不可修改</small>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="libReadonly" ${lib.readonly ? 'checked' : ''} ${['quark', 'task'].includes(lib.type) ? 'disabled' : ''}>
                            只读模式（禁止上传和删除）
                        </label>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="libDefault" ${lib.isDefault ? 'checked' : ''}>
                            设为默认媒体库
                        </label>
                    </div>
                </div>
                <div class="library-modal-footer">
                    <button class="btn-delete" onclick="MediaLibrary.deleteLibrary('${id}')">删除</button>
                    <button class="btn-cancel" onclick="this.closest('.library-modal').remove()">取消</button>
                    <button class="btn-save" onclick="MediaLibrary.updateLibraryFromForm('${id}')">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },
    
    onTypeChange(type) {
        document.querySelectorAll('.http-only').forEach(el => {
            el.style.display = (type === 'http' || type === 'smb') ? 'block' : 'none';
        });
        document.querySelectorAll('.smb-only').forEach(el => {
            el.style.display = type === 'smb' ? 'block' : 'none';
        });
        document.querySelectorAll('.quark-only').forEach(el => { el.style.display = type === 'quark' ? 'block' : 'none'; });
        document.querySelectorAll('.task-only').forEach(el => { el.style.display = type === 'task' ? 'block' : 'none'; });
        document.getElementById('libPathGroup').style.display = type === 'local' ? 'block' : 'none';
        const readonly = document.getElementById('libReadonly');
        readonly.disabled = ['quark', 'task'].includes(type);
        if (readonly.disabled) readonly.checked = true;
    },
    
    async addLibraryFromForm() {
        const name = document.getElementById('libName').value.trim();
        const type = document.getElementById('libType').value;
        const targetNodeId = document.getElementById('libTargetNode')?.value || 'main-server';
        
        if (!name) {
            showToast('请输入媒体库名称', 'error');
            return;
        }
        
        const config = { name, type };
        
        if (type === 'local') {
            config.path = document.getElementById('libPath').value.trim() || './uploads';
        } else if (type === 'http') {
            config.url = document.getElementById('libUrl').value.trim();
            config.username = document.getElementById('libUsername').value.trim();
            config.password = document.getElementById('libPassword').value;
            if (!config.url) {
                showToast('请输入HTTP URL', 'error');
                return;
            }
        } else if (type === 'task') {
            if (targetNodeId !== 'main-server') { showToast('任务媒体源请先选择主服务器', 'error'); return; }
            config.providerId = document.getElementById('libTaskProvider').value;
            config.url = document.getElementById('libTaskUrl').value.trim();
            if (!config.providerId) { showToast('请先启动媒体源任务', 'error'); return; }
            if (!config.url) { showToast('请输入来源地址', 'error'); return; }
        } else if (type === 'quark') {
            config.url = document.getElementById('libQuarkUrl').value.trim();
            config.passcode = document.getElementById('libQuarkPasscode').value.trim();
            if (!config.url) { showToast('请输入夸克分享链接', 'error'); return; }
        } else if (type === 'smb') {
            config.server = document.getElementById('libServer').value.trim();
            config.share = document.getElementById('libShare').value.trim();
            config.username = document.getElementById('libUsername').value.trim();
            config.password = document.getElementById('libPassword').value;
            config.domain = document.getElementById('libDomain').value.trim();
            if (!config.server) {
                showToast('请输入SMB服务器地址', 'error');
                return;
            }
            if (!config.share) {
                showToast('请输入SMB共享路径', 'error');
                return;
            }
        }
        
        config.readonly = document.getElementById('libReadonly').checked;
        
        try {
            showToast('正在添加媒体库...', 'loading');
            
            const endpoint = targetNodeId === 'main-server'
                ? '/api/media-libraries'
                : `/api/aasc/servers/${encodeURIComponent(targetNodeId)}/media-libraries`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            await this.parseResponse(res);
            showToast(targetNodeId === 'main-server' ? '媒体库添加成功' : '已下发到子服务器并添加成功', 'success');
            document.getElementById('libraryModal').remove();
            await this.loadLibraries();
            this.render();
        } catch (err) {
            showToast('添加失败: ' + err.message, 'error');
        }
    },
    
    async updateLibraryFromForm(id) {
        const name = document.getElementById('libName').value.trim();
        const library = this.libraries.find(item => item.id === id);
        const request = this.getLibraryRequest(library, 'update');
        
        if (!name) {
            showToast('请输入媒体库名称', 'error');
            return;
        }
        
        const updates = {
            name,
            readonly: document.getElementById('libReadonly').checked,
            isDefault: document.getElementById('libDefault').checked
        };
        
        try {
            const res = await fetch(request.url, {
                method: request.method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            await this.parseResponse(res);
            showToast('媒体库已更新', 'success');
            document.getElementById('libraryModal').remove();
            await this.loadLibraries();
            this.render();
        } catch (err) {
            showToast('更新失败: ' + err.message, 'error');
        }
    },
    
    async deleteLibrary(id) {
        if (!confirm('确定删除此媒体库？此操作不会删除实际文件。')) return;
        const library = this.libraries.find(item => item.id === id);
        const request = this.getLibraryRequest(library, 'remove');
        if (!request) return;
        
        try {
            const res = await fetch(request.url, { method: request.method });
            await this.parseResponse(res);
            showToast('媒体库已删除', 'success');
            if (library?.type === 'quark' && this.shareFolders.quark.entries[id]) this.sendShareFolder('shareFolderMove', { category: 'quark', key: id, folderId: '' });
            document.getElementById('libraryModal').remove();
            if (this.currentLibrary?.id === id) {
                this.currentLibrary = null;
            }
            await this.loadLibraries();
            this.render();
        } catch (err) {
            showToast('删除失败: ' + err.message, 'error');
        }
    }
};

window.MediaLibrary = MediaLibrary;
