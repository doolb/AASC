'use strict';

// 从同一份开发映射读取档位；当前普通 LLM profile.model 是权威模型名。
const { PROVIDER_TIERS, tierRequestModel } = require('../chat2api/chat2api-default-model-mappings');
const TIERS = Object.freeze(['mini', 'flash', 'pro']);
const CONFIG_KEY = 'chat.modelTierSelection';
function identifyModel(modelName) {
    const name = String(modelName || '').trim().toLowerCase();
    if (!name) return null;
    for (const [providerId, mapping] of Object.entries(PROVIDER_TIERS)) {
        const tier = TIERS.find(tier => {
            const aliases = [mapping.models[tier], tierRequestModel(providerId, tier)];
            return aliases.some(alias => alias.toLowerCase() === name);
        });
        if (tier) return { providerId, tier };
    }
    return null;
}

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

function createChatModelTierService({ config, getRuntime, getActiveProfile, saveActiveModel, broadcast }) {
    const selection = () => {
        const active = getActiveProfile() || {};
        const preference = normalizeSelection(config.get(CONFIG_KEY));
        const identified = active.mode === 'agent' ? null : identifyModel(active.model);
        if (identified) preference.tiersByProvider[identified.providerId] = identified.tier;
        return { ...preference, providerId: identified?.providerId || null,
            modelName: active.model || '',
            requestModelName: identified ? tierRequestModel(identified.providerId, identified.tier) : null,
            profileName: active.name || '', profileMode: active.mode || 'llm' };
    };
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
            if (!Object.hasOwn(PROVIDER_TIERS, providerId)) {
                throw new Error('Provider 没有三档映射');
            }
            if (Object.hasOwn(data, 'tier') && !TIERS.includes(data.tier)) {
                throw new Error('模型档位不合法');
            }
            const providers = await availableProviders();
            if (!providers.some(provider => provider.id === providerId)) {
                throw new Error('Provider 未登录或不可用');
            }
            const active = getActiveProfile();
            if (!active || active.mode === 'agent') throw new Error('当前配置不是普通 LLM');
            const current = selection();
            const next = { providerId, tiersByProvider: { ...current.tiersByProvider } };
            const tier = data.tier || current.tiersByProvider[providerId];
            next.tiersByProvider[providerId] = tier;
            // 当前 LLM 配置保存真实提交给 Chat2API 的请求名；旧配置名称继续用于档位识别。
            const requestModel = tierRequestModel(providerId, tier);
            await saveActiveModel(requestModel, next);
            const message = { type: 'chatModelTierConfig', selection: selection(), providers,
                success: true, requestId: data.requestId };
            broadcast(message);
            return message;
        };
        const result = updating.then(task);
        updating = result.catch(() => {});
        return result;
    }

    async function resolveForChat() {
        const current = selection();
        if (current.profileMode === 'agent') return null;
        if (!current.providerId) return null;
        const runtime = getRuntime();
        if (!runtime?.getStatus?.().running) throw new Error('Chat2API 代理尚未运行');
        if (!(await availableProviders()).some(provider => provider.id === current.providerId)) {
            throw new Error('当前模型 Provider 未登录或不可用');
        }
        const tier = current.tiersByProvider[current.providerId];
        const model = tierRequestModel(current.providerId, tier);
        if (!model) throw new Error('当前 Provider 没有此档位映射');
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

module.exports = { PROVIDER_TIERS, TIERS, identifyModel, normalizeSelection, createChatModelTierService };
