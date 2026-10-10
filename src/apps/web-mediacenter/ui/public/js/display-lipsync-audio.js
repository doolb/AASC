// 只记录真正准备播放的TTS句子；音频播放、路由和队列仍由原播放器管理。
(function exposeLipSyncAudio(root) {
    const entries = new WeakMap();
    const watched = new WeakSet();
    let sequence = 0;
    const changed = audio => audio.dispatchEvent(new CustomEvent('mmd-tts-source-change'));
    const clear = (audio, expected) => {
        if (!audio || !entries.has(audio) || (expected && entries.get(audio) !== expected)) return;
        entries.delete(audio);
        changed(audio);
    };
    root.DisplayLipSyncAudio = Object.freeze({
        prepare(audio, text, src) {
            if (!audio) return null;
            const entry = Object.freeze({ sequence: ++sequence, text: String(text || ''), src: String(src || '') });
            entries.set(audio, entry);
            if (!watched.has(audio)) {
                watched.add(audio);
                // 前面的结束监听可能已经播放下一句，不能清除刚切换的来源。
                const finish = () => { if (audio.ended || audio.error) clear(audio); };
                audio.addEventListener('ended', finish);
                audio.addEventListener('error', finish);
            }
            changed(audio);
            return entry;
        },
        clear,
        getState: audio => audio ? entries.get(audio) || null : null
    });
}(window));
