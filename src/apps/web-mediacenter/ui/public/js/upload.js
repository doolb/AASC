const Upload = {
    detectMediaType(name) {
        const ext = name.toLowerCase().split('.').pop().split('?')[0];
        if (['gif'].includes(ext)) return 'gif';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        return 'image';
    },

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.includes(',') ? reader.result.split(',')[1] : reader.result;
                resolve(base64);
            };
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsDataURL(file);
        });
    },

    getMediaDimensions(file, base64) {
        const dataUrl = 'data:application/octet-stream;base64,' + base64;
        const mediaType = this.detectMediaType(file.name);
        return new Promise((resolve) => {
            if (mediaType === 'video') {
                const video = document.createElement('video');
                video.onloadedmetadata = () => {
                    resolve({ width: video.videoWidth, height: video.videoHeight });
                    video.remove();
                };
                video.onerror = () => resolve(null);
                video.preload = 'metadata';
                video.src = dataUrl;
            } else {
                const img = new Image();
                img.onload = () => {
                    resolve({ width: img.naturalWidth, height: img.naturalHeight });
                    img.remove();
                };
                img.onerror = () => resolve(null);
                img.src = dataUrl;
            }
        });
    },
    
    async uploadFile(file) {
        if (!window.currentDisplayId) {
            showToast('请先选择显示端', 'error');
            return;
        }

        const tempMode = document.getElementById('tempMode')?.checked;
        if (tempMode) {
            const maxSizeMB = parseInt(document.getElementById('tempMaxSize')?.value || '300') || 300;
            const maxSizeBytes = maxSizeMB * 1024 * 1024;
            if (file.size > maxSizeBytes) {
                showToast(`临时模式文件大小不能超过 ${maxSizeMB}MB`, 'error');
                return;
            }

            showToast('正在读取文件...', 'loading');

            try {
                const base64 = await this.fileToBase64(file);
                const mediaType = this.detectMediaType(file.name);
                const dims = await this.getMediaDimensions(file, base64);

                if (window.WebSocketManager) {
                    window.WebSocketManager.sendMedia({
                        type: 'base64',
                        data: base64,
                        fileName: file.name,
                        mediaType: mediaType,
                        mimeType: file.type || undefined,
                        temp: true,
                        width: dims?.width,
                        height: dims?.height
                    });
                }
                const dataUrl = 'data:' + (file.type || 'application/octet-stream') + ';base64,' + base64;
                if (window.Crop) {
                    window.Crop.showPreview(dataUrl, mediaType, () => {
                        window.Crop.updateBox();
                    });
                }
                showToast('已发送到显示端', 'success');
            } catch (err) {
                showToast('发送失败: ' + err.message, 'error');
            }
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('displayId', window.currentDisplayId);
        
        showToast('正在上传...', 'loading');
        
        try {
            const res = await fetch('/upload-file', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (data.status === 'success') {
                showToast('上传成功！', 'success');
                if (window.MediaLibrary) {
                    window.MediaLibrary.loadContent(window.MediaLibrary.currentPath);
                }
            } else {
                showToast('上传失败: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('上传失败: ' + err, 'error');
        }
    },
    
    async sendTempFile(file) {
        const maxSizeBytes = 300 * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            showToast('文件大小不能超过 300MB', 'error');
            return;
        }

        showToast('正在读取文件...', 'loading');

        try {
            const base64 = await this.fileToBase64(file);
            const mediaType = this.detectMediaType(file.name);
            const dims = await this.getMediaDimensions(file, base64);

            if (window.WebSocketManager) {
                window.WebSocketManager.sendMedia({
                    type: 'base64',
                    data: base64,
                    fileName: file.name,
                    mediaType: mediaType,
                    mimeType: file.type || undefined,
                    temp: true,
                    width: dims?.width,
                    height: dims?.height
                });
            }
            const dataUrl = 'data:' + (file.type || 'application/octet-stream') + ';base64,' + base64;
            if (window.Crop) {
                window.Crop.showPreview(dataUrl, mediaType, () => {
                    window.Crop.updateBox();
                });
            }
            showToast('已发送到显示端', 'success');
        } catch (err) {
            showToast('发送失败: ' + err.message, 'error');
        }
    },

    // 处理拖入/粘贴的多文件（含文件夹递归收集）
    async handleDroppedFiles(dataTransfer) {
        const files = [];
        const entries = Array.from(dataTransfer.items || [])
            .map(i => (i.webkitGetAsEntry && i.webkitGetAsEntry()) || null);
        const hasDir = entries.some(e => e && e.isDirectory);
        if (hasDir) {
            // 含文件夹：递归收集
            for (const entry of entries) {
                if (!entry) continue;
                if (entry.isDirectory) {
                    await this.collectDir(entry, files);
                } else if (entry.isFile) {
                    await this.collectFile(entry, files);
                }
            }
        } else {
            for (const f of dataTransfer.files) files.push(f);
        }
        if (files.length === 0) return;
        if (files.length === 1) {
            this.sendTempFile(files[0]);
        } else {
            this.showBatchTempUpload(files);
        }
    },

    collectFile(entry, out) {
        return new Promise(resolve => {
            entry.file(f => { out.push(f); resolve(); }, () => resolve());
        });
    },

    async collectDir(entry, out) {
        const reader = entry.createReader();
        const readAll = () => new Promise(resolve => {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) { resolve(); return; }
                for (const e of entries) {
                    if (e.isDirectory) {
                        await this.collectDir(e, out);
                    } else if (e.isFile) {
                        await this.collectFile(e, out);
                    }
                }
                await readAll();
                resolve();
            }, () => resolve());
        });
        await readAll();
    },

    // 批量临时文件转为 base64 数组
    async prepareTempFiles(files) {
        const totalBytes = files.reduce((s, f) => s + f.size, 0);
        // base64 膨胀约 33%，预留 500MB maxPayload 余量
        if (totalBytes > 350 * 1024 * 1024) {
            showToast('批量临时文件总大小不能超过 350MB', 'error');
            return null;
        }
        for (const f of files) {
            if (f.size > 300 * 1024 * 1024) {
                showToast(`${f.name} 超过 300MB，已跳过`, 'error');
            }
        }
        showToast('正在读取文件...', 'loading');
        const items = [];
        for (const f of files) {
            try {
                const base64 = await this.fileToBase64(f);
                const dims = await this.getMediaDimensions(f, base64);
                items.push({
                    name: f.name,
                    data: base64,
                    mediaType: this.detectMediaType(f.name),
                    mimeType: f.type || undefined,
                    modifiedTime: f.lastModified,
                    width: dims?.width,
                    height: dims?.height
                });
            } catch (err) {
                showToast(`读取 ${f.name} 失败: ${err.message}`, 'error');
            }
        }
        return items;
    },

    // 弹出共用设置框，确认后批量发送
    showBatchTempUpload(files) {
        if (!window.MediaLibrary) {
            showToast('媒体库模块未初始化', 'error');
            return;
        }
        window.MediaLibrary.showPlaylistSettingsDialog({
            title: '临时模式批量播放设置',
            hideRecursive: true,
            onConfirm: async (settings) => {
                const items = await this.prepareTempFiles(files);
                if (!items || items.length === 0) return;
                // 缓存文件数据供裁剪预览区跟随批量播放当前项
                window.MediaLibrary.tempPlaylistFiles = items;
                window.MediaLibrary._lastCropPreviewUrl = null;
                if (window.WebSocketManager) {
                    window.WebSocketManager.sendPlaylistRequest({
                        temp: true,
                        files: items,
                        ...settings
                    });
                    showToast('批量播放请求已发送', 'success');
                }
            }
        });
    },

    uploadByUrl() {
        const urlInput = document.getElementById('urlInput');
        const url = urlInput.value.trim();
        
        if (!url) {
            showToast('请输入URL', 'error');
            return;
        }
        
        const mediaType = this.detectMediaType(url);
        
        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            window.WebSocketManager.sendMedia({
                type: 'url',
                url: url,
                mediaType: mediaType
            });
        }
        
        urlInput.value = '';
    },
    
    init() {
        const imageInput = document.getElementById('imageInput');
        const videoInput = document.getElementById('videoInput');
        const urlInput = document.getElementById('urlInput');
        
        if (imageInput) {
            imageInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.uploadFile(file);
                e.target.value = '';
            });
        }
        
        if (videoInput) {
            videoInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) this.uploadFile(file);
                e.target.value = '';
            });
        }
        
        if (urlInput) {
            urlInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.uploadByUrl();
            });
        }

        const previewContainer = document.getElementById('cropPreviewContainer');
        if (previewContainer) {
            previewContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                previewContainer.classList.add('drag-over');
            });
            previewContainer.addEventListener('dragleave', () => {
                previewContainer.classList.remove('drag-over');
            });
            previewContainer.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                previewContainer.classList.remove('drag-over');
                this.handleDroppedFiles(e.dataTransfer);
            });
        }

        document.addEventListener('paste', (e) => {
            const panel = document.getElementById('panel-display');
            if (!panel || panel.style.display === 'none') return;
            const file = e.clipboardData?.files?.[0];
            if (file) { this.sendTempFile(file); return; }
            for (const item of e.clipboardData?.items || []) {
                if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
                    const blob = item.getAsFile();
                    if (blob) {
                        const ext = item.type.split('/')[1] || 'png';
                        const named = new File([blob], `clipboard_${Date.now()}.${ext}`, { type: item.type });
                        this.sendTempFile(named);
                    }
                    break;
                }
            }
        });
    }
};

window.uploadByUrl = Upload.uploadByUrl.bind(Upload);
window.Upload = Upload;
