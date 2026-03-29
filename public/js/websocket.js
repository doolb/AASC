const WebSocketManager = {
    ws: null,
    
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/control`;
        
        this.ws = new WebSocket(wsUrl);
        
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
                
                if (data.state.volume !== undefined) {
                    const volumeSlider = document.getElementById('volumeSlider');
                    const volumeValue = document.getElementById('volumeValue');
                    if (volumeSlider) volumeSlider.value = data.state.volume;
                    if (volumeValue) volumeValue.textContent = data.state.volume;
                }
                
                if (data.state.isPlaying !== undefined && window.Controls) {
                    window.Controls.setPlayingState(data.state.isPlaying);
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
    
    sendMedia(mediaData) {
        if (!window.currentDisplayId) {
            showToast('请先选择显示端', 'error');
            return;
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'media',
                displayId: window.currentDisplayId,
                media: mediaData
            }));
            showToast('已发送到显示端', 'success');
        }
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
    }
};

window.sendControl = WebSocketManager.sendControl.bind(WebSocketManager);
window.sendMedia = WebSocketManager.sendMedia.bind(WebSocketManager);
window.WebSocketManager = WebSocketManager;
