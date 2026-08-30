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
            if (window.DeviceList) {
                const host = window.location.hostname || '127.0.0.1';
                const port = window.location.port || '8081';
                window.DeviceList.setServerInfo(host, port);
            }
            this.ws.send(JSON.stringify({ type: 'getConversationConfirmationConfig' }));
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
            if (window.DeviceList) {
                window.DeviceList.setDisplayList(data.list);
            }
            
            if (window.AsrDevice) {
                window.AsrDevice.updateUI();
            }
            if (window.TtsDevice) {
                window.TtsDevice.updateUI();
            }
        } else if (data.type === 'capabilitiesUpdated') {
            if (window.DeviceList) {
                window.DeviceList.handleCapabilitiesUpdated(data);
            }
        } else if (data.type === 'capabilitiesUpdateError') {
            if (window.DeviceList) {
                window.DeviceList.handleCapabilitiesUpdateError(data);
            }
        } else if (data.type === 'voiceVadConfig') {
            if (window.DeviceList) {
                window.DeviceList.handleVoiceVadConfig(data);
            }
        } else if (data.type === 'voiceVadNoiseStarted') {
            // 设备列表的检测按钮已在发送请求时进入 pending，开始回执仅用于兼容其他控制端。
            console.log('[WS] 底噪检测已开始:', data.displayId, data.requestId);
        } else if (data.type === 'voiceVadNoiseResult') {
            if (window.DeviceList) {
                window.DeviceList.handleVoiceVadNoiseResult(data);
            }
        } else if (data.type === 'conversationConfirmationConfig') {
            if (window.VoiceprintPanel) {
                window.VoiceprintPanel.handleConversationConfirmationConfig(data);
            }
        } else if (data.type === 'playlistProgress') {
            // 只处理当前选中显示端的播放列表进度
            if (data.displayId && data.displayId !== window.currentDisplayId) return;
            if (window.MediaLibrary) {
                window.MediaLibrary.renderPlaylistPanel(data);
            }
            // 批量播放中的文本项也要同步文本分页按钮，但不改变列表级别的控制按钮。
            if (data.mediaType === 'text' || data.pageTotal !== undefined) {
                if (window.Controls) window.Controls.updateTextPlaybackStatus(data);
                if (window.FloatingControl) window.FloatingControl.updateTextPlaybackStatus(data);
            }
        } else if (data.type === 'tempMediaInfo') {
            // 只处理当前选中显示端的临时媒体信息
            if (data.displayId && data.displayId !== window.currentDisplayId) return;
            if (window.MediaLibrary) {
                window.MediaLibrary.handleTempMediaInfo(data);
            }
        } else if (data.type === 'playlistError') {
            showToast(data.message || '批量播放失败', 'error');
        } else if (data.type === 'playlistStarted') {
            if (data.temp && Array.isArray(data.playlist) && window.MediaLibrary) {
                window.MediaLibrary.handleTempPlaylistStarted(data.playlist);
            }
            showToast(`播放列表已发送（共 ${data.total} 项）`, 'success');
        } else if (data.type === 'deviceEventExecuted') {
            const eventLabel = data.eventType === 'onConnect' ? '连线' : '掉线';
            if (window.showToast) {
                window.showToast(`设备 ${data.ip} ${eventLabel}指令已执行: ${data.command}`, 'success');
            }
        } else if (data.type === 'asrDeviceChanged') {
            if (window.AsrDevice) {
                window.AsrDevice.handleDeviceChanged(data.device);
            }
        } else if (data.type === 'ttsDeviceChanged') {
            if (window.TtsDevice) {
                window.TtsDevice.handleDeviceChanged(data.device);
            }
        } else if (data.type === 'serverVoiceChanged') {
            if (window.VoiceprintPanel) {
                window.VoiceprintPanel.applyServerVoiceConfig(data);
            }
        } else if (data.type === 'cpuAffinityChanged') {
            if (window.CpuAffinitySettings) {
                window.CpuAffinitySettings.handleConfigChanged(data.cpuAffinity);
            }
        } else if (data.type === 'displayState') {
            console.log('[WS] displayState 收到, displayId:', data.displayId, 'currentDisplayId:', window.currentDisplayId);
            
            if (!window.currentDisplayId && data.displayId) {
                console.log('[WS] 自动选择显示端:', data.displayId);
                window.currentDisplayId = data.displayId;
                if (window.DisplayList) {
                    window.DisplayList.render();
                }
            }
            
            if (data.displayId === window.currentDisplayId) {
                // 睡眠状态（切换显示端/getState 响应）：有值显示真实状态，未上报过则按钮回落「设置」
                if (window.Controls) {
                    window.Controls.updateSleepStatus(data.state.sleepState);
                }

                if (window.Crop) {
                    window.displayCanvasSize = data.state.canvasSize;
                }

                if (data.state.dynamicFitConfig !== undefined && window.Controls) {
                    window.Controls.setDynamicFitConfig(data.state.dynamicFitConfig);
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

                if (data.state.currentTextProgress) {
                    if (window.Controls) window.Controls.updateTextPlaybackStatus(data.state.currentTextProgress);
                    if (window.FloatingControl) window.FloatingControl.updateTextPlaybackStatus(data.state.currentTextProgress);
                }
                
                if (data.state.currentMediaUrl && window.Crop) {
                    const savedCrop = { ...data.state.crop };
                    const savedRotation = data.state.rotation;
                    if (window.Crop.currentMedia !== data.state.currentMediaUrl) {
                        console.log('[WS] 调用 showPreview, url:', data.state.currentMediaUrl, 'mediaType:', data.state.currentMediaType);
                        window.Crop.showPreview(data.state.currentMediaUrl, data.state.currentMediaType, () => {
                            window.Crop.setData(savedCrop);
                            window.Crop.setRotation(savedRotation);
                            setTimeout(() => {
                                window.Crop.updateBox();
                            }, 350);
                        });
                    } else {
                        if (window.Crop) {
                            window.Crop.setData(savedCrop);
                            window.Crop.setRotation(savedRotation);
                            window.Crop.updateContainerSize();
                            setTimeout(() => {
                                window.Crop.updateBox();
                            }, 350);
                        }
                    }
                } else if (!data.state.currentMediaUrl) {
                    console.log('[WS] currentMediaUrl 不存在，跳过 showPreview');
                    // 无媒体预览（如临时模式占位）时也恢复裁剪框，允许拖动发送裁剪指令
                    if (window.Crop && data.state.crop) {
                        window.Crop.setData({ ...data.state.crop });
                        window.Crop.box.style.display = 'block';
                        setTimeout(() => window.Crop.updateBox(), 100);
                    }
                }

                if (data.state.currentMediaUrl && window.MediaLibrary) {
                    window.MediaLibrary.setCurrentMedia(data.state.currentMediaUrl);
                }

                // 控制端刷新后，服务端通过 displayState 返回当前播放列表及索引；
                // 立即重绘当前项，恢复文件名、媒体类型和批量预览，不等待下一条实时进度。
                const currentPlaylist = data.state.currentPlaylist;
                if (currentPlaylist && currentPlaylist.startData && window.MediaLibrary) {
                    const playlist = currentPlaylist.startData.playlist || [];
                    const item = playlist[currentPlaylist.index || 0];
                    if (item) {
                        window.MediaLibrary.renderPlaylistPanel({
                            displayId: data.displayId,
                            listId: currentPlaylist.startData.listId,
                            index: currentPlaylist.index || 0,
                            total: playlist.length,
                            state: currentPlaylist.state || 'playing',
                            fileName: item.fileName,
                            url: item.url,
                            mediaType: item.mediaType,
                            tempPreviewKey: item.tempPreviewKey,
                            format: currentPlaylist.currentTextFormat || item.format,
                            pageIndex: currentPlaylist.currentTextPage,
                            pageTotal: currentPlaylist.currentTextPageTotal,
                            sentenceIndex: currentPlaylist.currentTextSentence,
                            sentenceTotal: currentPlaylist.currentTextSentenceTotal,
                            width: item.width,
                            height: item.height
                        });
                    } else {
                        window.MediaLibrary.clearPlaylistPanel();
                    }
                } else if (window.MediaLibrary) {
                    // 切换到没有批量播放的显示端时，不能保留上一个显示端的列表。
                    window.MediaLibrary.clearPlaylistPanel();
                }
            } else {
                console.log('[WS] displayState displayId 不匹配，跳过处理');
            }
        } else if (data.type === 'sleepStateReport') {
            // 显示端睡眠状态上报：匹配当前选中显示端才更新按钮
            if (data.displayId === window.currentDisplayId && window.Controls) {
                window.Controls.updateSleepStatus(data.sleepState);
            }
        } else if (data.type === 'playStateReport') {
            // 显示端播放状态上报：同步当前选中显示端的播放/暂停按钮
            if (data.displayId === window.currentDisplayId && window.Controls) {
                window.Controls.setPlayingState(!!data.isPlaying);
            }
        } else if (data.type === 'textProgress') {
            // 文本分页状态只能更新当前选中显示端，防止多个显示端之间串页码和按钮状态。
            if (data.displayId !== window.currentDisplayId) return;
            if (window.Controls) window.Controls.updateTextPlaybackStatus(data);
            if (window.FloatingControl) window.FloatingControl.updateTextPlaybackStatus(data);
        } else if (data.type === 'videoProgress') {
            // 只显示当前选中显示端的进度
            window.currentHtmlPlaying = false;
            if (data.displayId && data.displayId !== window.currentDisplayId) return;
            var slider = document.getElementById('progressSlider');
            var label = document.getElementById('progressValue');
            if (slider && data.duration) {
                var pct = Math.round((data.currentTime / data.duration) * 100);
                slider.value = pct;
                if (label) label.textContent = pct + '%';
            }
        } else if (data.type === 'audioProgress') {
            // 音频与视频共用控制端进度条，但单独标记当前不是 html 滚动媒体。
            window.currentHtmlPlaying = false;
            if (data.displayId && data.displayId !== window.currentDisplayId) return;
            const slider = document.getElementById('progressSlider');
            const label = document.getElementById('progressValue');
            if (slider && data.duration) {
                const pct = Math.round((data.currentTime / data.duration) * 100);
                slider.value = pct;
                if (label) label.textContent = pct + '%';
            }
        } else if (data.type === 'htmlProgress') {
            // 只处理当前选中显示端的 html 播放进度
            if (data.displayId && data.displayId !== window.currentDisplayId) return;
            // html 播放进度：进度条显示滚动比例，文本显示缩放倍数 + 滚动比例
            console.log('[WS] << htmlProgress scrollProgress:', data.scrollProgress, 'scale:', data.scale, 'mode:', data.mode);
            window.currentHtmlPlaying = true;
            var slider = document.getElementById('progressSlider');
            var label = document.getElementById('progressValue');
            if (slider) {
                slider.value = data.scrollProgress || 0;
                if (label) {
                    var scaleText = data.scale && data.scale > 1 ? '缩放 ' + data.scale.toFixed(1) + 'x · ' : '';
                    label.textContent = scaleText + '滚动 ' + (data.scrollProgress || 0) + '%';
                }
            }
        } else if (data.type === 'controlScreenshot') {
            // 控制模式截图回传：更新裁剪面板底图
            if (data.displayId && data.displayId !== window.currentDisplayId) return;
            if (window.Crop && window.Crop.showControlScreenshot) {
                window.Crop.showControlScreenshot(data);
            }
        } else if (data.type === 'chatInput') {
            if (window.Chat) {
                window.Chat.handleDisplayChatInput(data);
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
            if (window.DeviceList) {
                window.DeviceList.handleVoiceInput(data);
            }
            if (window.Chat) {
                window.Chat.handleDisplayVoiceInput(data);
            }
        } else if (data.type === 'voiceConversationState') {
            if (window.DeviceList) {
                window.DeviceList.updateVoiceConversationState(data);
            }
        } else if (data.type === 'commandMode') {
            if (window.Chat) {
                window.Chat.session.commandMode = data.enabled;
                window.Chat.renderModeIndicator();
            }
        } else if (data.type === 'privateMode') {
            if (window.Chat) {
                window.Chat.setMode('private', data.target);
            }
        } else if (data.type === 'groupMode') {
            if (window.Chat) {
                window.Chat.setMode('group', null);
            }
        } else if (data.type === 'searchHistory') {
            if (window.Chat) {
                window.Chat.searchHistory = data.history;
                window.Chat.renderSearchHistory();
            }
            if (window.Search) {
                window.Search.setHistory(data.history);
            }
        } else if (data.type === 'searchChannel') {
            if (window.Search) {
                window.Search.handleChannel(data);
            }
        } else if (data.type === 'assistantConfig') {
            if (window.Chat && data.config) {
                window.Chat.assistantConfig = data.config;
            }
        } else if (data.type === 'chatSession') {
            if (window.Chat) {
                window.Chat.handleSession(data);
            }
        } else if (data.type === 'privateSessions') {
            if (window.Chat) {
                window.Chat.handleSessionList(data);
            }
        } else if (data.type === 'privateSessionCreated') {
            if (window.Chat) {
                window.Chat.handleSessionList(data);
                window.showToast('会话已创建', 'success');
            }
        } else if (data.type === 'privateSessionDeleted') {
            if (window.Chat) {
                if (window.Chat.session.privateTarget) {
                    window.Chat.loadSessions(window.Chat.session.privateTarget);
                }
                window.Chat.loadHistory();
                window.showToast('会话已删除', 'success');
            }
        } else if (data.type === 'privateSessionSwitched') {
            if (window.Chat) {
                window.Chat.handleSessionSwitched(data);
            }
        } else if (data.type === 'chatCommands') {
            if (window.Chat) {
                window.Chat.handleCommands(data);
            }
        } else if (data.type === 'builtinVoiceCommands') {
            if (window.Chat) {
                window.Chat.handleBuiltinCommands(data);
            }
        } else if (data.type === 'playOnControl') {
            if (window.Chat) {
                window.Chat.handlePlayOnControl(data);
            }
        } else if (data.type === 'newChatMessage') {
            if (window.Chat) {
                window.Chat.handleNewMessage(data);
            }
        } else if (data.type === 'profileSwitched') {
            if (window.Chat) {
                window.Chat.handleProfileSwitched(data);
            }
        } else if (data.type === 'chatConfigChanged') {
            if (window.Chat && data.config) {
                window.Chat.config.agentBackend = data.config.agentBackend || 'codex';
                window.Chat.renderModeIndicator();
            }
        } else if (data.type === 'commandRouting') {
            if (window.Settings) {
                window.Settings.handleRoutingUpdate(data.routing);
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
            if (data.commandType === 'control' && data.extraData && data.extraData.sleepState && window.Controls) {
                window.Controls.updateSleepStatus(data.extraData.sleepState);
            }
            if (window.SelfTest) {
                window.SelfTest.handleAck(data);
            }
            if (window.Chat) {
                window.Chat.addCommandAckMessage(data.displayId, data.commandType, data.success, data.details);
            }
        } else if (data.type === 'serverLog') {
            if (window.LogViewer && data.entry) {
                window.LogViewer.addEntry(data.entry);
            }
        } else if (data.type === 'logUpdate') {
            if (window.LogViewer && data.entries) {
                data.entries.forEach(entry => window.LogViewer.addEntry(entry));
            }
        } else if (data.type === 'logHistory') {
            if (window.LogViewer && data.entries) {
                window.LogViewer.addHistory(data.entries, data.categories);
            }
        } else if (data.type === 'systemStats') {
            if (window.LogViewer && data.stats) {
                window.LogViewer.updateSystemStats(data.stats);
            }
        } else if (data.type === 'logReportConfig') {
            if (window.LogViewer) {
                window.LogViewer.handleLogReportConfig(data);
            }
            if (data.target === 'display') {
                const check = document.getElementById('logReportDisplayCheck');
                const level = document.getElementById('logReportDisplayLevel');
                if (check) check.checked = data.enabled;
                if (level) level.value = data.level || 'error';
            } else if (data.target === 'control') {
                const ctrlCheck = document.getElementById('logReportControlCheck');
                const ctrlLevel = document.getElementById('logReportControlLevel');
                if (ctrlCheck) ctrlCheck.checked = data.enabled;
                if (ctrlLevel) ctrlLevel.value = data.level || 'error';
                // 同步到LogViewer的控制台拦截
                if (window.LogViewer) {
                    window.LogViewer.logReportConfig = { enabled: data.enabled, level: data.level };
                    window.LogViewer._updateConsoleIntercept();
                }
            }
        } else if (data.type === 'logReportConfigApplied') {
            if (data.targetType === 'control') {
                // 控制端配置确认后，更新UI和处理console拦截
                if (window.LogViewer) {
                    window.LogViewer.logReportConfig = data.config;
                    window.LogViewer._updateConsoleIntercept();
                }
                const ctrlCheck = document.getElementById('logReportControlCheck');
                const ctrlLevel = document.getElementById('logReportControlLevel');
                if (ctrlCheck) ctrlCheck.checked = data.config.enabled;
                if (ctrlLevel) ctrlLevel.value = data.config.level || 'error';
            } else if (data.targetType === 'display') {
                if (window.showToast) {
                    window.showToast(`日志上报配置已应用 (${data.targetType})`, 'success');
                }
            }
        } else if (data.type === 'logBlocklist') {
            if (window.LogViewer) {
                window.LogViewer.loadBlocklist(data);
            }
        } else if (data.type === 'logBlocklistApplied') {
            if (window.showToast) {
                window.showToast('日志分类屏蔽已应用', 'success');
            }
        } else if (data.type === 'roleList') {
            if (window.Chat) {
                window.Chat.aiRoles = data.roles || [];
                if (window.Chat.isLoading) {
                    window.Chat.updateRoleStatuses();
                } else {
                    window.Chat.render();
                }
            }
        } else if (data.type === 'roleHistory') {
            if (window.Chat && data.role) {
                window.Chat.roleHistories[data.role] = data.history || [];
                // 仅当正在查看该角色时刷新历史，避免打断其他模式
                if (window.Chat.session.mode === 'role' && window.Chat.session.roleTarget === data.role) {
                    window.Chat.renderHistory();
                }
            }
        } else if (data.type === 'roleError') {
            window.showToast(data.message || '操作失败', 'error');
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
    
    sendPlaylistRequest(payload) {
        if (!window.DisplayList) {
            showToast('显示端列表未初始化', 'error');
            return false;
        }
        const displayIds = window.DisplayList.getSelectedDisplayIds();
        if (displayIds.length === 0) {
            showToast('请先选择显示端', 'error');
            return false;
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'playlistRequest', ...payload, displayIds }));
            return true;
        }
        showToast('WebSocket 未连接', 'error');
        return false;
    },

    sendPlaylistControl(displayIds, action, index) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'playlistControl', displayIds, action, index }));
        }
    },

    async getMediaRatio(mediaData) {
        // HTML 无固有宽高比且铺满显示，不创建 img 探测
        if (mediaData.mediaType === 'html' || mediaData.mediaType === 'audio' || mediaData.mediaType === 'text') {
            return 1;
        }
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
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const selectionMode = window.DisplayList ? window.DisplayList.selectionMode : 'single';
            
            if (selectionMode === 'all' || selectionMode === 'adaptive') {
                const selectedIds = window.DisplayList ? window.DisplayList.getSelectedDisplayIds() : [];
                if (selectedIds.length === 0) {
                    showToast('请先选择显示端', 'error');
                    return;
                }
                
                this.ws.send(JSON.stringify({
                    type: 'tts',
                    action: action,
                    displayIds: selectedIds,
                    ...data
                }));
            } else {
                if (!window.currentDisplayId) {
                    showToast('请先选择显示端', 'error');
                    return;
                }
                
                this.ws.send(JSON.stringify({
                    type: 'tts',
                    displayId: window.currentDisplayId,
                    action: action,
                    ...data
                }));
            }
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
