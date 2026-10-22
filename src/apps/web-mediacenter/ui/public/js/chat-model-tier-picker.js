/* 聊天模型三档快选：两端共用展示和交互，服务端配置始终为权威值。 */
(function exposeChatModelTierPicker(root) {
    'use strict';
    const LABELS = Object.freeze({ mini: '轻量', flash: '普通', pro: '专业' });

    function create({ host, prefix, send, onOpen }) {
        if (!host || typeof send !== 'function') return null;
        const isDisplay = prefix === 'display';
        const button = document.createElement('button');
        button.id = `${prefix}ChatModelTierToggle`;
        button.type = 'button';
        button.className = isDisplay ? 'display-stage-button' : 'floating-control-toggle control-chat-model-tier-toggle';
        button.textContent = '模型';
        button.setAttribute('aria-controls', `${prefix}ChatModelTierPanel`);
        button.setAttribute('aria-expanded', 'false');
        const panel = document.createElement('section');
        panel.id = `${prefix}ChatModelTierPanel`;
        panel.className = isDisplay
            ? 'display-mmd-lighting-panel chat-model-tier-panel'
            : 'control-chat-model-tier-panel chat-model-tier-panel';
        panel.setAttribute('aria-label', '聊天模型选择');
        panel.hidden = true;
        panel.innerHTML = `<div class="chat-model-tier-header"><strong>聊天模型</strong><button type="button" data-close aria-label="关闭模型面板">×</button></div>
            <p class="chat-model-tier-scope">两端共享；只影响后续普通 LLM 聊天。</p>
            <label>当前 Provider<select data-provider disabled></select></label>
            <p class="chat-model-tier-current" data-current-model></p>
            <div class="chat-model-tier-levels" role="group" aria-label="模型档位"></div>
            <button type="button" class="chat-model-tier-login" data-login disabled title="后续版本开放">外部登录（后续开放）</button>
            <hr><strong>生图模型</strong><label>Provider<select data-image-provider></select></label>
            <label>模型<select data-image-model></select></label><p data-image-note class="chat-model-tier-scope"></p>
            <p class="chat-model-tier-status" data-status role="status"></p>`;
        host.append(button, panel);

        const providerSelect = panel.querySelector('[data-provider]');
        const imageProvider = panel.querySelector('[data-image-provider]');
        const imageModel = panel.querySelector('[data-image-model]');
        const levels = panel.querySelector('.chat-model-tier-levels');
        const currentModel = panel.querySelector('[data-current-model]');
        const status = panel.querySelector('[data-status]');
        let connected = false;
        let snapshot = null;

        function close() {
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        }

        function render() {
            const imageProviders = snapshot?.imageProviders || [];
            const imageSelection = snapshot?.imageSelection || {};
            const fill = (select, items, value) => {
                select.replaceChildren();
                for (const item of [{ id: '', name: '请选择' }, ...items]) {
                    const option = document.createElement('option');
                    option.value = item.id; option.textContent = item.name; select.append(option);
                }
                select.value = value || ''; select.disabled = !connected || !snapshot;
            };
            fill(imageProvider, imageProviders, imageSelection.providerId);
            fill(imageModel, imageProviders.find(p => p.id === imageSelection.providerId)?.models || [], imageSelection.model);
            const selectedImage = imageProviders.find(p => p.id === imageSelection.providerId)?.models.find(m => m.id === imageSelection.model);
            panel.querySelector('[data-image-note]').textContent = selectedImage
                ? selectedImage.referenceLimit ? `支持最多 ${selectedImage.referenceLimit} 张参考图` : '当前模型支持文字生图'
                : '请选择生图 Provider 和模型';
            const selection = snapshot?.selection || {};
            const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
            const providerId = selection.providerId || '';
            const isAgent = selection.profileMode === 'agent';
            const options = [{ id: '', name: isAgent ? 'Agent 配置' : '请选择 Provider' }, ...providers];
            if (providerId && !providers.some(provider => provider.id === providerId)) {
                options.push({ id: providerId, name: `${providerId}（当前不可用）` });
            }
            providerSelect.replaceChildren();
            for (const provider of options) {
                const option = document.createElement('option');
                option.value = provider.id;
                option.textContent = provider.name;
                providerSelect.append(option);
            }
            providerSelect.value = providerId;
            providerSelect.disabled = !connected || !snapshot || isAgent;
            currentModel.textContent = isAgent
                ? 'Chat2API 请求模型名：不适用（Agent 配置）'
                : selection.requestModelName
                    ? `Chat2API 请求模型名：${selection.requestModelName}`
                    : `当前配置模型名（未匹配三档）：${selection.modelName || '未配置'}`;
            levels.replaceChildren();
            const tier = selection.tiersByProvider?.[providerId];
            for (const [value, label] of Object.entries(LABELS)) {
                const level = document.createElement('button');
                level.type = 'button';
                level.textContent = label;
                const selected = value === tier && Boolean(providerId);
                level.className = selected ? 'is-selected' : 'is-unselected';
                level.setAttribute('aria-pressed', String(selected));
                level.disabled = !connected || isAgent || !providerId || !providers.some(provider => provider.id === providerId);
                level.addEventListener('click', () => choose(providerId, value));
                levels.append(level);
            }
            if (!connected) status.textContent = '等待连接服务器';
            else if (!snapshot) status.textContent = '等待同步模型设置';
            else if (isAgent) status.textContent = '当前为 Agent 配置，请先切换到普通 LLM 配置';
            else if (providers.length === 0) status.textContent = '暂无已配置账号且支持三档的 Provider';
            else if (providerId && !providers.some(provider => provider.id === providerId)) status.textContent = '当前 Provider 不可用，请重新选择';
            else status.textContent = providerId
                ? `当前：${options.find(provider => provider.id === providerId)?.name || providerId} · ${tier ? LABELS[tier] : '未设置档位'}`
                : '当前模型名未匹配三档，仍沿用 LLM 配置';
        }

        function choose(providerId, tier) {
            if (!providerId) return;
            const message = { type: 'setChatModelTierSelection', providerId,
                ...(tier ? { tier } : {}) };
            if (!send(message)) {
                render();
                status.textContent = '连接中断，选择未保存';
                return;
            }
            render();
            status.textContent = '正在保存…';
        }

        button.addEventListener('click', () => {
            const opening = panel.hidden;
            panel.hidden = !opening;
            button.setAttribute('aria-expanded', String(opening));
            if (opening) {
                onOpen?.();
                if (connected) send({ type: 'getChatModelTierConfig' });
            }
        });
        panel.querySelector('[data-close]').addEventListener('click', close);
        providerSelect.addEventListener('change', () => choose(providerSelect.value,
            snapshot?.selection?.tiersByProvider?.[providerSelect.value]));
        const chooseImage = (providerId, model) => {
            if (!providerId || !model) return;
            const sent = send({ type: 'setChatModelTierSelection', purpose: 'image', providerId, model });
            render(); status.textContent = sent ? '正在保存生图设置…' : '连接中断，选择未保存';
        };
        imageProvider.addEventListener('change', () => chooseImage(imageProvider.value,
            snapshot?.imageProviders?.find(p => p.id === imageProvider.value)?.models[0]?.id));
        imageModel.addEventListener('change', () => chooseImage(imageProvider.value, imageModel.value));
        render();

        return Object.freeze({
            close,
            handleMessage(message) {
                if (message?.type !== 'chatModelTierConfig') return;
                snapshot = message;
                render();
                if (message.success === false) status.textContent = message.message || '模型设置未保存';
            },
            setConnected(value) {
                connected = value === true;
                if (!connected) snapshot = null;
                render();
                if (connected) send({ type: 'getChatModelTierConfig' });
            },
            openExternalLogin() { return false; }
        });
    }

    root.ChatModelTierPicker = Object.freeze({ create });
}(window));
