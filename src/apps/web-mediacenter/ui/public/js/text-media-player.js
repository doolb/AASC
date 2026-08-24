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
        let voiceRoute = null;
        let loadToken = 0;
        let loadAbortController = null;

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

        function updateTextLayout(pageTotal = 1) {
            const container = getContainer();
            const status = getStatus();
            if (!container) return;
            container.style.display = 'block';
            container.style.background = style.background;
            container.style.color = style.color;
            container.style.fontSize = `${getFontPixels()}px`;
            container.style.lineHeight = String(getLineHeight());
            container.style.setProperty('--text-media-page-margin', `${getPageMargin()}px`);
            if (!status) return;
            status.textContent = `第 ${Math.max(pageIndex + 1, 1)} / ${Math.max(pageTotal, 1)} 页`;
            const statusStyle = root.getComputedStyle && root.getComputedStyle(status);
            const statusBottom = statusStyle ? Number.parseFloat(statusStyle.bottom) || 0 : getPageMargin();
            const statusHeight = status.getBoundingClientRect ? status.getBoundingClientRect().height : getFontPixels() * 0.5;
            container.style.setProperty('--text-media-status-reserve', `${Math.ceil(statusBottom + statusHeight)}px`);
        }

        function getAvailableTextArea() {
            updateTextLayout(pages.length || 1);
            const content = getContent();
            if (content && content.clientWidth && content.clientHeight) {
                return { width: content.clientWidth, height: content.clientHeight };
            }
            const size = getEffectiveSize();
            return {
                width: Math.max(size.width - getPageMargin() * 2, 1),
                height: Math.max(size.height - getPageMargin() * 2 - getFontPixels() * 0.5, 1)
            };
        }

        function getEffectiveSize() {
            const container = getContainer();
            const width = options.width || (container && container.clientWidth) || 800;
            const height = options.height || (container && container.clientHeight) || 600;
            // #mediaText 在显示层处理旋转并已交换 90°/270° 的布局尺寸；此处直接量测容器，避免二次交换。
            return { width, height };
        }

        // 以隐藏克隆的实际高度为准；无 DOM 的纯单元测试使用同一行高参数进行确定性估算。
        function measureTextHeight(text) {
            if (!root.document || !root.document.createElement) {
                const area = getAvailableTextArea();
                const usableWidth = Math.max(area.width, getFontPixels());
                const charsPerLine = Math.max(Math.floor(usableWidth / getFontPixels()), 1);
                const visualLines = text.split('\n').reduce((total, line) => total + Math.max(Math.ceil(line.length / charsPerLine), 1), 0);
                return visualLines * getFontPixels() * getLineHeight();
            }
            const clone = root.document.createElement('pre');
            clone.className = 'text-media-measure';
            clone.textContent = text;
            clone.style.width = `${getAvailableTextArea().width}px`;
            clone.style.fontSize = `${getFontPixels()}px`;
            clone.style.lineHeight = String(getLineHeight());
            root.document.body.appendChild(clone);
            const height = clone.getBoundingClientRect().height;
            clone.remove();
            return height;
        }

        function buildPlainPages(text) {
            const maxHeight = getAvailableTextArea().height;
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

        function measureMarkdownHeight(html) {
            if (!root.document || !root.document.createElement) return measureTextHeight(html.replace(/<[^>]*>/gu, ''));
            const clone = root.document.createElement('div');
            clone.className = 'text-media-measure';
            clone.style.width = `${getAvailableTextArea().width}px`;
            clone.style.fontSize = `${getFontPixels()}px`;
            clone.style.lineHeight = String(getLineHeight());
            clone.innerHTML = html;
            root.document.body.appendChild(clone);
            const height = clone.scrollHeight;
            clone.remove();
            return height;
        }

        function splitMarkdownUnit(renderText, plainText, renderer, maxHeight) {
            const html = renderer ? renderer(renderText) : '';
            if (measureMarkdownHeight(html) <= maxHeight || plainText.length === 0) return [{ renderText, plainText }];
            const prefixMatch = renderText.match(/^(\s*(?:[-+*]|\d+[.)])\s+|\s*>\s?)/u);
            const prefix = prefixMatch ? prefixMatch[0] : '';
            const body = prefix ? renderText.slice(prefix.length) : renderText;
            const parts = [];
            let chunk = '';
            for (const character of body) {
                const candidate = chunk + character;
                if (chunk && measureMarkdownHeight(renderer ? renderer(prefix + candidate) : '') > maxHeight) {
                    // 渲染续页需要保留列表/引用标记，但逻辑原文只能在首片保留一次，供 TTS 与锚点恢复使用。
                    parts.push({ renderText: prefix + chunk, plainText: parts.length === 0 ? `${prefix}${chunk}` : chunk });
                    chunk = character;
                } else {
                    chunk = candidate;
                }
            }
            if (chunk) parts.push({ renderText: prefix + chunk, plainText: parts.length === 0 ? `${prefix}${chunk}` : chunk });
            return parts.length ? parts : [{ renderText, plainText }];
        }

        function createMarkdownUnits(text, renderer, maxHeight) {
            const lines = text.replace(/\r\n?/g, '\n').split('\n');
            const units = [];
            for (let index = 0; index < lines.length; index += 1) {
                const line = lines[index];
                const fence = line.match(/^\s*```([\w-]*)\s*$/u);
                if (!fence) {
                    units.push(...splitMarkdownUnit(line, line, renderer, maxHeight));
                    continue;
                }
                const language = fence[1];
                const codeLines = [];
                const openingFence = line;
                index += 1;
                while (index < lines.length && !/^\s*```\s*$/u.test(lines[index])) {
                    codeLines.push(lines[index]);
                    index += 1;
                }
                const closingFence = index < lines.length ? lines[index] : '';
                const codeSource = codeLines.length ? codeLines : [''];
                codeSource.forEach((codeLine, codeIndex) => {
                    const renderCode = (value) => `\`\`\`${language}\n${value}\n\`\`\``;
                    const chunks = [];
                    let chunk = '';
                    for (const character of codeLine) {
                        const candidate = chunk + character;
                        if (chunk && measureMarkdownHeight(renderer ? renderer(renderCode(candidate)) : '') > maxHeight) {
                            chunks.push({ renderText: renderCode(chunk), plainText: chunk });
                            chunk = character;
                        } else {
                            chunk = candidate;
                        }
                    }
                    if (chunk || codeLine.length === 0) chunks.push({ renderText: renderCode(chunk), plainText: chunk });
                    chunks.forEach((chunk, chunkIndex) => {
                        const isFirst = codeIndex === 0 && chunkIndex === 0;
                        const isLast = codeIndex === codeSource.length - 1 && chunkIndex === chunks.length - 1;
                        units.push({
                            renderText: chunk.renderText,
                            plainText: `${isFirst ? `${openingFence}\n` : ''}${chunk.plainText}${isLast ? `\n${closingFence}` : ''}`
                        });
                    });
                });
            }
            return units;
        }

        function buildMarkdownPages(text) {
            const renderer = options.renderMarkdown || (root.ChatMarkdown && root.ChatMarkdown.render);
            const maxHeight = getAvailableTextArea().height;
            // 以与 #mediaTextContent 同宽高的容器量测 ChatMarkdown 实际生成的块和子节点；
            // 无法整块容纳的段落、列表项、引用和代码行继续按渲染结果贪心拆分。
            const units = createMarkdownUnits(text, renderer, maxHeight);
            const result = [];
            let currentUnits = [];
            for (const unit of units) {
                const candidate = [...currentUnits, unit];
                const candidateRenderText = candidate.map((item) => item.renderText).join('\n');
                if (currentUnits.length > 0 && measureMarkdownHeight(renderer ? renderer(candidateRenderText) : '') > maxHeight) {
                    result.push(currentUnits);
                    currentUnits = [unit];
                } else {
                    currentUnits = candidate;
                }
            }
            if (currentUnits.length > 0 || result.length === 0) result.push(currentUnits);
            return result.map((pageUnits) => {
                const renderText = pageUnits.map((item) => item.renderText).join('\n');
                const plainText = pageUnits.map((item) => item.plainText).join('\n');
                return {
                    html: renderer ? renderer(renderText) : '',
                    speakText: plainText.replace(/```[\s\S]*?```/g, '').replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '').replace(/^\s*#{1,6}\s+/gm, ''),
                    plainText
                };
            });
        }

        function renderCurrentPage() {
            const container = getContainer();
            const content = getContent();
            const status = getStatus();
            const page = pages[pageIndex];
            if (!page) return;
            if (container) updateTextLayout(pages.length);
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

        function normalizeRoute(route) {
            if (!route || typeof route !== 'object') return null;
            const selectedDisplayIds = Array.isArray(route.selectedDisplayIds)
                ? route.selectedDisplayIds.filter((displayId) => typeof displayId === 'string' && displayId)
                : [];
            const selectedVoiceDisplayIds = Array.isArray(route.selectedVoiceDisplayIds)
                ? route.selectedVoiceDisplayIds.filter((displayId) => typeof displayId === 'string' && displayId)
                : [];
            const hasTarget = Object.prototype.hasOwnProperty.call(route, 'voiceTargetDisplayId');
            return {
                selectedDisplayIds,
                selectedVoiceDisplayIds,
                voiceTargetDisplayId: hasTarget ? (route.voiceTargetDisplayId || null) : null
            };
        }

        function invalidateLoad() {
            loadToken += 1;
            if (loadAbortController) {
                loadAbortController.abort();
                loadAbortController = null;
            }
            return loadToken;
        }

        function isCurrentLoad(token) {
            return token === loadToken && state !== 'stopped';
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
                text: currentSentences[sentenceIndex],
                ...(voiceRoute ? { route: voiceRoute } : {})
            });
        }

        function preparePageSentences() {
            const page = pages[pageIndex];
            currentSentences = page ? getSplitter(options)(page.speakText) : [];
            sentenceIndex = 0;
            return currentSentences.length > 0;
        }

        function requestPageSentences() {
            if (!preparePageSentences()) {
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

        async function decodeText(data, signal, isActive) {
            if (data.type === 'url') {
                const response = await (options.fetch || root.fetch)(data.url, signal ? { signal } : undefined);
                if (!isActive()) return null;
                if (!response.ok && response.ok !== undefined) throw new Error(`文本加载失败: ${response.status}`);
                const text = await response.text();
                return isActive() ? text : null;
            }
            const binary = root.atob ? root.atob(data.data || '') : Buffer.from(data.data || '', 'base64').toString('binary');
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        }

        async function load(data, loadOptions = {}) {
            invalidatePlayback();
            const token = invalidateLoad();
            const AbortControllerClass = root.AbortController || (typeof AbortController !== 'undefined' && AbortController);
            const controller = AbortControllerClass ? new AbortControllerClass() : null;
            loadAbortController = controller;
            source = data;
            voiceRoute = normalizeRoute(data.route || data);
            format = data.format === 'markdown' ? 'markdown' : 'plain';
            state = 'loading';
            try {
                const decodedText = await decodeText(data, controller && controller.signal, () => isCurrentLoad(token));
                if (!isCurrentLoad(token) || decodedText === null) return;
                rawText = decodedText;
                pages = format === 'markdown' ? buildMarkdownPages(rawText) : buildPlainPages(rawText);
                pageIndex = Math.min(Math.max(Number(loadOptions.pageIndex) || 0, 0), Math.max(pages.length - 1, 0));
                renderCurrentPage();
                if (loadOptions.paused) {
                    // 重连恢复的暂停列表也需先计算当前页句子；恢复时从本页第一句请求，不能空队列跳页。
                    preparePageSentences();
                    state = 'paused';
                    emitProgress();
                    return;
                }
                state = 'playing';
                requestPageSentences();
            } catch (error) {
                if (!isCurrentLoad(token)) return;
                state = 'failed';
                pages = [{ html: '', speakText: '', plainText: `文本加载失败：${error.message}` }];
                pageIndex = 0;
                renderCurrentPage();
                emitProgress();
                console.error('文本媒体加载失败', error);
            } finally {
                if (token === loadToken) loadAbortController = null;
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
                    if (state === 'paused' && !pages.length && source) {
                        load(source, { pageIndex, paused: false });
                        return;
                    }
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
                    if (state === 'loading') {
                        invalidateLoad();
                        state = 'paused';
                        emitProgress();
                        return;
                    }
                    if (state !== 'playing') return;
                    state = 'paused';
                    if (activeAudio) {
                        activeAudio.pause();
                    } else if (requestPending) {
                        // 服务端会取消旧请求；恢复时必须使用新 playbackId 重发当前句，不能被 pending 卡住。
                        invalidatePlayback();
                    }
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
                    invalidateLoad();
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

        function handleTtsFinished(data) {
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
                invalidateLoad();
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
            handleTtsFinished,
            applyStyle,
            loadRoute(route) { voiceRoute = normalizeRoute(route); },
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
