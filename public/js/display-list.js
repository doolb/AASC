const DisplayList = {
    list: [],
    
    render() {
        const container = document.getElementById('displayList');
        
        if (this.list.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无显示端连接</div>';
            window.currentDisplayId = null;
            return;
        }
        
        container.innerHTML = this.list.map(d => {
            let browserInfoHtml = '';
            if (d.browserInfo) {
                const bi = d.browserInfo;
                browserInfoHtml = `
                    <div class="browser-info" style="font-size:11px;color:#888;margin-top:4px;">
                        <span title="${bi.userAgent}">${bi.browserName} ${bi.browserVersion}</span>
                        <span style="margin:0 4px;">|</span>
                        <span>${bi.os}</span>
                        <span style="margin:0 4px;">|</span>
                        <span>${bi.deviceType}</span>
                        <span style="margin:0 4px;">|</span>
                        <span>${bi.screenWidth}x${bi.screenHeight}</span>
                        ${bi.devicePixelRatio > 1 ? `<span style="margin:0 4px;">|</span><span>${bi.devicePixelRatio}x</span>` : ''}
                    </div>
                `;
            }
            return `
                <div class="display-item ${d.id === window.currentDisplayId ? 'active' : ''}" onclick="DisplayList.select('${d.id}')">
                    <div style="flex:1;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span class="display-item-id">${d.ip || 'unknown'}</span>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span class="display-item-size">${d.canvasSize.width}x${d.canvasSize.height}</span>
                                ${d.browserInfo ? `<button class="info-btn" onclick="event.stopPropagation();DisplayList.showFeatureModal('${d.id}')">详情</button>` : ''}
                            </div>
                        </div>
                        ${browserInfoHtml}
                    </div>
                </div>
            `;
        }).join('');
        
        if (!window.currentDisplayId && this.list.length > 0) {
            this.select(this.list[0].id);
        }
    },
    
    select(id) {
        window.currentDisplayId = id;
        this.render();
        
        const display = this.list.find(d => d.id === id);
        if (display) {
            window.displayCanvasSize = display.canvasSize;
            if (window.Crop) {
                window.Crop.updateContainerSize();
            }
        }
        
        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'getState',
                displayId: id
            }));
        }
    },
    
    showFeatureModal(displayId) {
        const display = this.list.find(d => d.id === displayId);
        if (!display || !display.browserInfo) return;
        
        const bi = display.browserInfo;
        
        const browserDetail = document.getElementById('browserDetail');
        browserDetail.innerHTML = `
            <div class="browser-detail-row">
                <span class="browser-detail-label">浏览器</span>
                <span class="browser-detail-value">${bi.browserName} ${bi.browserVersion}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">操作系统</span>
                <span class="browser-detail-value">${bi.os}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">设备类型</span>
                <span class="browser-detail-value">${bi.deviceType}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">屏幕分辨率</span>
                <span class="browser-detail-value">${bi.screenWidth} x ${bi.screenHeight}</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">设备像素比</span>
                <span class="browser-detail-value">${bi.devicePixelRatio}x</span>
            </div>
            <div class="browser-detail-row">
                <span class="browser-detail-label">IP 地址</span>
                <span class="browser-detail-value">${display.ip || 'unknown'}</span>
            </div>
        `;
        
        const featureList = document.getElementById('featureList');
        if (bi.featureSupport && bi.featureSupport.length > 0) {
            featureList.innerHTML = bi.featureSupport.map(f => `
                <div class="feature-item">
                    <div class="feature-name">
                        <span>${f.name}</span>
                        <span>${f.note}</span>
                    </div>
                    <span class="feature-badge ${f.supported ? 'supported' : 'unsupported'}">
                        ${f.supported ? '支持' : '不支持'}
                    </span>
                </div>
            `).join('');
        } else {
            featureList.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">暂无功能支持信息</div>';
        }
        
        document.getElementById('featureModal').classList.add('active');
    },
    
    closeFeatureModal() {
        document.getElementById('featureModal').classList.remove('active');
    },
    
    init() {
        const modal = document.getElementById('featureModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeFeatureModal();
                }
            });
        }
    }
};

window.selectDisplay = DisplayList.select.bind(DisplayList);
window.showFeatureModal = DisplayList.showFeatureModal.bind(DisplayList);
window.closeFeatureModal = DisplayList.closeFeatureModal.bind(DisplayList);
window.DisplayList = DisplayList;
