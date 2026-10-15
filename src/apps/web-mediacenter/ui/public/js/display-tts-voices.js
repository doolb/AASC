/* 显示端TTS快选：只编辑声纹页已有的AI默认方式/音色，所有状态以服务端回显为准。 */
(function exposeDisplayTtsVoices(root) {
    'use strict';
    const names = { system: '系统原生', 'qwen-chat': '国内千问网页', 'qwen-api': 'Qwen API',
        'doubao-api': '豆包 API', 'doubao-chat': '豆包网页朗读' };
    const catalogs = new Map();
    const queries = new Map();
    let initialized = false, config = null, provider = 'system', sequence = 0, send, refs, pending = null, timer = null;
    const requestId = () => `display-tts-${Date.now()}-${++sequence}`;
    const status = text => { refs.status.textContent = text || ''; };
    const close = () => { refs.panel.hidden = true; refs.toggle.setAttribute('aria-expanded', 'false'); };
    const catalogKey = id => `${id}|${config?.providers[id]?.model || ''}`;

    function renderVoices() {
        const query = refs.search.value.trim().toLowerCase();
        const current = config?.aiReplyDefault?.provider === provider ? config.aiReplyDefault.voice : config?.providers[provider]?.defaultVoice;
        const fragment = document.createDocumentFragment();
        const values = catalogs.get(catalogKey(provider)) || [];
        for (const gender of ['female', 'male', 'other']) {
            const entries = values.filter(voice => (voice.gender || 'other') === gender
                && `${voice.name} ${voice.id} ${(voice.tags || []).join(' ')}`.toLowerCase().includes(query));
            if (!entries.length) continue;
            const heading = document.createElement('strong');
            heading.textContent = ({ female: '女声', male: '男声', other: '音色' })[gender];
            fragment.append(heading);
            for (const voice of entries) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'display-tts-voice-option';
                button.dataset.voiceId = voice.id;
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', String(voice.id === current));
                button.disabled = Boolean(pending);
                button.textContent = voice.name || voice.id;
                const tags = document.createElement('small');
                tags.textContent = (voice.tags || []).join(' · ');
                button.append(tags);
                button.addEventListener('click', () => save(provider, voice.id));
                fragment.append(button);
            }
        }
        if (!fragment.childNodes.length) {
            const message = document.createElement('p');
            message.textContent = provider === 'system' ? '沿用系统原生音色' : query ? '没有匹配的音色' : '正在查询音色，或该方式尚无目录';
            fragment.append(message);
        }
        refs.list.replaceChildren(fragment);
    }

    function loadVoices(id) {
        if (!config || id === 'system') { renderVoices(); return; }
        const key = catalogKey(id);
        if (catalogs.has(key)) { renderVoices(); return; }
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

    function save(id, voice) {
        if (!config || pending) return;
        const idValue = requestId();
        pending = idValue;
        refs.provider.disabled = true;
        status('正在保存…');
        renderVoices();
        const sent = send({ type: 'setChatTtsSelection', provider: id, ...(voice === undefined ? {} : { voice }), requestId: idValue });
        if (sent === false) { clearPending(); status('连接已断开，尚未保存'); return; }
        timer = root.setTimeout(() => {
            clearPending();
            provider = config.aiReplyDefault.provider;
            refs.provider.value = provider;
            renderVoices();
            status('保存未收到确认，重新同步服务器配置');
            send({ type: 'getChatTtsConfig' });
        }, 12000);
    }

    function handleServerMessage(message) {
        if (message.type === 'ttsProviderConfig' && message.config?.providers) {
            const ownReply = pending && pending === message.requestId;
            config = message.config;
            provider = config.aiReplyDefault?.provider || 'system';
            if (ownReply) clearPending();
            refs.provider.disabled = Boolean(pending);
            refs.provider.value = provider;
            const voice = config.aiReplyDefault?.voice || config.providers[provider]?.defaultVoice;
            const known = catalogs.get(catalogKey(provider))?.find(item => item.id === voice);
            refs.toggle.title = `${names[provider]}：${known?.name || voice || '默认音色'}`;
            status(message.success === false ? message.message || '保存失败，已恢复服务器设置' : config.providers[provider]?.enabled === false ? '该方式尚未启用，请在声纹页启用' : '已同步当前语音设置');
            if (!refs.panel.hidden) loadVoices(provider);
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
    }

    function init(options) {
        if (initialized) return;
        refs = { toggle: document.getElementById('displayTtsVoiceToggle'), panel: document.getElementById('displayTtsVoicePanel'),
            provider: document.getElementById('displayTtsProviderSelect'), search: document.getElementById('displayTtsVoiceSearch'),
            list: document.getElementById('displayTtsVoiceList'), status: document.getElementById('displayTtsVoiceStatus') };
        if (Object.values(refs).some(value => !value)) return;
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
            if (open) { root.DisplayMmdLighting?.close(); loadVoices(provider); }
        });
        refs.provider.addEventListener('change', () => {
            provider = refs.provider.value;
            refs.search.value = '';
            loadVoices(provider);
            save(provider);
        });
        refs.search.addEventListener('input', renderVoices);
        document.addEventListener('click', event => {
            if (!refs.panel.contains(event.target) && !refs.toggle.contains(event.target)) close();
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        options.bus.subscribe('server.message', handleServerMessage);
        options.bus.subscribe('transport.changed', ({ available }) => {
            if (available) { send({ type: 'getChatTtsConfig' }); return; }
            config = null;
            clearPending();
            queries.clear();
            status('连接已断开，等待同步');
        });
        status('等待同步语音设置');
        send({ type: 'getChatTtsConfig' });
    }
    root.DisplayTtsVoices = Object.freeze({ init });
}(window));
