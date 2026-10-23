// 两个原生 range 仅绘制手柄，共用一条可见轨道；保留原生触屏和键盘操作。
(function() {
    const controller = {
        range: MediaLoop.normalize(), duration: 0, token: null, displayId: null, editing: false,
        init() {
            this.start = document.getElementById('mediaLoopStart');
            this.end = document.getElementById('mediaLoopEnd');
            this.enabled = document.getElementById('mediaLoopEnabled');
            this.track = document.getElementById('mediaLoopRange');
            if (!this.start || !this.end || !this.enabled) return;
            for (const [input, field] of [[this.start, 'startPercent'], [this.end, 'endPercent']]) {
                input.addEventListener('input', () => {
                    this.editing = true;
                    const value = Number(input.value);
                    const limits = { startPercent: Math.min(value, this.range.endPercent - MediaLoop.GAP),
                        endPercent: Math.max(value, this.range.startPercent + MediaLoop.GAP) };
                    this.range = MediaLoop.normalize({ ...this.range, [field]: limits[field] });
                    this.render();
                });
                input.addEventListener('change', () => { this.editing = false; this.commit(); });
                input.addEventListener('blur', () => { if (this.editing) { this.editing = false; this.commit(); } });
            }
            this.enabled.addEventListener('change', () => {
                this.range.enabled = this.enabled.checked;
                this.commit();
            });
            this.render();
        },
        receive(data) {
            if (data.displayId !== window.currentDisplayId) return;
            const changed = this.displayId !== data.displayId || this.token !== data.mediaLoopToken;
            if (changed) this.editing = false;
            this.displayId = data.displayId;
            this.token = data.mediaLoopToken || null;
            if (!this.editing) this.range = MediaLoop.normalize(data.mediaLoop);
            this.duration = Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
            this.render();
        },
        restore(displayId, state) {
            const item = state.currentPlaylist?.startData?.playlist?.[state.currentPlaylist.index || 0] || state.currentMedia;
            const duration = state.mediaLoopDuration ?? (state.currentPlaylist ? state.currentPlaylist.duration : state.currentMediaProgress?.duration);
            this.receive({ displayId, mediaLoopToken: state.mediaLoopToken, mediaLoop: state.mediaLoop,
                duration: ['audio', 'video'].includes(item?.mediaType) ? duration : 0 });
        },
        progress(data) {
            if (data.displayId !== window.currentDisplayId || this.displayId !== data.displayId) return;
            this.duration = Number.isFinite(data.duration) && data.duration > 0 ? data.duration : 0;
            if (data.mediaType && !['audio', 'video'].includes(data.mediaType)) this.duration = 0;
            this.render();
        },
        commit() {
            if (!this.token || this.displayId !== window.currentDisplayId || !this.duration) return;
            window.WebSocketManager?.sendControl('mediaLoop', { ...this.range, mediaLoopToken: this.token });
            this.render();
        },
        disconnected() {
            this.editing = false;
            this.duration = 0;
            this.token = null;
            this.render();
        },
        formatTime(percent) {
            if (!Number.isFinite(this.duration) || this.duration <= 0) return '--:--.--';
            // 先统一舍入为百分之一秒，再拆分各位，避免59.999秒显示成00:59.100而不进位。
            const time = Math.round(this.duration * percent / 100 * 100);
            const hours = Math.floor(time / 360000);
            const minutes = String(Math.floor(time / 6000) % 60).padStart(2, '0');
            const seconds = String(Math.floor(time / 100) % 60).padStart(2, '0');
            const fraction = String(time % 100).padStart(2, '0');
            return `${hours ? hours + ':' : ''}${minutes}:${seconds}.${fraction}`;
        },
        render() {
            if (!this.start) return;
            const usable = this.duration > 0 && this.token && this.displayId === window.currentDisplayId;
            this.start.disabled = this.end.disabled = this.enabled.disabled = !usable;
            this.start.value = this.range.startPercent;
            this.end.value = this.range.endPercent;
            this.enabled.checked = this.range.enabled;
            this.track.style.setProperty('--loop-start', `${this.range.startPercent}%`);
            this.track.style.setProperty('--loop-end', `${this.range.endPercent}%`);
            this.track.classList.toggle('is-disabled', !usable);
            for (const [input, field, id] of [[this.start, 'startPercent', 'mediaLoopStartTime'], [this.end, 'endPercent', 'mediaLoopEndTime']]) {
                const time = this.formatTime(this.range[field]);
                input.setAttribute('aria-valuetext', time);
                document.getElementById(id).textContent = time;
            }
        }
    };
    window.ControlMediaLoop = controller;
})();
