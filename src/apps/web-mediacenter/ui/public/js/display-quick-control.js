(function () {
    'use strict';
    let options;
    let timer;
    let state = { volume: 100, fit: 'contain', textStyle: {} };
    const get = id => document.getElementById(id);
    const send = (action, value) => {
        if (!options.send({ type: 'displayQuickControl', action, value })) {
            get('quickControlStatus').textContent = '尚未连接服务端，请稍后重试';
            return false;
        }
        get('quickControlStatus').textContent = '';
        return true;
    };
    function render() {
        const snapshot = options.snapshot();
        get('quickPlayToggle').textContent = snapshot.playing ? '暂停' : '播放';
        get('quickVolume').value = state.volume;
        get('quickVolumeValue').textContent = `${state.volume}%`;
        document.querySelectorAll('#displayQuickControlPanel [data-fit]').forEach(button => {
            button.classList.toggle('active', button.dataset.fit === state.fit);
            button.setAttribute('aria-pressed', String(button.dataset.fit === state.fit));
        });
        const text = snapshot.text || {};
        get('quickTextStatus').textContent = text.pageTotal ? `第 ${(text.pageIndex || 0) + 1}/${text.pageTotal} 页` : '未播放文本';
        get('quickTextToggle').textContent = text.state === 'playing' ? '暂停' : '播放';
        const playlist = snapshot.playlist;
        get('quickPlaylist').hidden = !playlist;
        if (playlist) {
            get('quickPlaylistStatus').textContent = `第 ${playlist.index + 1}/${playlist.total} 项`;
            get('quickPlaylistToggle').textContent = playlist.paused ? '继续' : '暂停';
        }
    }
    function setOpen(open) {
        get('displayQuickControlPanel').hidden = !open;
        get('displayQuickControlToggle').setAttribute('aria-expanded', String(open));
        clearInterval(timer);
        if (open) { render(); timer = setInterval(render, 1000); }
    }
    function init(config) {
        options = config;
        get('displayQuickControlToggle').addEventListener('click', () => setOpen(get('displayQuickControlPanel').hidden));
        get('quickControlClose').addEventListener('click', () => setOpen(false));
        get('quickPlayToggle').addEventListener('click', () => send('play', !options.snapshot().playing));
        get('quickClear').addEventListener('click', () => send('clearMedia'));
        get('quickVolume').addEventListener('input', event => { const value = Number(event.target.value); if (send('volume', value)) { state.volume = value; render(); } });
        get('displayQuickControlPanel').addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button.dataset.fit) send('fit', button.dataset.fit);
            if (button.dataset.text) send('textPlayback', { action: button.dataset.text === 'toggle' ? (options.snapshot().text?.state === 'playing' ? 'pause' : 'play') : button.dataset.text });
            if (button.dataset.playlist) send('playlist', button.dataset.playlist === 'toggle' ? (options.snapshot().playlist?.paused ? 'resume' : 'pause') : button.dataset.playlist);
        });
        get('quickTextStyleApply').addEventListener('click', () => send('textStyle', {
            fontSize: get('quickFontSize').value, lineHeight: get('quickLineHeight').value, pageMargin: get('quickPageMargin').value
        }));
        get('quickPlayForm').addEventListener('submit', event => {
            event.preventDefault();
            const input = get('quickPlayName');
            if (!input.value.trim()) { get('quickControlStatus').textContent = '请输入文件名'; return; }
            if (send('quickPlay', input.value)) input.value = '';
        });
    }
    function update(message) {
        const values = message.type === 'restoreState' ? message.state || {} : message.type === 'control' ? { [message.action]: message.value } : {};
        for (const key of ['volume', 'fit', 'textStyle']) if (values[key] !== undefined) state[key] = values[key];
        const style = state.textStyle || {};
        for (const [id, value] of [['quickFontSize', style.fontSize], ['quickLineHeight', style.lineHeight], ['quickPageMargin', style.pageMargin]]) if (value) get(id).value = value;
        if (!get('displayQuickControlPanel').hidden) render();
    }
    window.DisplayQuickControl = { init, update, handleBack() { if (get('displayQuickControlPanel').hidden) return false; setOpen(false); return true; } };
})();
