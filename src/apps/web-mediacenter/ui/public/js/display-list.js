const DisplayList = {
    list: [],
    selectionMode: 'single',
    
    getDisplays() {
        return this.list || [];
    },
    
    setSelectionMode(mode) {
        if (mode !== 'single' && mode !== 'all' && mode !== 'adaptive') {
            return;
        }
        
        this.selectionMode = mode;
        this.renderSelectionMode();
        
        if (mode === 'single' && !window.currentDisplayId && this.list.length > 0) {
            this.select(this.list[0].id);
        }
    },
    
    getSelectedDisplayIds(mediaRatio) {
        switch (this.selectionMode) {
            case 'single':
                return window.currentDisplayId ? [window.currentDisplayId] : [];
            case 'all':
                return this.list.map(d => d.id);
            case 'adaptive':
                return this.getAdaptiveDisplayIds(mediaRatio);
            default:
                return [];
        }
    },
    
    getAdaptiveDisplayIds(mediaRatio) {
        const isLandscapeMedia = mediaRatio > 1;
        const isPortraitMedia = mediaRatio < 1;
        
        return this.list.filter(display => {
            const isLandscapeDisplay = this.isDisplayLandscape(display);
            
            if (isLandscapeMedia) {
                return isLandscapeDisplay;
            } else if (isPortraitMedia) {
                return !isLandscapeDisplay;
            } else {
                return true;
            }
        }).map(d => d.id);
    },
    
    isDisplayLandscape(display) {
        const { width, height } = display.canvasSize || { width: 1920, height: 1080 };
        const rotation = display.rotation || 0;
        
        let isLandscape = width >= height;
        
        if (rotation === 90 || rotation === 270) {
            isLandscape = !isLandscape;
        }
        
        return isLandscape;
    },
    
    renderSelectionMode() {
        document.querySelectorAll('[data-selection-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.selectionMode === this.selectionMode);
        });
    },
    
    render() {
        this.renderToContainer('displayList');
        this.renderToContainer('mediaDisplayList');
        
        this.renderSelectionMode();
        
        if (window.FloatingControl) {
            window.FloatingControl.updateDisplayList();
        }
        
        if (this.selectionMode === 'single' && !window.currentDisplayId && this.list.length > 0) {
            this.select(this.list[0].id);
        }
    },
    
    renderToContainer(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        if (this.list.length === 0) {
            container.innerHTML = '<div class="empty-list">暂无显示端连接</div>';
            if (containerId === 'displayList') {
                window.currentDisplayId = null;
            }
            return;
        }
        
        let selectionModeHtml = `
            <div class="selection-mode-bar">
                <button class="selection-mode-btn ${this.selectionMode === 'single' ? 'active' : ''}" 
                        data-selection-mode="single" onclick="DisplayList.setSelectionMode('single')">
                    单选
                </button>
                <button class="selection-mode-btn ${this.selectionMode === 'all' ? 'active' : ''}" 
                        data-selection-mode="all" onclick="DisplayList.setSelectionMode('all')">
                    全选
                </button>
                <button class="selection-mode-btn ${this.selectionMode === 'adaptive' ? 'active' : ''}" 
                        data-selection-mode="adaptive" onclick="DisplayList.setSelectionMode('adaptive')">
                    自适应
                </button>
            </div>
        `;
        
        let listHtml = this.list.map(d => {
            let isActive = false;
            if (this.selectionMode === 'single') {
                isActive = d.id === window.currentDisplayId;
            } else if (this.selectionMode === 'all') {
                isActive = true;
            }
            
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
            
            let voiceStatusHtml = '';
            if (d.voiceSupported === true) {
                if (d.voiceListening) {
                    voiceStatusHtml = '<span class="voice-status listening" title="语音识别中">语音</span>';
                } else {
                    voiceStatusHtml = '<span class="voice-status ready" title="语音识别就绪">语音</span>';
                }
            } else if (d.voiceSupported === false) {
                voiceStatusHtml = '<span class="voice-status unsupported" title="不支持语音识别">语音</span>';
            }
            
            let directionIndicator = '';
            const isLandscape = this.isDisplayLandscape(d);
            directionIndicator = `<span class="direction-indicator ${isLandscape ? 'landscape' : 'portrait'}" title="${isLandscape ? '横向' : '纵向'}">${isLandscape ? '↔' : '↕'}</span>`;
            
            let subDisplayIndicator = '';
            if (d.isSubDisplay) {
                subDisplayIndicator = '<span class="sub-display-indicator" title="子显示端（语音端）">🎤</span>';
            }
            
            let capabilityIcons = '';
            if (d.capabilities) {
                const caps = d.capabilities;
                capabilityIcons = `
                    <span class="cap-icon ${caps.mediaRendering ? 'active' : 'inactive'}" title="媒体渲染${caps.mediaRendering ? '' : '（不可用）'}">🖥️</span>
                    <span class="cap-icon ${caps.voicePlayback ? 'active' : 'inactive'}" title="语音播放${caps.voicePlayback ? '' : '（不可用）'}">🔊</span>
                    <span class="cap-icon ${caps.voiceRecording ? 'active' : 'inactive'}" title="语音录音${caps.voiceRecording ? '' : '（不可用）'}">🎙️</span>
                    <span class="cap-icon ${caps.voiceRecognition ? 'active' : 'inactive'}" title="语音识别${caps.voiceRecognition ? '' : '（不可用）'}">🧠</span>
                    <span class="cap-icon ${caps.ttsGeneration ? 'active' : 'inactive'}" title="语音生成${caps.ttsGeneration ? '' : '（不可用）'}">🗣️</span>
                    <span class="cap-icon ${caps.displayText ? 'active' : 'inactive'}" title="文本显示${caps.displayText ? '' : '（不可用）'}">📝</span>
                `;
            }
            
            return `
                <div class="display-item ${isActive ? 'active' : ''} ${d.isSubDisplay ? 'sub-display' : ''}" onclick="DisplayList.select('${d.id}')">
                    <div style="flex:1;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span class="display-item-id">${d.ip || 'unknown'}${d.isSubDisplay ? ' <span class="sub-display-tag">子显示端</span>' : ''}</span>
                            <div style="display:flex;align-items:center;gap:8px;">
                                ${subDisplayIndicator}
                                ${capabilityIcons}
                                ${directionIndicator}
                                ${voiceStatusHtml}
                                <span class="display-item-size">${d.canvasSize.width}x${d.canvasSize.height}</span>
                                ${d.browserInfo ? `<button class="info-btn" onclick="event.stopPropagation();DisplayList.showFeatureModal('${d.id}')">详情</button>` : ''}
                                <button class="info-btn" onclick="event.stopPropagation();DisplayList.showCapabilityEditor('${d.id}')" title="能力设置">⚙️</button>
                            </div>
                        </div>
                        ${browserInfoHtml}
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = selectionModeHtml + listHtml;
    },
    
    select(id) {
        window.currentDisplayId = id;
        this.render();
        
        if (window.FloatingControl) {
            window.FloatingControl.setSelectedDisplay(id);
        }
        
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
    
    showCapabilityEditor(displayId) {
        const display = this.list.find(d => d.id === displayId);
        if (!display) return;
        
        const caps = display.capabilities || {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            ttsGeneration: false,
            displayText: true
        };
        
        const existing = document.getElementById('capabilityModal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'capabilityModal';
        modal.className = 'capability-modal';
        modal.innerHTML = `
            <div class="capability-editor">
                <h3>显示端 ${display.ip || 'unknown'} 能力设置</h3>
                <div class="capability-list">
                    <label class="capability-item">
                        <input type="checkbox" ${caps.mediaRendering ? 'checked' : ''} data-cap="mediaRendering">
                        <span>🖥️ 媒体渲染</span>
                        <span class="capability-desc">能显示图片/视频</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voicePlayback ? 'checked' : ''} data-cap="voicePlayback">
                        <span>🔊 语音播放</span>
                        <span class="capability-desc">语音播放为手动路由开关，开启后可作为文本TTS播报设备</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voiceRecording ? 'checked' : ''} data-cap="voiceRecording">
                        <span>🎙️ 语音录音</span>
                        <span class="capability-desc">能录制音频</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.voiceRecognition ? 'checked' : ''} data-cap="voiceRecognition">
                        <span>🧠 语音识别</span>
                        <span class="capability-desc">能进行语音识别</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.ttsGeneration ? 'checked' : ''} data-cap="ttsGeneration">
                        <span>🗣️ 语音生成</span>
                        <span class="capability-desc">能在显示端离线合成语音</span>
                    </label>
                    <label class="capability-item">
                        <input type="checkbox" ${caps.displayText ? 'checked' : ''} data-cap="displayText">
                        <span>📝 文本显示</span>
                        <span class="capability-desc">能显示文字覆盖层</span>
                    </label>
                </div>
                <div class="capability-actions">
                    <button class="capability-save-btn" onclick="DisplayList.saveCapabilities('${displayId}')">保存</button>
                    <button class="capability-cancel-btn" onclick="DisplayList.closeCapabilityEditor()">取消</button>
                </div>
            </div>
        `;
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeCapabilityEditor();
            }
        });
        
        document.body.appendChild(modal);
    },
    
    saveCapabilities(displayId) {
        const checkboxes = document.querySelectorAll('#capabilityModal input[type="checkbox"]');
        const capabilities = {};
        checkboxes.forEach(cb => {
            capabilities[cb.dataset.cap] = cb.checked;
        });
        
        if (window.WebSocketManager && window.WebSocketManager.ws && window.WebSocketManager.ws.readyState === WebSocket.OPEN) {
            window.WebSocketManager.ws.send(JSON.stringify({
                type: 'updateCapabilities',
                displayId: displayId,
                capabilities: capabilities
            }));
        }
        
        this.closeCapabilityEditor();
    },
    
    closeCapabilityEditor() {
        const modal = document.getElementById('capabilityModal');
        if (modal) modal.remove();
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
