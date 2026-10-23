'use strict';
const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { VIDEO_MODELS, resolveVideoModel } = require('./chat2api-video-catalog');
const { createVideoJobs, videoError } = require('./chat2api-video-jobs');
const { createGlmAuthHeaders } = require('./chat2api-glm-auth');
const { createQwenChatUpload } = require('./chat2api-qwen-chat-upload');
const { inspectNativeVideos } = require('./chat2api-native-videos');
const { decodeChatImage } = require('./chat2api-chat-media');
const { normalizeOutputVideos } = require('../../../../core/utils/chat-output-videos');

function createChat2ApiVideoService({ dataStore, providerRegistry, browserBridge, http = axios, adapters = {}, ...limits }) {
    const qwenUpload = createQwenChatUpload({ http });
    const { buildProviderHeaders, createQwenRequest } = require('./chat2api-provider-adapters');
    async function accountFor(job) {
        const account = await dataStore.getAccount(job.accountId);
        if (!account || account.enabled === false || account.providerId !== job.providerId || account.status && account.status !== 'active') throw videoError('video_account_missing', '原视频任务账号已失效', 401);
        return account;
    }
    async function glmHeaders(account, signal) {
        const credentials = account.credentials || {};
        const token = credentials.refresh_token || credentials.refreshToken || credentials.token;
        const headers = { Authorization: `Bearer ${token}`, 'X-Device-Id': randomUUID(), ...createGlmAuthHeaders() };
        const response = await http.post('https://chatglm.cn/chatglm/user-api/user/refresh', {}, { headers, signal, timeout: 15000 });
        const access = response.data?.result?.access_token;
        if (!access) throw videoError('glm_auth_failed', 'GLM 视频账号认证失败', 401);
        return { ...headers, Authorization: `Bearer ${access}` };
    }
    const glmRequest = async (method, route, data, account, signal) => {
        const response = await http.request({ method, url: `https://chatglm.cn/chatglm/video-api/v1${route}`, data,
            headers: await glmHeaders(account, signal), signal, timeout: 60000, maxContentLength: 4 * 1024 * 1024 });
        if (response.data?.status !== 0) throw videoError('glm_video_failed', response.data?.status === -1001 ? '清影视频生成积分不足' : '清影视频任务请求失败', 502);
        return response.data.result;
    };
    const doubao = account => {
        if (!browserBridge) throw videoError('doubao_browser_unavailable', '豆包视频浏览器不可用', 503);
        return require('./chat2api-doubao-web-media').createDoubaoWebMediaService({ bridge:{request:options=>browserBridge.request({...options,ephemeral:false})},
            dataStore: { readCollection: async () => [account] }, accountId: account.accountId });
    };
    const parseQwen = events => {
        let state = { videos: [] };
        for (const event of events) {
            const rejected=(event.data?.messages||[]).some(message=>/创作积分不足|积分不足|购买创作会员/.test(message.content||''));
            if(rejected)throw videoError('video_quota_insufficient','千问创作积分不足，请在官网处理后重试',402);
            if (event.error || event.error_code || event.ret?.some(value => /FAIL_SYS_USER_VALIDATE/.test(value))) throw videoError('qwen_video_failed', '千问视频生成失败或需要官网验证', 502);
            const next = inspectNativeVideos('qwen', event);
            if (next.error) throw videoError('qwen_video_failed', next.error, 502);
            if (next.started) state = next;
        }
        return state;
    };
    async function collectQwen(response) {
        const { parseImageEvents } = require('./chat2api-image-service');
        if (response.status !== 200) { response.data?.destroy?.(); throw videoError('qwen_video_failed', `千问视频上游 HTTP ${response.status}`, 502); }
        if (typeof response.data === 'string') return parseQwen(parseImageEvents(response.data));
        const chunks = []; let size = 0;
        for await (const chunk of response.data) { size += chunk.length; if (size > 16 * 1024 * 1024) { response.data.destroy?.(); throw videoError('video_response_limit', '视频任务响应过大'); } chunks.push(Buffer.from(chunk)); }
        return parseQwen(parseImageEvents(Buffer.concat(chunks).toString()));
    }
    const handlers = {
        glm: {
            async start(job, input, account, signal) {
                const sources = [];
                for (const image of input.references) {
                    const form = new FormData(); form.append('file', new Blob([image.data], { type: image.mimeType }), image.filename || 'reference.png');
                    const result = await glmRequest('POST', '/static/upload', form, account, signal);
                    if (!result?.source_id) throw videoError('glm_video_upload', '清影参考图上传未返回标识');
                    sources.push(result.source_id);
                }
                const [width, height] = input.ratio.split(':').map(Number);
                const result = await glmRequest('POST', '/chat', { prompt: input.prompt, conversation_id: '',
                    base_parameter_extra: { generation_pattern: 1, resolution: 2, fps: 0, duration: 1, generation_ai_audio: 0,
                        generation_ratio_width: width, generation_ratio_height: height, activity_type: 0, label_watermark: 0, generation_type: '', prompt: input.prompt },
                    ...(sources.length ? { source_list: sources } : { advanced_parameter_extra: {} }) }, account, signal);
                if (!result?.chat_id) throw videoError('glm_video_protocol', '清影未返回视频任务标识');
                return { upstream: { taskId: result.chat_id } };
            },
            async poll(job, account, signal) {
                const result = await glmRequest('GET', `/chat/${encodeURIComponent(job.upstream.taskId)}`, undefined, account, signal);
                if (['failed', 'fail', 'error'].includes(result?.status)) return { error: '清影视频生成失败' };
                const files=(result?.output?.file_list||[]).map(file=>({...file,posterUrl:file.cover_url||result.cover_url}));
                if(['finished','completed','finish','success'].includes(result?.status)&&result.video_url)files.push({url:result.containing_audio_url||result.video_url,
                    posterUrl:result.cover_url,duration:parseFloat(result.video_duration),width:result.source_width,height:result.source_height});
                return { videos:normalizeOutputVideos(files) };
            }
        },
        doubaochat: {
            async start(job, input, account, signal) {
                const media = doubao(account); const keys = [];
                for (const image of input.references) keys.push((await media.uploadImage({ filename: image.filename || 'reference.png', data: image.data }, { signal })).uri);
                const result = await media.createVideoTask({ prompt: `生成一段5秒、${input.ratio}画幅的视频。${input.prompt}`, ratio: input.ratio, refImageKeys: keys }, { signal });
                return { videos: result.videos.map(video => ({ ...video, url: video.video_url, posterUrl: video.cover_url })), ...(result.conversationId?{upstream:{conversationId:result.conversationId,messageId:result.messageId,conversationType:result.conversationType}}:result.taskId?{upstream:{taskId:result.taskId}}:{}) };
            },
            async poll(job, account, signal) {
                if(job.upstream.conversationId)return require('./chat2api-doubao-video-result').readDoubaoVideoResult({account,upstream:job.upstream,http,signal});
                const result = await doubao(account).pollVideoTask(job.upstream.taskId, { signal });
                return { videos: result.videos.map(video => ({ ...video, url: video.video_url, posterUrl: video.cover_url })) };
            }
        },
        qwen: {
            async start(job, input, account, signal) {
                const provider = await providerRegistry.getProvider('qwen');
                const model = resolveVideoModel(job.model); const prepared = createQwenRequest({ messages: [{ role: 'user', content: input.prompt }] }, 'Qwen', provider, buildProviderHeaders(provider, account, 'qwen'));
                const attachments = [];
                for (const image of input.references) { const uploaded = await qwenUpload(image, { account, signal }); attachments.push({ type: 'image', materialId: uploaded.id }); }
                Object.assign(prepared.data, { ai_tool_scene: 'zaodian_generate_video', sub_scene: '', chat_mode: 'quick',
                    biz_data: JSON.stringify({ req: { rootModel: model.upstream, prompt: input.prompt, originPrompt: input.prompt, genMode: 'multi_ref',
                        params: { gen_mode: 'multi_ref', duration: 5, resolution: '720P', size: input.ratio, ...(model.upstream !== 'happyhorse' ? { audio: true } : {}), ...(attachments.length ? { attachments } : {}) } }, bizScene: 'genVideo' }) });
                const state = await collectQwen(await http.request({ method: 'POST', ...prepared, signal, timeout: 120000, responseType: 'stream' }));
                return { videos: state.videos, done:!state.pending, upstream: { sessionId: prepared.data.session_id, reqId: prepared.data.req_id, parentReqId: prepared.data.parent_req_id } };
            },
            async poll(job, account, signal) {
                const provider = await providerRegistry.getProvider('qwen');
                const prepared = createQwenRequest({ messages: [] }, 'Qwen', provider, buildProviderHeaders(provider, account, 'qwen'),
                    { nativeState: { sessionId: job.upstream.sessionId, parentReqId: job.upstream.parentReqId } });
                const url = new URL(prepared.url); url.pathname = '/api/v1/chat/snap';
                return collectQwen(await http.post(url.toString(), { ...prepared.data, req_id: job.upstream.reqId, snap_index: 1 },
                    { headers: prepared.headers, signal, timeout: 30000, responseType: 'text', maxContentLength: 16 * 1024 * 1024 }));
            }
        }, ...adapters
    };
    const jobs = createVideoJobs({ rootDir: dataStore.rootDir, ...limits,
        start: async (job, input, signal) => handlers[job.providerId].start(job, input, await accountFor(job), signal),
        poll: async (job, signal) => handlers[job.providerId].poll(job, await accountFor(job), signal) });
    async function create(input) {
        const model = resolveVideoModel(input.model);
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000) throw videoError('video_prompt_invalid', '视频提示词为空或过长');
        const ratio = input.ratio || '16:9';
        if (!['16:9', '9:16', '1:1', '4:3', '3:4'].includes(ratio)) throw videoError('video_ratio_invalid', '视频画幅比例无效');
        const raw = input.references || [];
        if (!Array.isArray(raw) || raw.length > model.referenceLimit) throw videoError('video_reference_invalid', `当前模型最多支持${model.referenceLimit}张参考图`);
        const references = raw.map(image => Buffer.isBuffer(image?.data) ? { ...image, filename: image.filename || `reference.${image.mimeType === 'image/jpeg' ? 'jpg' : 'png'}` } : decodeChatImage(typeof image === 'string' ? image : image.dataUrl));
        if (references.some(image => !['image/png','image/jpeg','image/webp','image/gif'].includes(image.mimeType) || !image.data.length || image.data.length > 10 * 1024 * 1024)) throw videoError('video_reference_invalid', '视频参考图数据无效或超过10MiB');
        const accounts = await dataStore.listAccounts();
        const account = accounts.find(account => account.providerId === model.providerId && account.enabled !== false && account.secretConfigured !== false && (!account.status || account.status === 'active'));
        if (!account) throw videoError('video_account_missing', '生视频 Provider 尚未登录', 401);
        const provider = await providerRegistry.getProvider(model.providerId);
        if (!provider || provider.enabled === false) throw videoError('video_provider_disabled', '生视频 Provider 已停用');
        return jobs.create({ providerId: model.providerId, accountId: account.accountId, model: model.id,
            input: { prompt: input.prompt.trim(), ratio, references } });
    }
    return { create, get: jobs.get, wait: jobs.wait, stop: jobs.stop, resume: jobs.resume,
        adopt: ({ providerId, account, upstream }) => jobs.create({ providerId, accountId: account.accountId, model: 'native', upstream }),
        listModels: () => VIDEO_MODELS.map(model => ({ ...model, capability: 'video' })) };
}
module.exports = { createChat2ApiVideoService };
