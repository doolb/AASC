const FloatingControl = {
    isOpen: false,
    selectedDisplayId: null,
    isPlaying: false,
    currentFit: 'contain',
    
    init() {
        this.loadState();
        this.updateDisplayList();
    },
    
    loadState() {
        try {
            const saved = localStorage.getItem('floatingControlState');
            if (saved) {
                const state = JSON.parse(saved);
                this.selectedDisplayId = state.selectedDisplayId || null;
            }
        } catch (e) {
            console.error('[FloatingControl] 加载状态失败:', e);
        }
    },
    
    saveState() {
        try {
            localStorage.setItem('floatingControlState', JSON.stringify({
                selectedDisplayId: this.selectedDisplayId
            }));
        } catch (e) {
            console.error('[FloatingControl] 保存状态失败:', e);
        }
    },
    
    toggle() {
        this.isOpen = !this.isOpen;
        const panel = document.getElementById('floatingControlPanel');
        if (panel) {
            panel.classList.toggle('show', this.isOpen);
        }
    },
    
    updateDisplayList() {
        const select = document.getElementById('floatingDisplaySelect');
        if (!select) return;
        
        const displayList = window.DisplayList ? window.DisplayList.getDisplays() : [];
        
        select.innerHTML = '<option value="">选择显示端</option>';
        
        displayList.forEach(display => {
            const option = document.createElement('option');
            option.value = display.id;
            option.textContent = display.name || display.id;
            if (display.id === this.selectedDisplayId) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    },
    
    selectDisplay(displayId) {
        this.selectedDisplayId = displayId || null;
        this.saveState();
        
        if (window.DisplayList) {
            window.DisplayList.select(displayId);
        }
    },
    
    setSelectedDisplay(displayId) {
        this.selectedDisplayId = displayId;
        const select = document.getElementById('floatingDisplaySelect');
        if (select) {
            select.value = displayId || '';
        }
        this.saveState();
    },
    
    togglePlay() {
        this.isPlaying = !this.isPlaying;
        const btn = document.getElementById('floatingPlayPauseBtn');
        if (btn) {
            btn.textContent = this.isPlaying ? '暂停' : '播放';
            btn.classList.toggle('active', this.isPlaying);
        }
        
        if (window.WebSocketManager && this.selectedDisplayId) {
            window.WebSocketManager.sendControl('play', this.isPlaying);
        }
    },
    
    setPlayingState(playing) {
        this.isPlaying = playing;
        const btn = document.getElementById('floatingPlayPauseBtn');
        if (btn) {
            btn.textContent = this.isPlaying ? '暂停' : '播放';
            btn.classList.toggle('active', this.isPlaying);
        }
    },
    
    setVolume(value) {
        const volumeValue = document.getElementById('floatingVolumeValue');
        if (volumeValue) {
            volumeValue.textContent = value;
        }
        
        if (window.WebSocketManager && this.selectedDisplayId) {
            window.WebSocketManager.sendControl('volume', parseInt(value));
        }
    },
    
    updateVolume(value) {
        const slider = document.getElementById('floatingVolumeSlider');
        const volumeValue = document.getElementById('floatingVolumeValue');
        if (slider) slider.value = value;
        if (volumeValue) volumeValue.textContent = value;
    },
    
    setFit(fit) {
        this.currentFit = fit;
        
        document.querySelectorAll('#floatingControlPanel [data-fit]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fit === fit);
        });
        
        if (window.sendFitMode) {
            window.sendFitMode(fit);
        }
    },
    
    setFitMode(fit) {
        this.currentFit = fit;
        document.querySelectorAll('#floatingControlPanel [data-fit]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fit === fit);
        });
    },
    
    onPlayInputKeypress(event) {
        if (event.key === 'Enter') {
            this.playByName();
        }
    },
    
    playByName() {
        const input = document.getElementById('floatingPlayInput');
        if (!input) return;
        
        const fileName = input.value.trim();
        if (!fileName) {
            if (window.showToast) {
                window.showToast('请输入文件名', 'warning');
            }
            return;
        }
        
        if (!this.selectedDisplayId) {
            if (window.showToast) {
                window.showToast('请先选择显示端', 'warning');
            }
            return;
        }
        
        if (window.WebSocketManager) {
            window.WebSocketManager.send({
                type: 'voiceCommand',
                displayId: this.selectedDisplayId,
                text: `播放${fileName}`
            });
        }
        
        input.value = '';
    }
};

window.FloatingControl = FloatingControl;
