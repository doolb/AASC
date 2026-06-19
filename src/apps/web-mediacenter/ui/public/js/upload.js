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
    }
};

window.uploadByUrl = Upload.uploadByUrl.bind(Upload);
window.Upload = Upload;
