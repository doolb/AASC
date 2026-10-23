'use strict';

// 从同一份开发映射读取档位；当前普通 LLM profile.model 是权威模型名。
const { PROVIDER_TIERS, tierRequestModel } = require('../chat2api/chat2api-default-model-mappings');
const { VIDEO_MODELS, resolveVideoModel } = require('../chat2api/chat2api-video-catalog');
const { IMAGE_MODELS, resolveImageModel } = require('../chat2api/chat2api-image-catalog');
const { createMotionModelService } = require('../sub-ai/motion-model-service');
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
    const motion = createMotionModelService({ config, getRuntime });
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

    const imageSelection = () => config.get('chat.imageSelection') || { providerId: null, model: null };
    async function imageProviders() {
        const runtime = getRuntime();
        if (!runtime?.getStatus?.().running) return [];
        const accounts = await runtime.dataStore.listAccounts();
        return [...new Set(IMAGE_MODELS.map(model => model.providerId))]
            .filter(id => accounts.some(account => account.providerId === id && account.enabled !== false
                && account.secretConfigured !== false && (!account.status || account.status === 'active')))
            .map(id => ({ id, name: PROVIDER_TIERS[id]?.label || id,
                models: IMAGE_MODELS.filter(model => model.providerId === id).map(({ id, name, referenceLimit = 0 }) => ({ id, name, referenceLimit })) }));
    }
    const videoSelection = () => config.get('chat.videoSelection') || { providerId:null, model:null };
    async function videoProviders() {
        const runtime=getRuntime();
        if(!runtime?.getStatus?.().running || !runtime.videoService)return [];
        const [accounts, providers]=await Promise.all([runtime.dataStore.listAccounts(),runtime.providerRegistry.listProviders()]);
        return [...new Set(VIDEO_MODELS.map(model=>model.providerId))].filter(id=>providers.some(p=>p.id===id&&p.enabled!==false)
            &&accounts.some(account=>account.providerId===id&&account.enabled!==false&&account.secretConfigured!==false&&(!account.status||account.status==='active')))
            .map(id=>({id,name:PROVIDER_TIERS[id]?.label||id,models:VIDEO_MODELS.filter(model=>model.providerId===id).map(({id,name,referenceLimit})=>({id,name,referenceLimit}))}));
    }
    async function createVideo(input,options) {
        const runtime=getRuntime();
        if(!runtime?.getStatus?.().running||!runtime.videoService)throw new Error('Chat2API生视频服务尚未运行');
        return runtime.videoService.create({...input,model:videoSelection().model},options);
    }
    async function waitVideo(id,options) {
        const runtime=getRuntime();
        if(!runtime?.videoService)throw new Error('Chat2API生视频服务尚未运行');
        return runtime.videoService.wait(id,options);
    }
    async function snapshot(extra = {}) {
        return { type: 'chatModelTierConfig', selection: selection(), providers: await availableProviders(),
            uploadCapabilities: { images: getActiveProfile()?.supportsImageUpload !== false, videos: getActiveProfile()?.supportsVideoUpload === true,
                disabled: getActiveProfile()?.mode === 'agent' },
            imageSelection: imageSelection(), imageProviders: await imageProviders(),
            videoSelection:videoSelection(),videoProviders:await videoProviders(),
            motionSelection: motion.selection(), motionRevision: motion.revision(), motionProviders: await motion.providers(), ...extra };
    }
    async function generateImage(input, options) {
        const runtime = getRuntime();
        if (!runtime?.getStatus?.().running || !runtime.imageService) throw new Error('Chat2API 生图服务尚未运行');
        return runtime.imageService.generate({ ...input, model: imageSelection().model }, options);
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
            if (data?.purpose === 'motion') {
                await motion.update(data);
                const message = await snapshot({ success: true, requestId: data.requestId });
                broadcast(message); return message;
            }
            if(data?.purpose==='video') {
                const model=resolveVideoModel(data.model);
                if(model.providerId!==data.providerId||!(await videoProviders()).some(provider=>provider.id===model.providerId))throw new Error('生视频Provider未登录或模型不匹配');
                if(await config.set('chat.videoSelection',{providerId:model.providerId,model:model.id})===false)throw new Error('生视频设置保存失败');
                const current=await snapshot({success:true});broadcast(current);return current;
            }
            if (data?.purpose === 'image') {
                const model = resolveImageModel(data.model);
                if (model.providerId !== data.providerId || !(await imageProviders()).some(p => p.id === model.providerId)) {
                    throw new Error('生图 Provider 未登录或模型不匹配');
                }
                const saved = await config.set('chat.imageSelection', { providerId: model.providerId, model: model.id });
                if (saved === false) throw new Error('生图设置保存失败');
                const message = await snapshot({ success: true, requestId: data.requestId });
                broadcast(message);
                return message;
            }
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
                async uploadFile(file, options = {}) {
                    if (!runtime.inputFiles?.put) throw new Error('当前Chat2API实例尚未接入视频文件上传');
                    return runtime.inputFiles.put(file, options);
                },
                async request(payload, options = {}) {
                    const result = await runtime.responsesService.createResponse({ ...payload, model }, { signal: options.signal, onStatus: options.onStatus });
                    return result.body;
                },
                async stream(payload, onEvent, options = {}) {
                    const result = await runtime.responsesService.createResponse({ ...payload, model, stream: true }, {
                        signal: options.signal, onStatus: status => onEvent({ type: 'response.progress', ...status }) });
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

    return { motion, snapshot, sendSnapshot, update, resolveForChat, selection, availableProviders, imageSelection, generateImage, videoSelection, createVideo, waitVideo };
}

module.exports = { PROVIDER_TIERS, TIERS, identifyModel, normalizeSelection, createChatModelTierService };
