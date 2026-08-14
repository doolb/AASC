const MediaLibrary = {
    libraries: [],
    currentLibrary: null,
    currentPath: '/',
    currentMediaUrl: null,
    
    async init() {
        await this.loadLibraries();
        this.setupDragDrop();
        this.render();
    },
    
    async loadLibraries() {
        try {
            const res = await fetch('/api/media-libraries');
            const data = await res.json();
            
            if (data.status === 'success') {
                this.libraries = data.libraries;
                
                if (this.libraries.length > 0) {
                    const defaultId = data.defaultLibraryId || this.libraries[0].id;
                    await this.switchLibrary(defaultId);
                }
            }
        } catch (err) {
            console.error('加载媒体库列表失败:', err);
        }
    },
    
    async switchLibrary(id) {
        this.currentLibrary = this.libraries.find(l => l.id === id);
        this.currentPath = '/';
        await this.loadContent('/');
    },
    
    async loadContent(path) {
        if (!this.currentLibrary) return;
        
        this.currentPath = path;
        
        try {
            const res = await fetch(`/api/media-libraries/${this.currentLibrary.id}/list?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            
            if (data.status === 'success') {
                this.renderFileList(data.items);
                this.renderBreadcrumb();
            }
        } catch (err) {
            console.error('加载内容失败:', err);
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
            const res = await fetch(`/api/media-libraries/${this.currentLibrary.id}/upload`, {
                method: 'POST',
                body: formData
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                return { success: true, data };
            } else {
                return { success: false, error: data.message };
            }
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
                await fetch(`/api/media-libraries/${this.currentLibrary.id}/folder`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        path: currentPath.substring(0, currentPath.lastIndexOf('/')) || '/', 
                        name: part 
                    })
                });
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
            const endpoint = isFolder ? 'folder' : 'file';
            const res = await fetch(`/api/media-libraries/${this.currentLibrary.id}/${endpoint}?path=${encodeURIComponent(itemPath)}`, {
                method: 'DELETE'
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                showToast(isFolder ? '文件夹已删除' : '文件已删除', 'success');
                await this.loadContent(this.currentPath);
            } else {
                showToast('删除失败: ' + data.message, 'error');
            }
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
            const res = await fetch(`/api/media-libraries/${this.currentLibrary.id}/folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.currentPath, name })
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                showToast('文件夹已创建', 'success');
                await this.loadContent(this.currentPath);
            } else {
                showToast('创建失败: ' + data.message, 'error');
            }
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
    
    playMedia(url, mediaType) {
        if (window.Crop) {
            window.Crop.showPreview(url, mediaType);
        }
        
        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            window.WebSocketManager.sendMedia({
                type: 'url',
                url: url,
                mediaType: mediaType
            });
        }
        
        this.setCurrentMedia(url);
    },
    
    // 批量播放模式设置框（媒体库与临时模式共用）
    showPlaylistSettingsDialog(options = {}) {
        const { title = '批量播放设置', hideRecursive = false, onConfirm } = options;
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
                        <label><input type="radio" name="plSortBy" value="name" checked> 按文件名</label>
                        <label><input type="radio" name="plSortBy" value="time"> 按时间</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">播放方向</span>
                        <label><input type="radio" name="plDirection" value="asc" checked> 正序</label>
                        <label><input type="radio" name="plDirection" value="desc"> 反序</label>
                    </div>
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
                loop: mask.querySelector('#plLoop').checked,
                announceName: mask.querySelector('#plAnnounceName').checked
            };
            mask.remove();
            if (typeof onConfirm === 'function') {
                onConfirm(settings);
            }
        });
    },

    // 媒体库文件夹批量播放入口
    showBatchPlayDialog(folderPath) {
        if (!this.currentLibrary) {
            showToast('请先选择媒体库', 'error');
            return;
        }
        this.showPlaylistSettingsDialog({
            onConfirm: (settings) => {
                const ok = window.WebSocketManager.sendPlaylistRequest({
                    libraryId: this.currentLibrary.id,
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

    // 批量播放进度：同步更新 媒体库面板/显示控制界面/快捷控制面板
    renderPlaylistPanel(info) {
        this.renderMediaLibraryPanel(info);
        this.renderDisplayControlPanel(info);
        this.renderFloatingControlPanel(info);
    },

    renderMediaLibraryPanel(info) {
        const panel = this.ensurePlaylistPanel();
        if (!info || info.state === 'stopped' || info.state === 'finished') {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'flex';
        const stateText = { playing: '▶ 播放中', paused: '⏸ 已暂停' }[info.state] || info.state;
        document.getElementById('plProgressText').textContent =
            `第 ${(info.index || 0) + 1}/${info.total} 项 · ${info.fileName || ''} · ${stateText}`;
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
        document.getElementById('displayPlText').textContent =
            `第 ${(info.index || 0) + 1}/${info.total} 项 · ${info.fileName || ''} · ${stateText}`;
        const toggleBtn = document.getElementById('displayPlToggleBtn');
        toggleBtn.textContent = info.state === 'paused' ? '继续' : '暂停';
        toggleBtn.dataset.action = info.state === 'paused' ? 'resume' : 'pause';
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
        document.getElementById('floatingPlText').textContent =
            `第 ${(info.index || 0) + 1}/${info.total} 项 · ${info.fileName || ''} · ${stateText}`;
        const toggleBtn = document.getElementById('floatingPlToggleBtn');
        toggleBtn.textContent = info.state === 'paused' ? '继续' : '暂停';
        toggleBtn.dataset.action = info.state === 'paused' ? 'resume' : 'pause';
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

    setCurrentMedia(url) {
        this.currentMediaUrl = url;
        
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
        this.renderLibraryList();
        this.renderBreadcrumb();
    },
    
    renderLibraryList() {
        const container = document.getElementById('mediaLibraryList');
        if (!container) return;
        
        if (this.libraries.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无媒体库</div>';
            return;
        }
        
        container.innerHTML = this.libraries.map(lib => `
            <div class="library-item ${lib.id === this.currentLibrary?.id ? 'active' : ''}" 
                 onclick="MediaLibrary.switchLibrary('${lib.id}')"
                 title="${lib.name}">
                <span class="library-icon">${this.getLibraryIcon(lib.type)}</span>
                <span class="library-name">${lib.name}</span>
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
        
        if (items.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无文件</div>';
            return;
        }
        
        container.innerHTML = items.map(item => {
            if (item.type === 'folder') {
                return `
                    <div class="media-library-item folder" onclick="MediaLibrary.navigateToFolder('${item.path}')">
                        <div class="folder-icon">📁</div>
                        <div class="item-name">${item.name}</div>
                        <div class="item-actions">
                            <button class="btn-batch" onclick="event.stopPropagation(); MediaLibrary.showBatchPlayDialog('${item.path}')">批量播放</button>
                            <button class="btn-delete" onclick="event.stopPropagation(); MediaLibrary.deleteItem('${item.path}', true)">删除</button>
                        </div>
                    </div>
                `;
            } else {
                const isPlaying = this.currentMediaUrl === item.url;
                let thumbHtml;
                
                if (item.mediaType === 'video') {
                    thumbHtml = `<video class="media-thumb" src="${item.url}" muted preload="metadata" onloadeddata="this.currentTime=0.1"></video>`;
                } else {
                    thumbHtml = `<img class="media-thumb" src="${item.url}" loading="lazy">`;
                }
                
                return `
                    <div class="media-library-item ${isPlaying ? 'playing' : ''}" data-url="${item.url}">
                        <div class="media-thumb-wrapper">
                            ${thumbHtml}
                            ${isPlaying ? '<span class="playing-badge">正在播放</span>' : ''}
                        </div>
                        <div class="item-name">${item.name}</div>
                        <div class="item-meta">${item.mediaType} · ${this.formatSize(item.size)}</div>
                        <div class="item-actions">
                            <button class="btn-play" onclick="MediaLibrary.playMedia('${item.url}', '${item.mediaType}')">播放</button>
                            <button class="btn-delete" onclick="MediaLibrary.deleteItem('${item.path}')">删除</button>
                        </div>
                    </div>
                `;
            }
        }).join('');
    },
    
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    
    getLibraryIcon(type) {
        const icons = { local: '💾', http: '🌐', smb: '🖥️' };
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
        try {
            const res = await fetch(`/api/media-libraries/${id}/set-default`, {
                method: 'POST'
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                this.libraries = this.libraries.map(lib => ({
                    ...lib,
                    isDefault: lib.id === id
                }));
                this.renderLibraryList();
                showToast('已设为默认媒体库', 'success');
            }
        } catch (err) {
            showToast('设置失败: ' + err.message, 'error');
        }
    },
    
    showAddLibraryDialog() {
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
                        <label>名称 <span class="required">*</span></label>
                        <input type="text" id="libName" placeholder="输入媒体库名称">
                    </div>
                    <div class="form-group">
                        <label>类型</label>
                        <select id="libType" onchange="MediaLibrary.onTypeChange(this.value)">
                            <option value="local">本地磁盘</option>
                            <option value="http">HTTP远程</option>
                            <option value="smb">SMB网络共享</option>
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
                        </select>
                        <small style="color: rgba(255,255,255,0.5);">类型创建后不可修改</small>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="libReadonly" ${lib.readonly ? 'checked' : ''}>
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
        document.getElementById('libPathGroup').style.display = type === 'local' ? 'block' : 'none';
    },
    
    async addLibraryFromForm() {
        const name = document.getElementById('libName').value.trim();
        const type = document.getElementById('libType').value;
        
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
            
            const res = await fetch('/api/media-libraries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                showToast('媒体库添加成功', 'success');
                document.getElementById('libraryModal').remove();
                await this.loadLibraries();
                this.render();
            } else {
                showToast('添加失败: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('添加失败: ' + err.message, 'error');
        }
    },
    
    async updateLibraryFromForm(id) {
        const name = document.getElementById('libName').value.trim();
        
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
            const res = await fetch(`/api/media-libraries/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                showToast('媒体库已更新', 'success');
                document.getElementById('libraryModal').remove();
                await this.loadLibraries();
                this.render();
            } else {
                showToast('更新失败: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('更新失败: ' + err.message, 'error');
        }
    },
    
    async deleteLibrary(id) {
        if (!confirm('确定删除此媒体库？此操作不会删除实际文件。')) return;
        
        try {
            const res = await fetch(`/api/media-libraries/${id}`, {
                method: 'DELETE'
            });
            
            const data = await res.json();
            
            if (data.status === 'success') {
                showToast('媒体库已删除', 'success');
                document.getElementById('libraryModal').remove();
                
                if (this.currentLibrary?.id === id) {
                    this.currentLibrary = null;
                }
                
                await this.loadLibraries();
                this.render();
            } else {
                showToast('删除失败: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('删除失败: ' + err.message, 'error');
        }
    }
};

window.MediaLibrary = MediaLibrary;
