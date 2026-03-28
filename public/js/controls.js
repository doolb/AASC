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
            progressValue.textContent = value;
        }
    },
    
    updateVolume(value) {
        const volumeValue = document.getElementById('volumeValue');
        if (volumeValue) {
            volumeValue.textContent = value;
        }
    },
    
    sendFitMode(fit) {
        document.querySelectorAll('[data-fit]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fit === fit);
        });
        
        if (window.WebSocketManager) {
            window.WebSocketManager.sendControl('fit', fit);
            window.WebSocketManager.sendControl('crop', window.Crop ? window.Crop.data : { x: 0, y: 0, width: 100, height: 100 });
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
    }
};

window.updateProgress = Controls.updateProgress.bind(Controls);
window.updateVolume = Controls.updateVolume.bind(Controls);
window.sendFitMode = Controls.sendFitMode.bind(Controls);
window.togglePlayPause = Controls.togglePlayPause.bind(Controls);
window.Controls = Controls;
