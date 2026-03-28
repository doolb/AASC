const MediaList = {
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    
    detectMediaType(name) {
        const ext = name.toLowerCase().split('.').pop().split('?')[0];
        if (['gif'].includes(ext)) return 'gif';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        return 'image';
    },
    
    async load() {
        try {
            const res = await fetch('/media-list');
            const data = await res.json();
            if (data.status === 'success') {
                this.render(data.list);
            }
        } catch (err) {
            console.error('加载媒体列表失败:', err);
        }
    },
    
    render(list) {
        const container = document.getElementById('mediaList');
        
        if (list.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无资源</div>';
            return;
        }
        
        container.innerHTML = list.map(item => {
            let thumbHtml;
            if (item.mediaType === 'video') {
                thumbHtml = `<video class="media-thumb" src="${item.url}" muted preload="metadata" onloadeddata="this.currentTime=0.1"></video>`;
            } else {
                thumbHtml = `<img class="media-thumb" src="${item.url}" loading="lazy">`;
            }
            
            return `
                <div class="media-item" data-url="${item.url}">
                    ${thumbHtml}
                    <div class="media-info">
                        <div class="media-name" title="${item.name}">${item.name}</div>
                        <div class="media-meta">${item.mediaType} · ${this.formatSize(item.size)}</div>
                    </div>
                    <div class="media-actions">
                        <button class="btn-play" onclick="MediaList.play('${item.url}', event)">播放</button>
                        <button class="btn-delete" onclick="MediaList.delete('${item.name}', event)">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    play(url, event) {
        event.stopPropagation();
        
        const mediaType = this.detectMediaType(url);
        
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
        
        document.querySelectorAll('.media-item').forEach(el => el.classList.remove('active'));
        event.target.closest('.media-item').classList.add('active');
    },
    
    async delete(name, event) {
        event.stopPropagation();
        
        if (!confirm('确定删除此文件？')) return;
        
        try {
            const res = await fetch(`/media/${encodeURIComponent(name)}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            
            if (data.status === 'success') {
                showToast('已删除', 'success');
                this.load();
            } else {
                showToast('删除失败', 'error');
            }
        } catch (err) {
            showToast('删除失败', 'error');
        }
    }
};

window.loadMediaList = MediaList.load.bind(MediaList);
window.MediaList = MediaList;
