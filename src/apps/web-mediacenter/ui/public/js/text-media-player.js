(function exposeTextMediaPlayer(root, factory) {
    const api = factory(root);

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root && root.window === root) {
        root.TextMediaPlayer = api.createTextMediaPlayer();
    }
}(typeof globalThis === 'undefined' ? this : globalThis, (root) => {
    const DEFAULT_STYLE = Object.freeze({
        background: '#FFF4B8',
        color: '#333333',
        fontSize: 'auto',
        lineHeight: 'normal',
        pageMargin: 'normal'
    });
    const FONT_SIZE_MAP = Object.freeze({ small: 24, medium: 32, large: 40, auto: 32 });
    const LINE_HEIGHT_MAP = Object.freeze({ compact: 1.35, normal: 1.6, loose: 1.9 });
    const PAGE_MARGIN_MAP = Object.freeze({ small: 24, normal: 48, large: 80 });

    function getSplitter(options) {
        if (options.splitIntoSentences) return options.splitIntoSentences;
        if (root.AASCSentenceSplitter) return root.AASCSentenceSplitter.splitIntoSentences;
        if (typeof require === 'function') {
            return require('../../../../../core/utils/sentence-splitter').splitIntoSentences;
        }
        throw new Error('共享分句器未加载');
    }

    function normalizeStyle(style) {
        const merged = { ...DEFAULT_STYLE, ...(style || {}) };
        return {
            background: merged.background || DEFAULT_STYLE.background,
            color: merged.color || DEFAULT_STYLE.color,
            fontSize: FONT_SIZE_MAP[merged.fontSize] ? merged.fontSize : DEFAULT_STYLE.fontSize,
            lineHeight: LINE_HEIGHT_MAP[merged.lineHeight] ? merged.lineHeight : DEFAULT_STYLE.lineHeight,
            pageMargin: PAGE_MARGIN_MAP[merged.pageMargin] ? merged.pageMargin : DEFAULT_STYLE.pageMargin
        };
    }

    function createTextMediaPlayer(initialOptions = {}) {
        let options = { ...initialOptions };
        let source = null;
        let format = 'plain';
        let rawText = '';
        let pages = [];
        let pageIndex = 0;
        let sentenceIndex = 0;
        let playbackId = '';
        let state = 'idle';
        let style = normalizeStyle(initialOptions.style);
        let playlistContext = null;
        let activeAudio = null;
        let currentSentences = [];
        let requestPending = false;

        const nextPlaybackId = () => `text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const getAudio = () => options.audio || (root.document && root.document.getElementById('ttsAudio'));
        const getContainer = () => options.container || (root.document && root.document.getElementById('mediaText'));
        const getContent = () => options.content || (root.document && root.document.getElementById('mediaTextContent'));
        const getStatus = () => options.status || (root.document && root.document.getElementById('mediaTextStatus'));
        const send = (message) => {
            if (typeof options.send === 'function') options.send(message);
        };

        function getFontPixels() {
            return options.fontSize || FONT_SIZE_MAP[style.fontSize];
        }

        function getLineHeight() {
            return options.lineHeight || LINE_HEIGHT_MAP[style.lineHeight];
        }

        function getPageMargin() {
            return PAGE_MARGIN_MAP[style.pageMargin];
        }

        function getEffectiveSize() {
            const container = getContainer();
            const width = options.width || (container && container.clientWidth) || 800;
            const height = options.height || (container && container.clientHeight) || 600;
            const rotation = Number(options.getRotation ? options.getRotation() : options.rotation || 0) % 360;
            return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
        }

        // 以隐藏克隆的实际高度为准；无 DOM 的纯单元测试使用同一行高参数进行确定性估算。
        function measureTextHeight(text) {
            if (!root.document || !root.document.createElement) {
                const size = getEffectiveSize();
                const usableWidth = Math.max(size.width - getPageMargin() * 2, getFontPixels());
                const charsPerLine = Math.max(Math.floor(usableWidth / getFontPixels()), 1);
                const visualLines = text.split('\n').reduce((total, line) => total + Math.max(Math.ceil(line.length / charsPerLine), 1), 0);
                return visualLines * getFontPixels() * getLineHeight();
            }
            const clone = root.document.createElement('pre');
            const size = getEffectiveSize();
            clone.className = 'text-media-measure';
            clone.textContent = text;
            clone.style.width = `${Math.max(size.width - getPageMargin() * 2, 1)}px`;
            clone.style.fontSize = `${getFontPixels()}px`;
            clone.style.lineHeight = String(getLineHeight());
            root.document.body.appendChild(clone);
            const height = clone.getBoundingClientRect().height;
            clone.remove();
            return height;
        }

        function buildPlainPages(text) {
            const size = getEffectiveSize();
            const maxHeight = Math.max(size.height - getPageMargin() * 2, 1);
            const lines = text.replace(/\r\n?/g, '\n').split('\n');
            const measuredLines = [];
            for (const line of lines) {
                if (measureTextHeight(line) <= maxHeight || line.length === 0) {
                    measuredLines.push(line);
                    continue;
                }
                // 单个逻辑行超过整页时，按实际量测高度贪心切为可显示片段，确保不丢字符。
                let chunk = '';
                for (const character of line) {
                    const candidate = chunk + character;
                    if (chunk && measureTextHeight(candidate) > maxHeight) {
                        measuredLines.push(chunk);
                        chunk = character;
                    } else {
                        chunk = candidate;
                    }
                }
                if (chunk) measuredLines.push(chunk);
            }
            const result = [];
            let currentLines = [];
            for (const line of measuredLines) {
                const candidate = [...currentLines, line];
                if (currentLines.length > 0 && measureTextHeight(candidate.join('\n')) > maxHeight) {
                    result.push(currentLines.join('\n'));
                    currentLines = [line];
                } else {
                    currentLines = candidate;
                }
            }
            if (currentLines.length > 0 || result.length === 0) result.push(currentLines.join('\n'));
            return result.map((pageText) => ({ html: '', speakText: pageText, plainText: pageText }));
        }

        function buildMarkdownPages(text) {
            const renderer = options.renderMarkdown || (root.ChatMarkdown && root.ChatMarkdown.render);
            const html = renderer ? renderer(text) : '';
            // Markdown 页按源文本块切分，语音始终读取未带标记的可读文本，避免标签进入 TTS。
            const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).filter(Boolean);
            const size = getEffectiveSize();
            const maxHeight = Math.max(size.height - getPageMargin() * 2, 1);
            const result = [];
            let currentBlocks = [];
            for (const block of blocks.length ? blocks : ['']) {
                const candidate = [...currentBlocks, block];
                if (currentBlocks.length > 0 && measureTextHeight(candidate.join('\n\n')) > maxHeight) {
                    result.push(currentBlocks.join('\n\n'));
                    currentBlocks = [block];
                } else {
                    currentBlocks = candidate;
                }
            }
            if (currentBlocks.length > 0 || result.length === 0) result.push(currentBlocks.join('\n\n'));
            return result.map((pageText, index) => ({
                html: index === 0 && result.length === 1 ? html : (renderer ? renderer(pageText) : ''),
                speakText: pageText.replace(/```[\s\S]*?```/g, '').replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '').replace(/^\s*#{1,6}\s+/gm, ''),
                plainText: pageText
            }));
        }

        function renderCurrentPage() {
            const container = getContainer();
            const content = getContent();
            const status = getStatus();
            const page = pages[pageIndex];
            if (!page) return;
            if (container) {
                container.style.display = 'block';
                container.style.background = style.background;
                container.style.color = style.color;
                container.style.padding = `${getPageMargin()}px`;
                container.style.fontSize = `${getFontPixels()}px`;
                container.style.lineHeight = String(getLineHeight());
            }
            if (content) {
                content.replaceChildren();
                if (format === 'markdown') {
                    // ChatMarkdown 已转义用户文本；只写入该受控渲染器生成的 HTML。
                    content.innerHTML = page.html;
                } else {
                    const pre = root.document.createElement('pre');
                    pre.className = 'text-media-plain';
                    pre.textContent = page.plainText;
                    content.appendChild(pre);
                }
            }
            if (status) status.textContent = `第 ${pageIndex + 1} / ${pages.length} 页`;
        }

        function emitProgress(nextState = state) {
            const progress = getProgress(nextState);
            if (typeof options.onProgress === 'function') options.onProgress(progress);
            send({ type: 'textProgress', ...progress });
        }

        function getProgress(progressState = state) {
            return {
                pageIndex,
                pageTotal: pages.length,
                sentenceIndex,
                sentenceTotal: currentSentences.length,
                state: progressState,
                format
            };
        }

        function clearAudio() {
            const audio = getAudio();
            activeAudio = null;
            if (!audio) return;
            try {
                audio.pause();
                audio.currentTime = 0;
                audio.removeAttribute && audio.removeAttribute('src');
            } catch (error) {
                console.warn('清理文本 TTS 音频失败', error);
            }
        }

        function invalidatePlayback() {
            playbackId = nextPlaybackId();
            requestPending = false;
            clearAudio();
        }

        function requestNextSentence() {
            if (state !== 'playing' || requestPending) return;
            if (sentenceIndex >= currentSentences.length) {
                finishPage();
                return;
            }
            requestPending = true;
            send({
                type: 'textSentenceTts',
                playbackId,
                pageIndex,
                sentenceIndex,
                text: currentSentences[sentenceIndex]
            });
        }

        function requestPageSentences() {
            const page = pages[pageIndex];
            currentSentences = page ? getSplitter(options)(page.speakText) : [];
            sentenceIndex = 0;
            if (currentSentences.length === 0) {
                finishPage();
                return;
            }
            state = 'playing';
            requestNextSentence();
        }

        function finishPage() {
            requestPending = false;
            emitProgress('playing');
            if (pageIndex + 1 < pages.length) {
                pageIndex += 1;
                renderCurrentPage();
                requestPageSentences();
                return;
            }
            state = 'finished';
            emitProgress();
            if (typeof options.onFinished === 'function') options.onFinished(playlistContext);
        }

        function finishCurrentSentence() {
            if (state !== 'playing') return;
            requestPending = false;
            activeAudio = null;
            sentenceIndex += 1;
            requestNextSentence();
        }

        function isCurrentResponse(data) {
            return !!data
                && data.playbackId === playbackId
                && Number(data.pageIndex) === pageIndex
                && Number(data.sentenceIndex) === sentenceIndex;
        }

        async function decodeText(data) {
            if (data.type === 'url') {
                const response = await (options.fetch || root.fetch)(data.url);
                if (!response.ok && response.ok !== undefined) throw new Error(`文本加载失败: ${response.status}`);
                return response.text();
            }
            const binary = root.atob ? root.atob(data.data || '') : Buffer.from(data.data || '', 'base64').toString('binary');
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        }

        async function load(data, loadOptions = {}) {
            invalidatePlayback();
            source = data;
            format = data.format === 'markdown' ? 'markdown' : 'plain';
            state = 'loading';
            try {
                rawText = await decodeText(data);
                pages = format === 'markdown' ? buildMarkdownPages(rawText) : buildPlainPages(rawText);
                pageIndex = Math.min(Math.max(Number(loadOptions.pageIndex) || 0, 0), Math.max(pages.length - 1, 0));
                renderCurrentPage();
                if (loadOptions.paused) {
                    state = 'paused';
                    emitProgress();
                    return;
                }
                state = 'playing';
                requestPageSentences();
            } catch (error) {
                state = 'failed';
                pages = [{ html: '', speakText: '', plainText: `文本加载失败：${error.message}` }];
                pageIndex = 0;
                renderCurrentPage();
                emitProgress();
                console.error('文本媒体加载失败', error);
            }
        }

        function start() {
            if (!pages.length && Array.isArray(options.pageTexts)) {
                pages = options.pageTexts.map((text) => ({ html: '', speakText: text, plainText: text }));
                pageIndex = 0;
            }
            invalidatePlayback();
            state = 'playing';
            renderCurrentPage();
            requestPageSentences();
        }

        function handleControl(action) {
            const control = typeof action === 'string' ? action : action && action.action;
            const actions = {
                play() {
                    if (state === 'paused' && activeAudio) {
                        state = 'playing';
                        activeAudio.play().catch((error) => console.warn('恢复文本 TTS 失败', error));
                        emitProgress();
                        return;
                    }
                    if (state !== 'playing') {
                        state = 'playing';
                        requestNextSentence();
                        emitProgress();
                    }
                },
                pause() {
                    if (state !== 'playing') return;
                    state = 'paused';
                    if (activeAudio) activeAudio.pause();
                    emitProgress();
                },
                prev() {
                    if (pageIndex === 0) return;
                    invalidatePlayback();
                    pageIndex -= 1;
                    state = 'playing';
                    renderCurrentPage();
                    requestPageSentences();
                },
                next() {
                    if (pageIndex + 1 >= pages.length) return;
                    invalidatePlayback();
                    pageIndex += 1;
                    state = 'playing';
                    renderCurrentPage();
                    requestPageSentences();
                },
                stop() {
                    invalidatePlayback();
                    state = 'stopped';
                    emitProgress();
                }
            };
            if (actions[control]) actions[control]();
        }

        function handleTtsAudio(data) {
            if (!isCurrentResponse(data) || state !== 'playing') return;
            requestPending = false;
            const audio = getAudio();
            if (!audio) {
                finishCurrentSentence();
                return;
            }
            activeAudio = audio;
            audio.src = data.audioUrl;
            audio.onended = finishCurrentSentence;
            audio.onerror = finishCurrentSentence;
            audio.play().catch((error) => {
                console.warn('文本 TTS 播放失败，跳过当前句', error);
                finishCurrentSentence();
            });
        }

        function handleTtsError(data) {
            if (!isCurrentResponse(data)) return;
            requestPending = false;
            finishCurrentSentence();
        }

        function applyStyle(nextStyle) {
            const anchor = pages[pageIndex] && pages[pageIndex].plainText;
            style = normalizeStyle({ ...style, ...(nextStyle || {}) });
            if (!rawText) return;
            pages = format === 'markdown' ? buildMarkdownPages(rawText) : buildPlainPages(rawText);
            const anchorIndex = pages.findIndex((page) => page.plainText.includes(anchor));
            pageIndex = anchorIndex >= 0 ? anchorIndex : Math.min(pageIndex, Math.max(pages.length - 1, 0));
            renderCurrentPage();
            emitProgress();
        }

        return {
            configure(nextOptions) { options = { ...options, ...(nextOptions || {}) }; },
            load,
            // 纯函数测试入口：与真实 load 共用分页逻辑，避免测试维护第二套播放器实现。
            async loadText(text, nextFormat = 'plain') {
                rawText = String(text || '');
                format = nextFormat === 'markdown' ? 'markdown' : 'plain';
                pages = format === 'markdown' ? buildMarkdownPages(rawText) : buildPlainPages(rawText);
                pageIndex = 0;
                sentenceIndex = 0;
                state = 'idle';
                renderCurrentPage();
            },
            start,
            handleControl,
            handleTtsAudio,
            handleTtsError,
            applyStyle,
            attachPlaylist(context) { playlistContext = context || null; },
            getProgress,
            getPageText(index) { return pages[index] ? pages[index].plainText : ''; },
            finishCurrentSentence,
            stop() { handleControl('stop'); }
        };
    }

    function createTextPlayerForTest(options = {}) {
        return createTextMediaPlayer(options);
    }

    return { createTextMediaPlayer, createTextPlayerForTest, DEFAULT_STYLE };
}));
