'use strict';

// 将字幕历史、音频进度和闲置隐藏集中管理；音频队列仍由原播放器负责。
(function exposeTtsSubtitles(root) {
    const MAX_LINES = 100;
    const IDLE_MS = 30000;

    function create({ element, audio, onChange }) {
        const documentObject = element.ownerDocument;
        const viewport = documentObject.createElement('div');
        const content = documentObject.createElement('div');
        viewport.className = 'tts-subtitle-viewport';
        content.className = 'tts-subtitle-content';
        viewport.appendChild(content);
        const context = documentObject.createElement('canvas').getContext('2d');
        const history = [];
        let source = 'status';
        let enabled = true;
        let pending = null;
        let idleTimer = null;
        let scrollFrame = null;
        let generation = 0;

        // 每次来源变化使旧隐藏回调失效；隐藏只改变可见性，历史始终保留。
        function cancelIdle() {
            generation++;
            if (idleTimer !== null) root.clearTimeout(idleTimer);
            idleTimer = null;
        }

        function cancelScroll() {
            if (scrollFrame !== null) root.cancelAnimationFrame(scrollFrame);
            scrollFrame = null;
        }

        function hide() {
            cancelIdle();
            cancelScroll();
            element.className = 'voice-text-hidden';
            onChange();
        }

        function scrollLatest() {
            if (scrollFrame !== null || source !== 'tts') return;
            scrollFrame = root.requestAnimationFrame(() => {
                scrollFrame = null;
                if (source !== 'tts' || !viewport.clientHeight) return;
                viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
            });
        }

        function renderLine(text) {
            cancelIdle();
            source = 'tts';
            element.dataset.voiceTextMode = 'tts';
            history.push(text);
            history.splice(0, Math.max(history.length - MAX_LINES, 0));
            const fragment = documentObject.createDocumentFragment();
            for (const line of history) {
                const row = documentObject.createElement('div');
                row.className = 'tts-subtitle-line';
                row.textContent = line;
                fragment.appendChild(row);
            }
            content.replaceChildren(fragment);
            if (viewport.parentNode !== element) element.replaceChildren(viewport);
            element.className = enabled ? 'voice-text-visible' : 'voice-text-hidden';
            onChange();
            scrollLatest();
            const expected = generation;
            idleTimer = root.setTimeout(() => {
                if (source === 'tts' && generation === expected) hide();
            }, IDLE_MS);
        }

        // 按逻辑宽度测量字形，不使用旋转后的物理包围盒；隐藏/聊天抑制时也能拆行。
        function splitLines(text) {
            const style = root.getComputedStyle(element);
            const width = Math.max(1, Number.parseFloat(style.width)
                - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight));
            context.font = `${style.fontSize} ${style.fontFamily}`;
            const spacing = Number.parseFloat(style.letterSpacing) || 0;
            const segments = [];
            let offset = 0;
            for (const paragraph of text.split('\n')) {
                const characters = Array.from(paragraph);
                let start = 0;
                while (start < characters.length) {
                    let low = start + 1;
                    let high = characters.length;
                    let end = low;
                    // 二分查找一行能容纳的最长文本，避免超长输入逐字符反复测量整段。
                    while (low <= high) {
                        const middle = Math.floor((low + high) / 2);
                        const line = characters.slice(start, middle).join('');
                        const measured = context.measureText(line).width + Math.max(middle - start - 1, 0) * spacing;
                        if (measured <= width) {
                            end = middle;
                            low = middle + 1;
                        } else {
                            high = middle - 1;
                        }
                    }
                    segments.push({ text: characters.slice(start, end).join(''), start: offset + start, end: offset + end });
                    start = end;
                }
                offset += characters.length + 1;
            }
            return segments;
        }

        function prepare(text, entry = null) {
            const normalized = String(text || '').replace(/\r\n?/gu, '\n').trim();
            pending = normalized ? { text: normalized, entry, segments: null, shownEnd: 0 } : null;
        }

        // 没有逐字时间戳时，以真实音频时长分配每行字符占比；暂停、缓冲时不向前显示。
        function updateProgress(complete = false) {
            if (!pending || (!complete && (audio.paused || audio.ended)) || !enabled) return;
            const entry = root.DisplayLipSyncAudio?.getState(audio);
            if (!entry || entry !== pending.entry) return;
            let expectedSrc;
            try {
                expectedSrc = new URL(entry.src, root.location.href).href;
            } catch (error) {
                console.warn('[字幕] 无效音频来源，跳过文字更新:', error);
                return;
            }
            if (audio.currentSrc !== expectedSrc) return;
            if (!pending.segments) pending.segments = splitLines(pending.text);
            const length = Array.from(pending.text).length;
            const progress = complete ? length : Number.isFinite(audio.duration) && audio.duration > 0
                ? Math.min(audio.currentTime / audio.duration, 1) * length : 0;
            const segment = pending.segments.find((line, index, lines) => (
                line.start <= progress && (!lines[index + 1] || lines[index + 1].start > progress)
            ));
            if (!segment || segment.end <= pending.shownEnd) return;
            // 向前跳转只加入当前行，不一次刷出被跳过的全部行；普通播放每次只加入一行。
            const shownEnd = pending.shownEnd;
            pending.shownEnd = segment.end;
            const line = shownEnd > segment.start
                ? Array.from(pending.text).slice(shownEnd, segment.end).join('') : segment.text;
            if (line.trim()) renderLine(line);
        }

        function showStatus(text, isFinal) {
            // 模型就绪提示的延迟清理不能隐藏后来已经开始的字幕。
            if (!text) {
                if (source === 'status') hide();
                return;
            }
            cancelIdle();
            cancelScroll();
            pending = null;
            source = 'status';
            element.dataset.voiceTextMode = 'status';
            element.textContent = text + (isFinal ? '' : '…');
            element.className = enabled ? 'voice-text-visible' : 'voice-text-hidden';
            onChange();
        }

        function reflow() {
            if (pending) pending.segments = null;
            scrollLatest();
        }

        function setEnabled(value) {
            enabled = value !== false;
            if (!enabled) {
                pending = null;
                hide();
            }
        }

        audio.addEventListener('mmd-tts-source-change', () => {
            const entry = root.DisplayLipSyncAudio?.getState(audio);
            prepare(entry?.text, entry);
            if (!entry) return;
            element.dataset.voiceTextMode = 'tts';
            onChange();
        });
        for (const event of ['playing', 'timeupdate', 'durationchange', 'seeked']) {
            audio.addEventListener(event, () => updateProgress());
        }
        // ended前可能没有最后一次timeupdate；在原队列切换来源前补上最后一行。
        audio.addEventListener('ended', () => updateProgress(true));
        // 聊天恢复和方向变化会改变内部尺寸；只监听尺寸，不观察自身DOM写入。
        if (typeof root.ResizeObserver === 'function') {
            const resizeObserver = new root.ResizeObserver(reflow);
            resizeObserver.observe(viewport);
        }
        return Object.freeze({ prepare, hide, showStatus, reflow, setEnabled });
    }

    root.DisplayTtsSubtitles = Object.freeze({ create });
}(window));
