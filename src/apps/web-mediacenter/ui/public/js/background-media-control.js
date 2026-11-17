// 背景媒体使用独立控制状态，服务端广播的结果始终是界面权威值。
window.BackgroundMediaControl = {
    change(value) {
        window.WebSocketManager.sendControl('backgroundMedia', value);
    },
    start() {
        const url = document.getElementById('backgroundMediaUrl').value.trim();
        if (!url) return showToast('请输入背景媒体地址', 'error');
        this.change({ url, mediaType: document.getElementById('backgroundMediaType').value, playing: true });
    },
    select(url, mediaType) {
        this.change({ url, mediaType, playing: true });
    },
    render(value) {
        const state = value || { url: '', mediaType: 'audio', playing: false, loop: true, volume: 50 };
        document.getElementById('backgroundMediaUrl').value = state.url || '';
        document.getElementById('backgroundMediaType').value = state.mediaType || 'audio';
        document.getElementById('backgroundMediaLoop').checked = state.loop !== false;
        document.getElementById('backgroundMediaVolume').value = state.volume ?? 50;
        document.getElementById('backgroundMediaVolumeValue').textContent = state.volume ?? 50;
        document.getElementById('backgroundMediaStatus').textContent = !state.url ? '背景媒体已停止' : state.playing ? '已请求播放背景媒体' : '背景媒体已暂停';
    }
};
