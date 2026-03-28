const Upload = {
    detectMediaType(name) {
        const ext = name.toLowerCase().split('.').pop().split('?')[0];
        if (['gif'].includes(ext)) return 'gif';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        return 'image';
    },
    
    async uploadFile(file) {
        if (!window.currentDisplayId) {
            showToast('请先选择显示端', 'error');
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
                if (window.MediaList) {
                    window.MediaList.load();
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
