/* 两端共享TTS快选；对应.src/framework/tts-provider-configuration.md，选择以服务器回显为准。 */
(function exposeTtsVoicePicker(root) {
    'use strict';
    function create() {
        const names = { system: '系统原生', 'qwen-chat': '国内千问网页', 'qwen-api': 'Qwen API',
            'doubao-api': '豆包 API', 'doubao-chat': '豆包网页朗读' };
        const catalogs = new Map();
        const queries = new Map();
        const previewCache = new Map();
        const previewCacheLimit = 30;
        const dimensions = ['gender', 'age', 'accent'];
        const ages = ['小孩', '少年', '青年', '中年'];
        const facets = {
            gender: voice => ({ female: '女声', male: '男声' })[voice.gender] || '未标注',
            age: voice => (voice.tags || []).find(tag => ages.includes(tag)) || '未标注',
            accent: voice => (voice.tags || []).find(tag => /口音$|话$/u.test(tag)) || '未标注'
        };
        let filters = { gender: 'all', age: 'all', accent: 'all' }, locatePending = false, locateEpoch = 0;
        let prefix = 'display';
        let initialized = false, config = null, provider = 'system', sequence = 0, send, refs, pending = null, timer = null;
        let previewPending = null, previewAudio = null;
        const requestId = () => `${prefix}-tts-${Date.now()}-${++sequence}`;
        const status = text => { refs.status.textContent = text || ''; };
        const cancelLocate = () => { locatePending = false; locateEpoch++; };
        const previewKey = (id, voice) => JSON.stringify([id, config?.providers[id]?.model || '', voice,
            config?.providers[id]?.defaultSpeed ?? 0, config?.defaultVolume ?? 100]);
        function stopPreviewAudio() {
            if (!previewAudio) return;
            previewAudio.pause();
            previewAudio.onended = null;
            previewAudio.onerror = null;
            previewAudio = null;
        }
        function discardPreview(key) {
            const entry = previewCache.get(key);
            if (!entry) return;
            previewCache.delete(key);
            root.URL.revokeObjectURL(entry.url);
        }
        function rememberPreview(key, wav) {
            discardPreview(key);
            const entry = { wav, url: root.URL.createObjectURL(wav) };
            previewCache.set(key, entry);
            while (previewCache.size > previewCacheLimit) discardPreview(previewCache.keys().next().value);
            return entry;
        }
        async function playPreview(key, voiceName) {
            const entry = previewCache.get(key);
            if (!entry) return;
            // 使用顺序同时表示最近播放顺序；重播不能触发服务端再合成。
            previewCache.delete(key);
            previewCache.set(key, entry);
            stopPreviewAudio();
            const audio = new root.Audio(entry.url);
            previewAudio = audio;
            audio.onended = () => { if (previewAudio === audio) { previewAudio = null; status('试听结束'); } };
            audio.onerror = () => {
                if (previewAudio !== audio) return;
                previewAudio = null;
                discardPreview(key);
                renderVoices();
                status('试听播放失败，请重试');
            };
            status(`正在试听：${voiceName}`);
            try { await audio.play(); }
            catch (error) { audio.onerror?.(); }
        }
        function cancelPreview() {
            if (previewPending?.timer) root.clearTimeout(previewPending.timer);
            previewPending = null;
            stopPreviewAudio();
        }
        const close = () => {
            cancelLocate();
            cancelPreview();
            if (!refs?.panel || !refs?.toggle) return;
            refs.panel.hidden = true;
            refs.toggle.setAttribute('aria-expanded', 'false');
        };
        const catalogKey = id => `${id}|${config?.providers[id]?.model || ''}`;
        const currentVoice = () => (config?.aiReplyDefault?.provider === provider ? config.aiReplyDefault.voice : null)
            || config?.providers[provider]?.defaultVoice;
        function resetFilters(locate = true) {
            cancelLocate();
            filters = { gender: 'all', age: 'all', accent: 'all' };
            refs.search.value = '';
            locatePending = locate;
        }
        function matches(voice, except = null) {
            const query = refs.search.value.trim().toLowerCase();
            return dimensions.every(key => key === except || filters[key] === 'all' || facets[key](voice) === filters[key])
                && (!query || `${voice.name} ${voice.id} ${(voice.tags || []).join(' ')}`.toLowerCase().includes(query));
        }
        function renderFilters(values) {
            for (const key of dimensions) {
                const select = refs.filters[key];
                const options = [...new Set(values.map(facets[key]))];
                if (key === 'age') options.sort((a, b) => ages.indexOf(a) - ages.indexOf(b));
                const fragment = document.createDocumentFragment();
                for (const value of ['all', ...options]) {
                    const option = document.createElement('option');
                    const count = values.filter(voice => matches(voice, key) && (value === 'all' || facets[key](voice) === value)).length;
                    option.value = value; option.textContent = `${value === 'all' ? '全部' : value} (${count})`;
                    fragment.append(option);
                }
                select.replaceChildren(fragment); select.value = filters[key];
                select.disabled = !config || !values.length;
                select.classList.toggle('is-filtered', filters[key] !== 'all');
            }
            const applied = dimensions.filter(key => filters[key] !== 'all').map(key => filters[key]);
            if (refs.search.value.trim()) applied.push('搜索：' + refs.search.value.trim());
            refs.summary.textContent = applied.join(' · ') || '全部音色';
            refs.clear.hidden = !applied.length;
        }
        function renderCurrent(values) {
            const voice = currentVoice();
            const known = values.find(item => item.id === voice);
            refs.currentName.textContent = !config ? '等待同步' : provider === 'system' ? '系统原生默认音色' : known?.name || voice || '默认音色';
            refs.current.disabled = !config;
            refs.toggle.title = `${names[provider]}：${refs.currentName.textContent}`;
        }
        function locateCurrent() {
            if (!locatePending || refs.panel.hidden || !config) return;
            const key = catalogKey(provider), epoch = locateEpoch;
            if (provider !== 'system' && !catalogs.has(key)) return;
            // 只滚动列表，且动画帧必须仍属于本次打开和同一目录，防止迟到响应抢滚动。
            root.requestAnimationFrame(() => {
                if (refs.panel.hidden || !locatePending || epoch !== locateEpoch || key !== catalogKey(provider)) return;
                const item = refs.list.querySelector('[aria-selected="true"]');
                if (item) {
                    const listRect = refs.list.getBoundingClientRect(), itemRect = item.getBoundingClientRect();
                    refs.list.scrollTop += itemRect.top - listRect.top - (listRect.height - itemRect.height) / 2;
                    // 短屏时列表保留最小高度，面板自身可能滚动；仅调整面板，不牵动页面舞台。
                    const currentRect = item.getBoundingClientRect(), panelRect = refs.panel.getBoundingClientRect();
                    if (currentRect.bottom > panelRect.bottom - 8) refs.panel.scrollTop += currentRect.bottom - panelRect.bottom + 8;
                    else if (currentRect.top < panelRect.top + 8) refs.panel.scrollTop -= panelRect.top + 8 - currentRect.top;
                }
                locatePending = false;
            });
        }

        function renderSpeed() {
            const value = config?.providers[provider]?.defaultSpeed;
            const supported = Number.isFinite(value);
            refs.speedControl.hidden = !supported;
            refs.speed.disabled = !supported || Boolean(pending);
            refs.speed.value = supported ? value : 0;
            refs.speedValue.textContent = supported ? String(value) : '0';
        }

        function renderVolume() {
            const value = Number.isInteger(config?.defaultVolume) ? config.defaultVolume : 100;
            refs.volume.disabled = !config || Boolean(pending);
            refs.volume.value = value;
            refs.volumeValue.textContent = `${value}%`;
        }

        function renderVoices() {
            const current = currentVoice();
            const fragment = document.createDocumentFragment();
            const values = config && provider !== 'system' ? catalogs.get(catalogKey(provider)) || [] : [];
            renderCurrent(values);
            renderSpeed();
            renderVolume();
            renderFilters(values);
            const matching = values.filter(voice => matches(voice));
            refs.count.textContent = `${matching.length} / ${values.length}`;
            for (const gender of ['female', 'male', 'other']) {
                const entries = matching.filter(voice => (voice.gender || 'other') === gender);
                if (!entries.length) continue;
                const heading = document.createElement('strong');
                heading.textContent = ({ female: '女声', male: '男声', other: '音色' })[gender];
                fragment.append(heading);
                for (const voice of entries) {
                    const row = document.createElement('div');
                    row.className = 'display-tts-voice-row';
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'display-tts-voice-option';
                    button.dataset.voiceId = voice.id;
                    button.setAttribute('role', 'option');
                    button.setAttribute('aria-selected', String(voice.id === current));
                    button.disabled = Boolean(pending);
                    const content = document.createElement('span'); content.textContent = voice.name || voice.id;
                    const tags = document.createElement('small');
                    tags.textContent = (voice.tags || []).join(' · ');
                    content.append(tags);
                    const mark = document.createElement('span'); mark.className = 'display-tts-voice-mark';
                    mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true'); button.append(content, mark);
                    button.addEventListener('click', () => save(provider, voice.id));
                    const preview = document.createElement('button');
                    preview.type = 'button';
                    preview.className = 'display-tts-voice-preview';
                    const key = previewKey(provider, voice.id);
                    preview.textContent = previewCache.has(key) ? '重播' : '试听';
                    preview.setAttribute('aria-label', `${preview.textContent}：${voice.name || voice.id}`);
                    preview.disabled = Boolean(pending || previewPending);
                    preview.addEventListener('click', () => previewVoice(provider, voice));
                    row.append(button, preview);
                    fragment.append(row);
                }
            }
            if (!fragment.childNodes.length) {
                const message = document.createElement('p');
                message.textContent = !config ? '等待同步语音设置' : provider === 'system' ? '沿用系统原生音色'
                    : values.length ? '没有匹配的音色' : '正在查询音色，或该方式尚无目录';
                fragment.append(message);
            }
            refs.list.replaceChildren(fragment);
            locateCurrent();
        }

        function previewVoice(id, voice) {
            if (!config || pending || previewPending || id !== provider) return;
            const key = previewKey(id, voice.id);
            if (previewCache.has(key)) { playPreview(key, voice.name || voice.id); return; }
            stopPreviewAudio();
            const idValue = requestId();
            previewPending = { requestId: idValue, key, voiceId: voice.id, voiceName: voice.name || voice.id };
            const request = previewPending;
            request.timer = root.setTimeout(() => {
                if (previewPending !== request) return;
                previewPending = null;
                renderVoices();
                status('试听等待超时，请重试');
            }, 90000);
            renderVoices();
            status(`正在合成：${previewPending.voiceName}`);
            if (send({ type: 'previewTtsVoice', provider: id, voice: voice.id, requestId: idValue }) === false) {
                root.clearTimeout(request.timer);
                previewPending = null;
                renderVoices();
                status('连接已断开，无法试听');
            }
        }

        async function receivePreview(message) {
            const request = previewPending;
            if (!request || request.requestId !== message.requestId) return;
            if (!message.success) {
                root.clearTimeout(request.timer);
                previewPending = null;
                renderVoices();
                status(message.message || '试听合成失败');
                return;
            }
            try {
                // 只下载本站 TTS 内存音频，WAV 文件本身由当前面板缓存，不依赖服务端 URL 续期。
                if (!/^\/uploads\/tts\/tts_mem_[0-9a-f-]{36}\.wav$/u.test(message.audioUrl || '')) throw new Error('试听音频地址不合法');
                const response = await root.fetch(message.audioUrl, { cache: 'no-store' });
                if (!response.ok) throw new Error('试听音频下载失败');
                const wav = await response.blob();
                const header = new Uint8Array(await wav.slice(0, 12).arrayBuffer());
                if (wav.size < 12 || wav.size > 16 * 1024 * 1024
                    || String.fromCharCode(...header.slice(0, 4)) !== 'RIFF'
                    || String.fromCharCode(...header.slice(8, 12)) !== 'WAVE') throw new Error('试听音频格式不正确');
                if (previewPending !== request || previewKey(provider, request.voiceId) !== request.key) return;
                rememberPreview(request.key, wav);
                root.clearTimeout(request.timer);
                previewPending = null;
                renderVoices();
                playPreview(request.key, request.voiceName);
            } catch (error) {
                if (previewPending !== request) return;
                root.clearTimeout(request.timer);
                previewPending = null;
                renderVoices();
                status(error.message || '试听失败，请重试');
            }
        }

        function loadVoices(id) {
            if (!config || id === 'system') { renderVoices(); return; }
            const key = catalogKey(id);
            if (catalogs.has(key)) { renderVoices(); return; }
            if ([...queries.values()].some(query => query.key === key)) { renderVoices(); return; }
            const queryId = requestId();
            queries.set(queryId, { provider: id, key });
            send({ type: 'getTtsProviderVoices', provider: id, requestId: queryId });
            renderVoices();
        }

        function clearPending() {
            if (timer) root.clearTimeout(timer);
            timer = null;
            pending = null;
            refs.provider.disabled = !config;
        }

        function save(id, voice, speed, volume) {
            if (!config || pending) return;
            cancelPreview();
            const idValue = requestId();
            pending = idValue;
            refs.provider.disabled = true;
            status('正在保存…');
            renderVoices();
            const sent = send({ type: 'setChatTtsSelection', provider: id, ...(voice === undefined ? {} : { voice }),
                ...(speed === undefined ? {} : { speed }), ...(volume === undefined ? {} : { volume }), requestId: idValue });
            if (sent === false) { clearPending(); provider = config.aiReplyDefault.provider; refs.provider.value = provider;
                resetFilters(); loadVoices(provider); status('连接已断开，尚未保存'); return; }
            timer = root.setTimeout(() => {
                clearPending();
                provider = config.aiReplyDefault.provider;
                refs.provider.value = provider;
                resetFilters(); loadVoices(provider);
                status('保存未收到确认，重新同步服务器配置');
                send({ type: 'getChatTtsConfig' });
            }, 12000);
        }

        function handleServerMessage(message) {
            if (message.type === 'ttsProviderConfig' && message.config?.providers) {
                const previousKey = catalogKey(provider), wasSynced = Boolean(config);
                const ownReply = pending && pending === message.requestId;
                config = message.config;
                provider = config.aiReplyDefault?.provider || 'system';
                if (previewPending && previewKey(provider, previewPending.voiceId) !== previewPending.key) cancelPreview();
                if (!wasSynced || previousKey !== catalogKey(provider)) resetFilters();
                if (ownReply) clearPending();
                refs.provider.disabled = Boolean(pending);
                refs.provider.value = provider;
                status(message.success === false ? message.message || '保存失败，已恢复服务器设置' : '已同步当前语音设置');
                if (!refs.panel.hidden) loadVoices(provider);
                else renderVoices();
                return;
            }
            if (message.type === 'ttsProviderVoices') {
                const query = queries.get(message.requestId);
                if (!query || query.provider !== message.provider) return;
                queries.delete(message.requestId);
                if (message.success && Array.isArray(message.voices)) catalogs.set(query.key, message.voices);
                if (message.provider !== provider || query.key !== catalogKey(provider)) return;
                if (message.success === false) status(message.message || '音色查询失败');
                renderVoices();
            }
            if (message.type === 'ttsVoicePreview') void receivePreview(message);
        }

        function init(options) {
            if (initialized) return;
            prefix = options.prefix || 'display';
            refs = { toggle: document.getElementById(prefix + 'TtsVoiceToggle'), panel: document.getElementById(prefix + 'TtsVoicePanel'),
                speedControl: document.getElementById(prefix + 'TtsSpeedControl'),
                speed: document.getElementById(prefix + 'TtsSpeed'), speedValue: document.getElementById(prefix + 'TtsSpeedValue'),
                volume: document.getElementById(prefix + 'TtsVolume'), volumeValue: document.getElementById(prefix + 'TtsVolumeValue'),
                provider: document.getElementById(prefix + 'TtsProviderSelect'), search: document.getElementById(prefix + 'TtsVoiceSearch'),
                list: document.getElementById(prefix + 'TtsVoiceList'), status: document.getElementById(prefix + 'TtsVoiceStatus'),
                current: document.getElementById(prefix + 'TtsCurrentVoice'), currentName: document.getElementById(prefix + 'TtsCurrentVoiceName'),
                summary: document.getElementById(prefix + 'TtsVoiceSummary'), clear: document.getElementById(prefix + 'TtsVoiceClear'),
                count: document.getElementById(prefix + 'TtsVoiceCount'), close: document.getElementById(prefix + 'TtsVoiceClose') };
            if (Object.values(refs).some(value => !value)) return;
            refs.filters = Object.fromEntries(dimensions.map((key, index) => [key, document.getElementById(prefix + 'TtsFilter' + ['Gender', 'Age', 'Accent'][index])]));
            if (Object.values(refs.filters).some(value => !value)) return;
            initialized = true;
            send = options.send;
            const fragment = document.createDocumentFragment();
            for (const [id, title] of Object.entries(names)) {
                const option = document.createElement('option'); option.value = id; option.textContent = title; fragment.append(option);
            }
            refs.provider.replaceChildren(fragment);
            refs.provider.disabled = true;
            refs.toggle.addEventListener('click', () => {
                const open = refs.panel.hidden;
                refs.panel.hidden = !open;
                refs.toggle.setAttribute('aria-expanded', String(open));
                if (open) { options.onOpen?.(); resetFilters(); loadVoices(provider); }
                else cancelLocate();
            });
            refs.provider.addEventListener('change', () => {
                cancelPreview();
                provider = refs.provider.value;
                resetFilters();
                loadVoices(provider);
                save(provider);
            });
            refs.speed.addEventListener('input', () => { refs.speedValue.textContent = refs.speed.value; });
            refs.speed.addEventListener('change', () => {
                const speed = Number(refs.speed.value);
                if (speed === config?.providers[provider]?.defaultSpeed) return;
                save(provider, undefined, speed);
            });
            refs.volume.addEventListener('input', () => { refs.volumeValue.textContent = `${refs.volume.value}%`; });
            refs.volume.addEventListener('change', () => {
                const volume = Number(refs.volume.value);
                if (volume === config?.defaultVolume) return;
                save(provider, undefined, undefined, volume);
            });
            const filterChanged = () => { cancelLocate(); renderVoices(); refs.list.scrollTop = 0; };
            for (const key of dimensions) refs.filters[key].addEventListener('change', () => { filters[key] = refs.filters[key].value; filterChanged(); });
            refs.search.addEventListener('input', filterChanged);
            refs.clear.addEventListener('click', () => { resetFilters(false); filterChanged(); });
            refs.current.addEventListener('click', () => { resetFilters(); loadVoices(provider); });
            refs.close.addEventListener('click', close);
            document.addEventListener('click', event => {
                const path = event.composedPath();
                if (!path.includes(refs.panel) && !path.includes(refs.toggle)) close();
            });
            document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
            options.bus.subscribe('server.message', handleServerMessage);
            options.bus.subscribe('transport.changed', ({ available }) => {
                if (available) { send({ type: 'getChatTtsConfig' }); return; }
                cancelPreview();
                config = null;
                provider = 'system';
                refs.provider.value = provider;
                clearPending();
                queries.clear();
                resetFilters(false); renderVoices();
                status('连接已断开，等待同步');
            });
            status('等待同步语音设置');
            renderVoices();
            send({ type: 'getChatTtsConfig' });
        }
        return Object.freeze({ init, close });
    }
    root.TtsVoicePicker = Object.freeze({ create });
}(window));
