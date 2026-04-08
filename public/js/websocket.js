const WebSocketManager = {
    ws: null,
    
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/control`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket 连接成功');
            if (window.Chat) {
                window.Chat.onWebSocketOpen();
            }
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (e) {
                console.error('解析消息失败:', e);
            }
        };
        
        this.ws.onclose = () => {
            setTimeout(() => this.connect(), 3000);
        };
    },
    
    handleMessage(data) {
        if (data.type === 'serverStartTime') {
            const storedTime = localStorage.getItem('serverStartTime');
            if (storedTime && storedTime !== String(data.time)) {
                localStorage.setItem('serverStartTime', data.time);
                location.reload();
            } else {
                localStorage.setItem('serverStartTime', data.time);
            }
            return;
        }
        
        if (data.type === 'displayList') {
            if (window.DisplayList) {
                window.DisplayList.list = data.list;
                window.DisplayList.render();
            }
        } else if (data.type === 'displayState') {
            if (data.displayId === window.currentDisplayId) {
                if (window.Crop) {
                    window.Crop.setRotation(data.state.rotation);
                    window.Crop.setData(data.state.crop);
                    window.displayCanvasSize = data.state.canvasSize;
                }
                
                if (data.state.fit !== undefined && window.Controls) {
                    window.Controls.setFitMode(data.state.fit);
                }
                
                if (data.state.fit !== undefined && window.FloatingControl) {
                    window.FloatingControl.setFitMode(data.state.fit);
                }
                
                if (data.state.volume !== undefined) {
                    const volumeSlider = document.getElementById('volumeSlider');
                    const volumeValue = document.getElementById('volumeValue');
                    if (volumeSlider) volumeSlider.value = data.state.volume;
                    if (volumeValue) volumeValue.textContent = data.state.volume;
                    
                    if (window.FloatingControl) {
                        window.FloatingControl.updateVolume(data.state.volume);
                    }
                }
                
                if (data.state.isPlaying !== undefined && window.Controls) {
                    window.Controls.setPlayingState(data.state.isPlaying);
                }
                
                if (data.state.isPlaying !== undefined && window.FloatingControl) {
                    window.FloatingControl.setPlayingState(data.state.isPlaying);
                }
                
                if (data.state.currentMediaUrl && window.Crop) {
                    window.Crop.showPreview(data.state.currentMediaUrl, data.state.currentMediaType);
                }
                
                if (data.state.currentMediaUrl && window.MediaLibrary) {
                    window.MediaLibrary.setCurrentMedia(data.state.currentMediaUrl);
                }
                
                if (window.Crop) {
                    window.Crop.updateContainerSize();
                    window.Crop.updateBox();
                }
            }
        } else if (data.type === 'chatChunk') {
            if (window.Chat) {
                window.Chat.handleChunk(data);
            }
        } else if (data.type === 'chatResponse') {
            if (window.Chat) {
                window.Chat.handleResponse(data);
            }
        } else if (data.type === 'showHelp') {
            if (window.Chat) {
                window.Chat.showHelp();
            }
        } else if (data.type === 'chatHistory') {
            if (window.Chat) {
                window.Chat.history = data.history;
                window.Chat.renderHistory();
            }
        } else if (data.type === 'voiceInput') {
            if (window.Chat) {
                window.Chat.handleDisplayVoiceInput(data);
            }
        } else if (data.type === 'searchHistory') {
            if (window.Chat) {
                window.Chat.searchHistory = data.history;
            }
            if (window.Search) {
                window.Search.setHistory(data.history);
            }
        } else if (data.type === 'assistantConfig') {
            if (window.Chat && data.config) {
                window.Chat.assistantConfig = data.config;
            }
        } else if (data.type === 'chatSession') {
            if (window.Chat) {
                window.Chat.handleSession(data);
            }
        } else if (data.type === 'chatCommands') {
            if (window.Chat) {
                window.Chat.handleCommands(data);
            }
        } else if (data.type === 'playOnControl') {
            if (window.Chat) {
                window.Chat.handlePlayOnControl(data);
            }
        } else if (data.type === 'newChatMessage') {
            if (window.Chat) {
                window.Chat.handleNewMessage(data);
            }
        } else if (data.type === 'muteResult') {
            if (window.Chat) {
                window.Chat.addSystemMessage(data.message);
            }
        } else if (data.type === 'muteState') {
            if (window.Chat) {
                const msg = data.isMuted ? '当前处于静音状态' : '当前未静音';
                window.Chat.addSystemMessage(msg);
            }
        } else if (data.type === 'commandAck') {
            if (data.commandType === 'crop' && data.extraData) {
                updateCropDisplayInfo(data.extraData);
            }
            if (window.SelfTest) {
                window.SelfTest.handleAck(data);
            }
            if (window.Chat) {
                window.Chat.addCommandAckMessage(data.displayId, data.commandType, data.success, data.details);
            }
        }
    },
    
    sendControl(action, value) {
        if (!window.currentDisplayId) {
            showToast('请先选择显示端', 'error');
            return;
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'control',
                displayId: window.currentDisplayId,
                action: action,
                value: value
            }));
            showToast('指令已发送', 'success');
        }
    },
    
    async sendMedia(mediaData) {
        await this.sendMediaWithRatio(mediaData, null);
    },
    
    async sendMediaWithRatio(mediaData, mediaRatio) {
        if (!window.DisplayList) {
            showToast('显示端列表未初始化', 'error');
            return;
        }
        
        if (mediaRatio === null) {
            mediaRatio = await this.getMediaRatio(mediaData);
        }
        
        const displayIds = window.DisplayList.getSelectedDisplayIds(mediaRatio);
        console.log('[控制端] sendMedia displayIds:', displayIds, 'mediaRatio:', mediaRatio);
        
        if (displayIds.length === 0) {
            showToast('没有可用的显示端', 'error');
            return;
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'mediaBatch',
                displayIds: displayIds,
                media: mediaData
            }));
            showToast(`已发送到 ${displayIds.length} 个显示端`, 'success');
        }
    },
    
    async getMediaRatio(mediaData) {
        if (mediaData.width && mediaData.height) {
            return mediaData.width / mediaData.height;
        }
        
        if (!mediaData.url) {
            return 1;
        }
        
        return new Promise((resolve) => {
            if (mediaData.mediaType === 'video') {
                const video = document.createElement('video');
                video.onloadedmetadata = () => {
                    resolve(video.videoWidth / video.videoHeight);
                };
                video.onerror = () => resolve(1);
                video.src = mediaData.url;
            } else {
                const img = new Image();
                img.onload = () => {
                    resolve(img.naturalWidth / img.naturalHeight);
                };
                img.onerror = () => resolve(1);
                img.src = mediaData.url;
            }
        });
    },
    
    sendTts(action, data = {}) {
        if (!window.currentDisplayId) {
            showToast('请先选择显示端', 'error');
            return;
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'tts',
                displayId: window.currentDisplayId,
                action: action,
                ...data
            }));
        }
    },
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
};

window.sendControl = WebSocketManager.sendControl.bind(WebSocketManager);
window.sendMedia = WebSocketManager.sendMedia.bind(WebSocketManager);
window.WebSocketManager = WebSocketManager;

function updateCropDisplayInfo(info) {
    const container = document.getElementById('cropDisplayInfo');
    const grid = document.getElementById('cropInfoGrid');
    
    if (!container || !grid) return;
    
    container.style.display = 'block';
    
    const items = [];
    
    if (info.容器尺寸) {
        items.push({ label: '容器宽度', value: info.容器尺寸.width + 'px' });
        items.push({ label: '容器高度', value: info.容器尺寸.height + 'px' });
    }
    
    if (info.媒体原始尺寸) {
        items.push({ label: '媒体宽度', value: info.媒体原始尺寸.width + 'px' });
        items.push({ label: '媒体高度', value: info.媒体原始尺寸.height + 'px' });
    }
    
    if (info.当前旋转 !== undefined) {
        items.push({ label: '旋转角度', value: info.当前旋转 + '°' });
    }
    
    if (info.当前适配模式) {
        items.push({ label: '适配模式', value: info.当前适配模式 });
    }
    
    if (info.当前裁剪百分比) {
        const crop = info.当前裁剪百分比;
        if (crop.x != null) items.push({ label: '裁剪X', value: crop.x.toFixed(1) + '%' });
        if (crop.y != null) items.push({ label: '裁剪Y', value: crop.y.toFixed(1) + '%' });
        if (crop.width != null) items.push({ label: '裁剪宽度', value: crop.width.toFixed(1) + '%' });
        if (crop.height != null) items.push({ label: '裁剪高度', value: crop.height.toFixed(1) + '%' });
    }
    
    if (info.最终样式) {
        items.push({ label: '显示宽度', value: info.最终样式.width });
        items.push({ label: '显示高度', value: info.最终样式.height });
        items.push({ label: '左边距', value: info.最终样式.left });
        items.push({ label: '上边距', value: info.最终样式.top });
    }
    
    if (info.状态) {
        items.push({ label: '状态', value: info.状态 });
    }
    
    grid.innerHTML = items.map(item => `
        <div class="crop-info-item">
            <span class="info-label">${item.label}:</span>
            <span class="info-value">${item.value}</span>
        </div>
    `).join('');
}
