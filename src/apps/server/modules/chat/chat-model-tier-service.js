'use strict';

// 三档映射由开发维护；UI 只保存当前 Provider 和各 Provider 的偏好档位。
const PROVIDER_TIERS = Object.freeze({
    qwen: Object.freeze({ label: 'Qwen', defaultTier: 'flash', models: Object.freeze({
        mini: 'aasc-qwen-mini', flash: 'aasc-qwen-flash', pro: 'aasc-qwen-pro'
    }), actualModels: Object.freeze({
        mini: 'Qwen3.6-Flash', flash: 'Qwen3.7', pro: 'Qwen3.7-Max'
    }) }),
    doubaochat: Object.freeze({ label: '豆包', defaultTier: 'mini', models: Object.freeze({
        mini: 'doubao', flash: 'doubao-think', pro: 'doubao-expert'
    }), actualModels: Object.freeze({
        mini: 'doubao', flash: 'doubao-think', pro: 'doubao-expert'
    }) })
});
const TIERS = Object.freeze(['mini', 'flash', 'pro']);
const CONFIG_KEY = 'chat.modelTierSelection';

function normalizeSelection(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const tiersByProvider = {};
    for (const [providerId, mapping] of Object.entries(PROVIDER_TIERS)) {
        const configured = source.tiersByProvider?.[providerId];
        tiersByProvider[providerId] = TIERS.includes(configured) ? configured : mapping.defaultTier;
    }
    return {
        providerId: Object.hasOwn(PROVIDER_TIERS, source.providerId) ? source.providerId : null,
        tiersByProvider
    };
}

function createChatModelTierService({ config, getRuntime, broadcast }) {
    const selection = () => normalizeSelection(config.get(CONFIG_KEY));
    let updating = Promise.resolve();

    async function availableProviders() {
        const runtime = getRuntime();
        if (!runtime?.getStatus?.().running) return [];
        const [accounts, providers] = await Promise.all([
            runtime.dataStore.listAccounts(), runtime.providerRegistry.listProviders()
        ]);
        const enabledIds = new Set(accounts.filter(account => account.enabled !== false && account.secretConfigured !== false
            && (!account.status || account.status === 'active')).map(account => account.providerId));
        return providers.filter(provider => Object.hasOwn(PROVIDER_TIERS, provider.id)
            && provider.enabled !== false && enabledIds.has(provider.id)).map(provider => ({
            id: provider.id, name: PROVIDER_TIERS[provider.id].label
        }));
    }

    async function snapshot(extra = {}) {
        return { type: 'chatModelTierConfig', selection: selection(), providers: await availableProviders(), ...extra };
    }

    async function sendSnapshot(ws, extra = {}) {
        try {
            if (ws.readyState === 1) ws.send(JSON.stringify(await snapshot(extra)));
        } catch (error) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'chatModelTierConfig', selection: selection(),
                providers: [], success: false, message: error.message, ...extra }));
        }
    }

    async function update(data) {
        const task = async () => {
            if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'providerId')) {
                throw new Error('缺少 Provider 选择');
            }
            const providerId = data.providerId;
            if (providerId !== null && !Object.hasOwn(PROVIDER_TIERS, providerId)) {
                throw new Error('Provider 没有三档映射');
            }
            if (Object.hasOwn(data, 'tier') && !TIERS.includes(data.tier)) {
                throw new Error('模型档位不合法');
            }
            if (providerId && !(await availableProviders()).some(provider => provider.id === providerId)) {
                throw new Error('Provider 未登录或不可用');
            }
            const next = selection();
            next.providerId = providerId;
            if (providerId && data.tier) next.tiersByProvider[providerId] = data.tier;
            if (config.set(CONFIG_KEY, next) === false) throw new Error('模型档位保存失败');
            const message = await snapshot({ success: true, requestId: data.requestId });
            broadcast(message);
            return message;
        };
        const result = updating.then(task);
        updating = result.catch(() => {});
        return result;
    }

    async function resolveForChat() {
        const current = selection();
        if (!current.providerId) return null;
        const runtime = getRuntime();
        if (!runtime?.getStatus?.().running) throw new Error('Chat2API 代理尚未运行');
        if (!(await availableProviders()).some(provider => provider.id === current.providerId)) {
            throw new Error('当前模型 Provider 未登录或不可用');
        }
        const tier = current.tiersByProvider[current.providerId];
        const model = PROVIDER_TIERS[current.providerId].models[tier];
        if (!model) throw new Error('当前 Provider 没有此档位映射');
        const binding = await runtime.modelMapper.resolveModel(model);
        if (binding.preferredProviderId !== current.providerId
            || binding.actualModel !== PROVIDER_TIERS[current.providerId].actualModels[tier]) {
            throw new Error('模型档位映射与 Provider 不一致');
        }
        return {
            providerId: current.providerId, tier, model,
            client: {
                async request(payload) {
                    const result = await runtime.responsesService.createResponse({ ...payload, model });
                    return result.body;
                },
                async stream(payload, onEvent) {
                    const result = await runtime.responsesService.createResponse({ ...payload, model, stream: true });
                    let completed = false;
                    for await (const event of result.stream) {
                        onEvent(event);
                        if (event.type === 'response.failed') {
                            const error = new Error(event.error?.message || 'Chat2API 回复失败');
                            error.code = event.error?.code || 'response_failed';
                            error.statusCode = event.error?.statusCode || 502;
                            throw error;
                        }
                        if (event.type === 'response.completed') completed = true;
                    }
                    if (!completed) {
                        const error = new Error('Chat2API 回复流提前结束');
                        error.code = 'responses_stream_interrupted';
                        throw error;
                    }
                }
            }
        };
    }

    return { snapshot, sendSnapshot, update, resolveForChat, selection, availableProviders };
}

module.exports = { PROVIDER_TIERS, TIERS, normalizeSelection, createChatModelTierService };
