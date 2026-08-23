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
        // html 播放时拖动进度条：同步显示端滚动位置
        if (window.WebSocketManager && window.currentHtmlPlaying) {
            window.WebSocketManager.sendControl('htmlScrollTo', parseInt(value) || 0);
        }
    },
    
    updateVolume(value) {
        const volumeValue = document.getElementById('volumeValue');
        if (volumeValue) {
            volumeValue.textContent = value;
        }
    },
    
    // 「媒体播放」里的 HTML 模式按钮：弹出 html 播放模式设置面板，确认后应用到显示端
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

    // 睡眠模式设置弹窗：按时段隐藏媒体/UI，降低夜间干扰；设置按当前选中显示端生效
    showSleepModePanel() {
        const displayId = window.currentDisplayId;
        if (!displayId) {
            if (window.showToast) window.showToast('未选中显示端', 'warning');
            return;
        }
        const hourOptions = () => {
            let html = '';
            for (let i = 0; i <= 23; i++) html += `<option value="${i}">${i} 时</option>`;
            return html;
        };
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="playlist-settings-dialog">
                <div class="dialog-title">睡眠模式</div>
                <div class="dialog-body">
                    <div class="settings-row">
                        <label><input type="checkbox" id="sleepPanelEnabled"> 启用睡眠模式</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">睡眠时段</span>
                        <select id="sleepPanelStart">${hourOptions()}</select>
                        <span>至</span>
                        <select id="sleepPanelEnd">${hourOptions()}</select>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">深度睡眠时段</span>
                        <select id="sleepPanelDeepStart">${hourOptions()}</select>
                        <span>至</span>
                        <select id="sleepPanelDeepEnd">${hourOptions()}</select>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">临时激活</span>
                        <button class="btn-confirm" id="sleepPanelActivateBtn">激活 60 秒</button>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">立即切换</span>
                        <button class="btn-confirm" id="sleepPanelSleepBtn">立即睡眠</button>
                        <button class="btn-confirm" id="sleepPanelDeepBtn">立即深度睡眠</button>
                        <button class="btn-confirm" id="sleepPanelNormalBtn">恢复正常</button>
                    </div>
                    <div id="sleepPanelStatus" style="font-size:12px;color:rgba(255,255,255,0.5);">当前: 正常</div>
                </div>
                <div class="dialog-footer">
                    <button class="btn-cancel" id="sleepPanelCancelBtn">取消</button>
                    <button class="btn-confirm" id="sleepPanelSaveBtn">保存</button>
                </div>
            </div>`;
        mask.querySelector('#sleepPanelCancelBtn').addEventListener('click', () => mask.remove());
        mask.querySelector('#sleepPanelActivateBtn').addEventListener('click', () => {
            if (window.WebSocketManager) window.WebSocketManager.sendControl('sleepActivate');
        });
        // 立即切换：显式进入睡眠/深度睡眠（或恢复正常），不随时段/开关自动切换，直到再次下发
        mask.querySelector('#sleepPanelSleepBtn').addEventListener('click', () => {
            if (window.WebSocketManager) window.WebSocketManager.sendControl('sleepOverride', 'sleep');
        });
        mask.querySelector('#sleepPanelDeepBtn').addEventListener('click', () => {
            if (window.WebSocketManager) window.WebSocketManager.sendControl('sleepOverride', 'deep');
        });
        mask.querySelector('#sleepPanelNormalBtn').addEventListener('click', () => {
            if (window.WebSocketManager) window.WebSocketManager.sendControl('sleepOverride', 'normal');
        });
        mask.querySelector('#sleepPanelSaveBtn').addEventListener('click', () => {
            const settings = {
                enabled: mask.querySelector('#sleepPanelEnabled').checked,
                startHour: parseInt(mask.querySelector('#sleepPanelStart').value, 10),
                endHour: parseInt(mask.querySelector('#sleepPanelEnd').value, 10),
                deepStartHour: parseInt(mask.querySelector('#sleepPanelDeepStart').value, 10),
                deepEndHour: parseInt(mask.querySelector('#sleepPanelDeepEnd').value, 10)
            };
            mask.remove();
            if (window.WebSocketManager) window.WebSocketManager.sendControl('sleepSettings', settings);
        });
        document.body.appendChild(mask);
        // 填充当前选中显示端的已存设置（无则用默认值）
        fetch('/api/device-settings/' + displayId)
            .then(r => r.json())
            .then(d => {
                const s = (d.settings && d.settings.sleep) || { enabled: true, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 };
                mask.querySelector('#sleepPanelEnabled').checked = !!s.enabled;
                mask.querySelector('#sleepPanelStart').value = s.startHour;
                mask.querySelector('#sleepPanelEnd').value = s.endHour;
                mask.querySelector('#sleepPanelDeepStart').value = s.deepStartHour;
                mask.querySelector('#sleepPanelDeepEnd').value = s.deepEndHour;
            })
            .catch(() => {});
    },

    // 显示端回传当前睡眠状态，更新睡眠卡片按钮文字 + 弹窗状态行（弹窗未打开时只更新按钮）
    updateSleepStatus(state) {
        // 卡片按钮：normal/未知保持入口语义「设置」，其余显示当前状态
        const btn = document.getElementById('sleepSettingsBtn');
        if (btn) {
            const btnNames = { normal: '设置', sleep: '睡眠中', deep: '深度睡眠中', active: '临时激活中' };
            btn.textContent = btnNames[state] || '设置';
        }
        const el = document.getElementById('sleepPanelStatus');
        if (!el) return;
        const names = { normal: '正常', sleep: '睡眠中', deep: '深度睡眠中', active: '临时激活中' };
        el.textContent = '当前: ' + (names[state] || '正常');
    },

    normalizeDynamicFitConfig(config = {}) {
        const readSeconds = (value, fallback) => {
            const number = Number(value);
            if (!Number.isFinite(number) || number <= 0) return fallback;
            return Math.round(Math.min(number, 300) * 10) / 10;
        };
        return {
            transitionSeconds: readSeconds(config.transitionSeconds, 3),
            holdSeconds: readSeconds(config.holdSeconds, 2)
        };
    },

    getDynamicFitConfig() {
        return this.normalizeDynamicFitConfig({
            transitionSeconds: document.getElementById('dynamicFitTransitionSeconds')?.value,
            holdSeconds: document.getElementById('dynamicFitHoldSeconds')?.value
        });
    },

    setDynamicFitConfig(config) {
        const normalized = this.normalizeDynamicFitConfig(config);
        const transitionInput = document.getElementById('dynamicFitTransitionSeconds');
        const holdInput = document.getElementById('dynamicFitHoldSeconds');
        if (transitionInput) transitionInput.value = normalized.transitionSeconds;
        if (holdInput) holdInput.value = normalized.holdSeconds;
    },

    sendDynamicFitConfig(config = this.getDynamicFitConfig()) {
        const normalized = this.normalizeDynamicFitConfig(config);
        this.setDynamicFitConfig(normalized);
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('dynamicFitConfig', normalized);
        }
    },

    sendFitMode(fit) {
        document.querySelectorAll('[data-fit]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fit === fit);
        });

        // 同步裁剪逻辑的适配模式：切换角度时据此决定是否发 crop（非 crop 模式误发会把显示端强制切成裁剪放大）
        if (window.Crop) {
            window.Crop.currentFit = fit;
        }

        if (window.WebSocketManager) {
            if (fit === 'dynamic') {
                this.sendDynamicFitConfig();
            }
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
        // 同步裁剪逻辑的适配模式（页面刷新后从显示端恢复 fit 状态时）
        if (window.Crop) {
            window.Crop.currentFit = fit;
        }
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
