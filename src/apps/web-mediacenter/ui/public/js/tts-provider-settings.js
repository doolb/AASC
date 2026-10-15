(function () {
    'use strict';

    const PROVIDERS = { system: '系统原生', 'qwen-chat': '国内千问网页', 'qwen-api': 'Qwen API', 'doubao-api': '豆包 API', 'doubao-chat': '豆包网页朗读（实验）' };
    const PROVIDER_CAPABILITIES = { system: { supportsSpeed: true }, 'qwen-chat': { supportsSpeed: true },
        'qwen-api': { supportsSpeed: true }, 'doubao-api': { supportsSpeed: true }, 'doubao-chat': { supportsSpeed: false } };
    const QWEN_API_RATE_MODELS = new Set(['qwen-audio-3.1-tts-flash', 'qwen-audio-3.0-tts-flash', 'qwen-audio-3.0-tts-plus']);
    const BUSINESSES = { aiReplyDefault: 'AI / Agent 回复', textMedia: '文本阅读', systemBroadcast: '报时与系统播报' };
    const NUMBER_FIELDS = { defaultSpeed: [-10, 10], defaultVolume: [0, 100] };
    // 此页仅编辑业务偏好；凭证、服务地址和资源 ID 统一交由 Chat2API 账户管理。
    const FIELD_LABELS = { model: '模型或 Chat2API 映射别名', defaultVoice: '默认音色 ID' };
    let config = null;
    let pendingSave = null;
    const queries = new Map();
    const catalogs = new Map();
    const fields = new Map();
    const selections = new Map();
    const sharedFields = {};
    const element = id => document.getElementById(id);
    const status = message => { element('ttsProviderStatus').textContent = message; };
    const requestId = () => `tts-provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    function create(tag, text) {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        return node;
    }

    function addField(parent, title, node) {
        const label = create('label', title);
        label.style.display = 'block';
        label.style.marginTop = '8px';
        label.appendChild(node);
        parent.appendChild(label);
        return label;
    }

    function supportsNativeSpeed(provider, model) {
        if (PROVIDER_CAPABILITIES[provider]?.supportsSpeed !== true) return false;
        return provider !== 'qwen-api' || QWEN_API_RATE_MODELS.has(String(model || '').trim());
    }

    function updateSpeedVisibility(provider) {
        const inputs = fields.get(provider);
        if (!inputs?.defaultSpeed) return;
        const supported = supportsNativeSpeed(provider, inputs.model?.value);
        const wrapper = inputs.defaultSpeed.parentElement;
        inputs.defaultSpeed.disabled = !supported;
        wrapper.hidden = !supported;
        wrapper.style.display = supported ? 'block' : 'none';
    }

    function selectProvider(business) {
        const select = create('select');
        for (const [id, title] of Object.entries(PROVIDERS)) {
            if (id === 'doubao-chat' && business !== 'aiReplyDefault') continue;
            const option = create('option', title);
            option.value = id;
            select.appendChild(option);
        }
        return select;
    }

    function send(message) {
        const ws = window.WebSocketManager?.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('连接已断开，请等待重连');
        ws.send(JSON.stringify(message));
    }

    function clearSave() {
        if (pendingSave) clearTimeout(pendingSave.timer);
        pendingSave = null;
        element('ttsProviderSaveBtn').disabled = !config;
    }

    function setVoiceList(provider) {
        const list = element(`ttsProviderVoices-${provider}`);
        const fragment = document.createDocumentFragment();
        for (const voice of catalogs.get(provider) || []) {
            const option = create('option', voice.name || voice.id);
            option.value = voice.id;
            fragment.appendChild(option);
        }
        list.replaceChildren(fragment);
        for (const selection of selections.values()) {
            selection.voice.setAttribute('list', `ttsProviderVoices-${selection.provider.value}`);
        }
    }

    function updateSelectionVoice(selection) {
        const native = selection.provider.value === 'system';
        selection.voice.readOnly = false;
        selection.voice.disabled = native;
        selection.voice.parentElement.hidden = native;
        // 标签原有内联display会覆盖hidden，显式隐藏避免原生显示无效音色输入。
        selection.voice.parentElement.style.display = native ? 'none' : 'block';
        setVoiceList(selection.provider.value);
        updateTemplateVoice();
    }

    function updateTemplateVoice() {
        const provider = element('templateTtsProvider');
        const voice = element('templateTtsVoice');
        if (!provider || !voice) return;
        const selected = provider.value || selections.get('aiReplyDefault')?.provider.value || 'system';
        const native = selected === 'system';
        voice.readOnly = false;
        voice.disabled = native;
        voice.hidden = native;
        voice.style.display = native ? 'none' : '';
    }

    function loadVoices(provider) {
        if (provider === 'system') return;
        if (queries.has(provider)) return;
        const id = requestId();
        try {
            send({ type: 'getTtsProviderVoices', provider, requestId: id });
            const timer = setTimeout(() => {
                queries.delete(provider);
                fields.get(provider).voiceStatus.textContent = '音色查询超时，已保留当前 ID';
            }, 10000);
            queries.set(provider, { id, timer });
            fields.get(provider).voiceStatus.textContent = '正在查询音色…';
        } catch (error) { fields.get(provider).voiceStatus.textContent = error.message; }
    }

    function init() {
        const host = element('ttsProviderFields');
        if (!host) return;
        const fragment = document.createDocumentFragment();
        const shared = create('section');
        shared.className = 'tts-provider-shared-parameters';
        shared.appendChild(create('strong', '全局音量'));
        shared.appendChild(create('p', '对 AI/Agent 回复、文本阅读、系统播报和所有语音服务生效；单次合成音量可覆盖此默认值。语速在各 Provider 设置中分别配置。'));
        for (const [name, title] of [['defaultVolume', '音量（0 至 100）']]) {
            const input = create('input');
            input.dataset.ttsSharedField = name;
            input.type = 'number';
            input.min = NUMBER_FIELDS[name][0];
            input.max = NUMBER_FIELDS[name][1];
            input.step = '1';
            input.autocomplete = 'off';
            sharedFields[name] = input;
            addField(shared, title, input);
        }
        fragment.appendChild(shared);
        for (const [key, title] of Object.entries(BUSINESSES)) {
            const group = create('div');
            group.className = 'tts-provider-business';
            const provider = selectProvider(key);
            const voice = create('input');
            voice.type = 'text';
            voice.placeholder = '音色 ID，留空使用服务默认';
            voice.maxLength = 512;
            provider.addEventListener('change', () => updateSelectionVoice({ provider, voice }));
            addField(group, title, provider);
            addField(group, '音色', voice);
            selections.set(key, { provider, voice });
            fragment.appendChild(group);
        }
        for (const [id, title] of Object.entries(PROVIDERS)) {
            const group = create('details');
            group.className = 'tts-provider-details';
            group.dataset.ttsProvider = id;
            group.appendChild(create('summary', `${title} 设置`));
            group.style.marginTop = '16px';
            const inputs = {};
            if (id !== 'system') {
                const enabled = create('input');
                enabled.type = 'checkbox';
                inputs.enabled = enabled;
                addField(group, '启用', enabled);
            }
            if (PROVIDER_CAPABILITIES[id]?.supportsSpeed) {
                const speed = create('input');
                speed.dataset.ttsField = 'defaultSpeed';
                speed.type = 'number';
                speed.min = NUMBER_FIELDS.defaultSpeed[0];
                speed.max = NUMBER_FIELDS.defaultSpeed[1];
                speed.step = '1';
                speed.autocomplete = 'off';
                inputs.defaultSpeed = speed;
                addField(group, '语速（−10 至 10）', speed);
            }
            const names = id === 'system' ? [] : id === 'doubao-chat' ? ['defaultVoice'] : Object.keys(FIELD_LABELS);
            for (const name of names) {
                const restrictedModel = id === 'qwen-chat' && name === 'model';
                const input = create('input');
                input.dataset.ttsField = name;
                input.type = NUMBER_FIELDS[name] ? 'number' : 'text';
                input.autocomplete = 'off';
                input.maxLength = 512;
                if (NUMBER_FIELDS[name]) [input.min, input.max] = NUMBER_FIELDS[name];
                if (restrictedModel) {
                    // 保留网页支持模型候选，同时允许显式映射别名；实际目标能力由服务器校验。
                    const models = create('datalist');
                    models.id = 'ttsProviderModels-qwen-chat';
                    for (const [model, title] of Object.entries({ QUARK_VOICE: 'QUARK_VOICE（默认）', MINI_MAX: 'MINI_MAX（需匹配音色）' })) {
                        const option = create('option', title);
                        option.value = model;
                        models.appendChild(option);
                    }
                    group.appendChild(models);
                    input.setAttribute('list', models.id);
                }
                if (id === 'doubao-chat') input.readOnly = false;
                if (name === 'defaultVoice') input.setAttribute('list', `ttsProviderVoices-${id}`);
                inputs[name] = input;
                addField(group, FIELD_LABELS[name], input);
            }
            if (id === 'qwen-chat') {
                group.appendChild(create('p', '由 Chat2API 提供语音合成，账号和登录状态请在 Chat2API 账户管理中维护。'));
                group.appendChild(create('p', '网页模型默认 QUARK_VOICE；MINI_MAX 需匹配音色。可填写映射到该网页来源的 Chat2API 别名；qwen3-tts-flash 请使用 Qwen API。'));
            }
            if (id === 'doubao-chat') {
                group.appendChild(create('p', '实验性网页朗读，默认关闭，尚未重新进行真实账号合成验收。'));
                group.appendChild(create('p', '在Chat2API启用可用豆包网页账号，显式账号映射仍优先；音色由Chat2API官网目录提供，上游使用固定速度和音量，返回后只应用全局音量，失败不切换其它来源。'));
            }
            if (['qwen-api', 'doubao-api'].includes(id)) {
                group.appendChild(create('p', `由 Chat2API 的 ${id === 'qwen-api' ? 'qwen-api' : 'doubaapi'} 提供语音合成。请在 Chat2API 添加 API 账号时配置 API Key、可选服务端点${id === 'doubao-api' ? '与资源 ID' : ''}；留空使用官方默认。`));
                group.appendChild(create('p', `可填写该来源的模型或映射别名${id === 'qwen-api' ? '，例如 qiaoxiaojiao' : ''}；这里只保存启用、模型、音色及本Provider语速；音量使用上方全局设置。账号保存仅校验格式，尚未远端验证。`));
                if (id === 'qwen-api') group.appendChild(create('p', '语速只对原生支持 input.rate 的 Qwen-Audio 3.0/3.1 TTS 模型显示；Qwen3-TTS HTTP 接口未声明语速参数时隐藏。'));
            }
            if (id === 'system') group.appendChild(create('p', '沿用现有 TTS 生成设备、服务器开关及原生音色配置。'));
            const query = create('button', '查询音色');
            query.type = 'button';
            query.className = 'control-btn';
            query.addEventListener('click', () => loadVoices(id));
            if (id !== 'system') group.appendChild(query);
            inputs.voiceStatus = create('span');
            inputs.voiceStatus.setAttribute('role', 'status');
            group.appendChild(inputs.voiceStatus);
            const list = create('datalist');
            list.id = `ttsProviderVoices-${id}`;
            group.appendChild(list);
            fields.set(id, inputs);
            inputs.model?.addEventListener('input', () => updateSpeedVisibility(id));
            updateSpeedVisibility(id);
            fragment.appendChild(group);
        }
        host.replaceChildren(fragment);
        host.querySelectorAll('input:not([type="checkbox"]), select').forEach(input => {
            input.style.width = '100%';
            input.style.boxSizing = 'border-box';
            input.style.marginTop = '4px';
            input.style.padding = '6px 8px';
            input.style.borderRadius = '6px';
        });
        element('ttsProviderSaveBtn').addEventListener('click', save);
        element('templateTtsProvider')?.addEventListener('change', updateTemplateVoice);
        element('ttsProviderSaveBtn').disabled = true;
    }

    function handleConfig(message) {
        if (!message.config?.providers) return;
        const isReply = pendingSave && message.requestId === pendingSave.id;
        config = message.config;
        for (const [name, input] of Object.entries(sharedFields)) input.value = config[name] ?? '';
        for (const [key, selection] of selections) {
            selection.provider.value = config[key]?.provider || 'system';
            updateSelectionVoice(selection);
            // 权威配置回填在来源状态更新后进行，避免离开豆包只读状态时误清空服务端音色。
            selection.voice.value = config[key]?.voice || (selection.provider.value === 'doubao-chat' ? config.providers['doubao-chat']?.defaultVoice || '' : '');
        }
        for (const [id, inputs] of fields) {
            const value = config.providers[id];
            if (!value) continue;
            for (const [name, input] of Object.entries(inputs)) {
                if (name === 'voiceStatus') continue;
                if (input.type === 'checkbox') input.checked = Boolean(value[name]);
                else input.value = value[name] ?? '';
            }
            updateSpeedVisibility(id);
            setVoiceList(id);
        }
        if (isReply) {
            clearSave();
            status(message.success === false ? message.message || '保存失败，已恢复服务器配置' : '已保存，所有控制端已同步');
        } else if (!pendingSave) {
            element('ttsProviderSaveBtn').disabled = false;
            status('已同步服务器配置');
        }
    }

    function save() {
        if (!config || pendingSave) return;
        const patch = { providers: {} };
        for (const [name, input] of Object.entries(sharedFields)) patch[name] = input.value;
        for (const [key, selection] of selections) patch[key] = { provider: selection.provider.value, voice: selection.provider.value === 'system' ? null : selection.voice.value.trim() || null };
        for (const [id, inputs] of fields) {
            const settings = {};
            for (const [name, input] of Object.entries(inputs)) {
                if (name === 'voiceStatus') continue;
                if (name === 'defaultSpeed' && input.disabled) continue;
                settings[name] = input.type === 'checkbox' ? input.checked : input.value;
            }
            patch.providers[id] = settings;
        }
        const id = requestId();
        try {
            send({ type: 'setTtsProviderConfig', requestId: id, config: patch });
            pendingSave = { id, timer: setTimeout(() => { clearSave(); status('未收到保存确认，请重连后核对配置'); }, 10000) };
            element('ttsProviderSaveBtn').disabled = true;
            status('正在等待服务器保存确认…');
        } catch (error) { status(error.message); }
    }

    function handleVoices(message) {
        const pending = queries.get(message.provider);
        if (!pending || pending.id !== message.requestId) return;
        clearTimeout(pending.timer);
        queries.delete(message.provider);
        const inputs = fields.get(message.provider);
        if (!message.success) {
            inputs.voiceStatus.textContent = `${message.message || '查询失败'}，已保留当前 ID`;
            return;
        }
        const voices = (message.voices || []).filter(voice => typeof voice.id === 'string');
        catalogs.set(message.provider, voices);
        setVoiceList(message.provider);
        const custom = inputs.defaultVoice.value && !voices.some(voice => voice.id === inputs.defaultVoice.value);
        inputs.voiceStatus.textContent = message.provider === 'doubao-chat' ? '网页固定默认音色，尚未重新进行真实合成验收'
            : custom ? '当前 ID 不在候选目录中，保留并在合成时验证' : `已加载 ${voices.length} 个音色候选，可填写其他有效 ID`;
    }

    function handleDisconnected() {
        clearSave();
        config = null;
        element('ttsProviderSaveBtn').disabled = true;
        for (const [id, pending] of queries) {
            clearTimeout(pending.timer);
            fields.get(id).voiceStatus.textContent = '连接已断开，已保留当前 ID';
        }
        queries.clear();
        status('连接已断开，等待服务器重新同步');
    }

    window.TtsProviderSettings = { init, handleConfig, handleVoices, handleDisconnected, save, loadVoices, updateTemplateVoice,
        getConfig: () => config, getProviderCapabilities: () => PROVIDER_CAPABILITIES, supportsNativeSpeed };
    init();
})();
