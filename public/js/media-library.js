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
            </div>
        `).join('');
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
    }
};

window.MediaLibrary = MediaLibrary;
