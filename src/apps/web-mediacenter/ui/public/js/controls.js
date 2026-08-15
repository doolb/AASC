const Controls = {
    isPlaying: false,
    
    togglePlayPause() {
        this.isPlaying = !this.isPlaying;
        const btn = document.getElementById('playPauseBtn');
        if (btn) {
            btn.textContent = this.isPlaying ? '暂停' : '播放';
            btn.classList.toggle('playing', this.isPlaying);
            btn.classList.toggle('paused', !this.isPlaying);
        }
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('play', this.isPlaying);
        }
    },
    
    setPlayingState(playing) {
        this.isPlaying = playing;
        const btn = document.getElementById('playPauseBtn');
        if (btn) {
            btn.textContent = this.isPlaying ? '暂停' : '播放';
            btn.classList.toggle('playing', this.isPlaying);
            btn.classList.toggle('paused', !this.isPlaying);
        }
    },
    
    updateProgress(value) {
        const progressValue = document.getElementById('progressValue');
        if (progressValue) {
            progressValue.textContent = value + '%';
        }
    },
    
    updateVolume(value) {
        const volumeValue = document.getElementById('volumeValue');
        if (volumeValue) {
            volumeValue.textContent = value;
        }
    },
    
    // 「视频播放」里的 HTML 模式按钮：弹出 html 播放模式设置面板，确认后应用到显示端
    showHtmlModePanel() {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="playlist-settings-dialog">
                <div class="dialog-title">HTML 播放模式</div>
                <div class="dialog-body">
                    <div class="settings-row">
                        <span class="settings-label">滚动方式</span>
                        <label><input type="radio" name="htmlModePanelScroll" value="page" checked> 分页式</label>
                        <label><input type="radio" name="htmlModePanelScroll" value="smooth"> 平滑</label>
                    </div>
                    <div class="settings-row" id="htmlModePanelPageRow">
                        <span class="settings-label">每屏停留</span>
                        <label><input type="radio" name="htmlModePanelInterval" value="3"> 3秒</label>
                        <label><input type="radio" name="htmlModePanelInterval" value="5" checked> 5秒</label>
                        <label><input type="radio" name="htmlModePanelInterval" value="8"> 8秒</label>
                    </div>
                    <div class="settings-row" id="htmlModePanelSpeedRow" style="display:none">
                        <span class="settings-label">滚动速度</span>
                        <label><input type="radio" name="htmlModePanelSpeed" value="slow"> 慢</label>
                        <label><input type="radio" name="htmlModePanelSpeed" value="medium" checked> 中</label>
                        <label><input type="radio" name="htmlModePanelSpeed" value="fast"> 快</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">循环播放</span>
                        <label><input type="checkbox" id="htmlModePanelLoop" checked> 滚到底后从头循环</label>
                    </div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.4);">发送 html 播放时将沿用此设置</div>
                </div>
                <div class="dialog-footer">
                    <button class="btn-cancel" id="htmlModePanelCancelBtn">取消</button>
                    <button class="btn-confirm" id="htmlModePanelConfirmBtn">应用</button>
                </div>
            </div>`;
        const modeRow = (mode) => {
            mask.querySelector('#htmlModePanelPageRow').style.display = mode === 'page' ? '' : 'none';
            mask.querySelector('#htmlModePanelSpeedRow').style.display = mode === 'page' ? 'none' : '';
        };
        mask.querySelectorAll('input[name="htmlModePanelScroll"]').forEach(r =>
            r.addEventListener('change', (e) => modeRow(e.target.value)));
        mask.querySelector('#htmlModePanelCancelBtn').addEventListener('click', () => mask.remove());
        mask.querySelector('#htmlModePanelConfirmBtn').addEventListener('click', () => {
            const mode = mask.querySelector('input[name="htmlModePanelScroll"]:checked').value;
            const htmlScroll = {
                mode: mode,
                loop: mask.querySelector('#htmlModePanelLoop').checked
            };
            if (mode === 'page') {
                htmlScroll.pageInterval = parseInt(mask.querySelector('input[name="htmlModePanelInterval"]:checked').value) || 5;
            } else {
                htmlScroll.speed = mask.querySelector('input[name="htmlModePanelSpeed"]:checked').value;
            }
            mask.remove();
            if (window.WebSocketManager) {
                window.WebSocketManager.sendControl('htmlScroll', htmlScroll);
            }
        });
        document.body.appendChild(mask);
    },

    sendFitMode(fit) {
        document.querySelectorAll('[data-fit]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fit === fit);
        });

        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('fit', fit);
            if (fit === 'crop') {
                window.WebSocketManager.sendControl('crop', window.Crop ? window.Crop.data : { x: 0, y: 0, width: 100, height: 100 });
            }
        }
        setTimeout(() => {
            if (window.Crop) {
                window.Crop.updateBox();
            }
        }, 100);
    },
    
    setFitMode(fit) {
        document.querySelectorAll('[data-fit]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fit === fit);
        });
    },
    
    init() {
        const progressSlider = document.getElementById('progressSlider');
        const volumeSlider = document.getElementById('volumeSlider');
        
        if (progressSlider) {
            progressSlider.addEventListener('change', function() {
                if (window.WebSocketManager) {
                    window.WebSocketManager.sendControl('seek', parseInt(this.value));
                }
            });
        }
        
        if (volumeSlider) {
            volumeSlider.addEventListener('input', function() {
                if (window.WebSocketManager) {
                    window.WebSocketManager.sendControl('volume', parseInt(this.value));
                }
            });
        }
    },
    
    async restartServer() {
        if (!confirm('确定要重启服务器吗？重启后显示端会自动重新连接。')) {
            return;
        }
        
        try {
            const response = await fetch('/api/restart', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                if (window.showToast) {
                    showToast('服务器正在重启，请稍候...', 'success');
                }
                
                setTimeout(() => {
                    location.reload();
                }, 5000);
            } else {
                if (window.showToast) {
                    showToast('重启失败: ' + result.message, 'error');
                }
            }
        } catch (err) {
            if (window.showToast) {
                showToast('重启请求失败: ' + err.message, 'error');
            }
        }
    }
};

window.updateProgress = Controls.updateProgress.bind(Controls);
window.updateVolume = Controls.updateVolume.bind(Controls);
window.sendFitMode = Controls.sendFitMode.bind(Controls);
window.togglePlayPause = Controls.togglePlayPause.bind(Controls);
window.restartServer = Controls.restartServer.bind(Controls);
window.Controls = Controls;
