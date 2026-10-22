'use strict';
const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { IMAGE_MODELS, resolveImageModel, imageError } = require('./chat2api-image-catalog');
const { createGlmAuthHeaders } = require('./chat2api-glm-auth');
const { buildProviderHeaders, createQwenRequest } = require('./chat2api-provider-adapters');
const { mediaQuery, createDoubaoWebMediaService } = require('./chat2api-doubao-web-media');

function parseImageEvents(raw) {
    const events = [];
    for (const line of raw.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        try { events.push(JSON.parse(line.slice(5))); } catch { /* SSE结束标记不是JSON。 */ }
    }
    if (!events.length) {
        try { events.push(JSON.parse(raw)); } catch { throw imageError('image_protocol', '生图响应不是有效数据', 502); }
    }
    return events;
}
async function collect(response) {
    if (response.status !== 200) {
        response.data?.destroy?.();
        throw imageError('image_upstream_http', `生图上游 HTTP ${response.status}`, response.status);
    }
    if (typeof response.data === 'string') return parseImageEvents(response.data);
    let bytes = 0; const chunks = [];
    for await (const chunk of response.data) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 16 * 1024 * 1024) { response.data.destroy?.(); throw imageError('image_response_limit', '生图响应过大', 502); }
        chunks.push(Buffer.from(chunk));
    }
    return parseImageEvents(Buffer.concat(chunks).toString('utf8'));
}
const uniqueImages = urls => [...new Set(urls.filter(url => typeof url === 'string' && /^https:\/\//.test(url)))].map(url => ({ url }));
function extractGlmImages(events) {
    for (const event of events) if (event.last_error?.code || event.error) throw imageError('glm_image_failed', 'GLM 生图失败', 502);
    if (!events.some(event => event.status === 'finish')) throw imageError('image_stream_interrupted', 'GLM 生图流提前结束', 502);
    return uniqueImages(events.flatMap(event => (event.parts || []).flatMap(part => (part.content || [])
        .filter(content => content.type === 'image').flatMap(content => (content.image || []).map(image => image.image_url)))));
}
function extractDoubaoImages(events) {
    const urls = [];
    for (const event of events) {
        if (event.error || event.code && event.code !== 0) throw imageError('doubao_image_failed', '豆包生图失败或需要官网验证', 502);
        for (const patch of event.patch_op || []) {
            const blocks = patch.patch_value?.content_block || [];
            for (const block of blocks) for (const creation of block.content?.creation_block?.creations || []) {
                const image = creation.image;
                if (image?.image_ori?.url) urls.push(image.image_ori.url);
            }
        }
    }
    if (urls.length && !events.some(event => event.end_type === 3)) throw imageError('image_stream_interrupted', '豆包生图流提前结束', 502);
    return uniqueImages(urls);
}
function doubaoImagePayload(prompt, model, ratio) {
    const id = randomUUID();
    return {
        client_meta: { local_conversation_id: `local_${randomUUID()}`, conversation_id: '',
            bot_id: '7338286299411103781', last_section_id: '', last_message_index: null },
        messages: [{ local_message_id: id, content_block: [{ block_type: 10000, block_id: randomUUID(), parent_id: '',
            content: { text_block: { text: `生成图片：${prompt}`, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' },
            meta_info: [], extra_info: {}, append_fields: [] }], message_status: 0 }],
        option: { create_time_ms: Date.now(), unique_key: randomUUID(), need_create_conversation: true,
            conversation_init_option: { need_ack_conversation: true }, conversation_mode: 1,
            sse_recv_event_options: { support_chunk_delta: true }, support_lazy_fetch_stream: true,
            model_config: { model_item_key: '', model_extra_params: {} },
            aggregate_params: { mention_skill_list: '[]', mention_plugin_list: '[]', mention_ext: '[{}]', conversation_mode: '1' } },
        chat_ability: { ability_type: 3, ability_param: JSON.stringify({ ability_type: 1,
            ability_param: { model, ratio: ratio || 'auto', input_box_content: { user_input_content: prompt, reply_message_format: '生成图片：%s' } } }) },
        user_context: [], ext: {}
    };
}
function createChat2ApiImageService({ dataStore, providerRegistry, browserBridge, getBrowserConfig, http = axios, adapters = {} }) {
    const qwenBrowser = dataStore.rootDir
        ? require('./chat2api-qwen-image-browser').createQwenImageBrowser({ rootDir: dataStore.rootDir, getBrowserConfig }) : null;
    const post = (url, data, headers, signal) => http.request({ method: 'POST', url, data, headers,
        signal, timeout: 180000, responseType: 'stream', validateStatus: () => true });
    const handlers = {
        async glm({ account, provider, model, prompt, ratio, references, signal }) {
            const headers = { ...buildProviderHeaders(provider, account, 'glm'), 'X-Device-Id': randomUUID(), ...createGlmAuthHeaders() };
            const token = account.credentials.refresh_token || account.credentials.refreshToken || account.credentials.token;
            const refreshed = await http.post('https://chatglm.cn/chatglm/user-api/user/refresh', {}, {
                headers: { ...headers, Authorization: `Bearer ${token}` }, signal, timeout: 15000 });
            const access = refreshed.data?.result?.access_token;
            if (!access) throw imageError('glm_auth_failed', 'GLM 登录资料失效', 401);
            if (references.length) {
                const { generateGlmReference } = require('./chat2api-image-upload');
                return generateGlmReference(references[0], { http, headers: { ...headers, Authorization: `Bearer ${access}` }, signal, prompt, ratio });
            }
            const events = await collect(await post('https://chatglm.cn/chatglm/backend-api/assistant/stream', {
                assistant_id: '65a232c082ff90a2ad2f15e2', conversation_id: '', project_id: '', chat_type: 'user_chat',
                meta_data: { cogview: { aspect_ratio: ratio || '1:1', style: 'none', scene: 'none', chat_model: model.upstream,
                    rm_label_watermark: false }, is_test: false, input_question_type: 'xxxx', channel: '', draft_id: '',
                    chat_mode: '', reasoning_effort: 'max', selected_model: 'glm-5.3-flash', is_networking: false, quote_log_id: '', platform: 'pc' },
                messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
            }, { ...headers, ...createGlmAuthHeaders(), Authorization: `Bearer ${access}` }, signal));
            return extractGlmImages(events);
        },
        async doubaochat({ account, model, prompt, ratio, references, signal }) {
            if (!browserBridge) throw imageError('doubao_browser_unavailable', '豆包网页运行环境不可用', 503);
            const payload = doubaoImagePayload(prompt, model.upstream, ratio);
            const attachments = [];
            // 上传与解析地址是连续步骤，期间关闭页面会让下一请求复用到尚未关闭完的页签。
            const uploadBridge = { request: options => browserBridge.request({ ...options, ephemeral: false }) };
            const uploader = createDoubaoWebMediaService({ bridge: uploadBridge, dataStore, accountId: account.accountId });
            for (const image of references) {
                const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1];
                const file = await uploader.uploadImage({ filename: `reference.${extension}`, data: image.data }, { signal });
                attachments.push({ type: 1, identifier: randomUUID(), image: { name: file.name, uri: file.uri,
                    image_ori: { url: '', width: file.width, height: file.height, format: file.format, url_formats: {} } },
                    parse_state: 0, review_state: 1, upload_status: 1, progress: 100, src: '' });
            }
            if (attachments.length) payload.messages.unshift({ local_message_id: randomUUID(), message_status: 0,
                content_block: [{ block_type: 10052, content: { attachment_block: { attachments }, pc_event_block: '' },
                    block_id: randomUUID(), parent_id: '', meta_info: [], extra_info: {}, append_fields: [] }] });
            const response = await browserBridge.request({ account, sessionKey: `image-${randomUUID()}`, ephemeral: true,
                prepared: { url: mediaQuery(account).replace('/samantha/chat/completion', '/chat/completion'),
                    data: payload }, signal,
                limits: { timeoutMs: 180000, streamBytes: 16 * 1024 * 1024 } });
            return extractDoubaoImages(await collect(response));
        },
        async qwen({ account, provider, model, prompt, ratio, references, signal }) {
            const prepared = createQwenRequest({ messages: [{ role: 'user', content: prompt }] }, 'Qwen', provider,
                buildProviderHeaders(provider, account, 'qwen'));
            if (references.length && !qwenBrowser) throw imageError('qwen_reference_browser_required', '千问参考图上传需要浏览器签名环境', 503);
            const uploaded = [];
            for (const image of references) uploaded.push(await qwenBrowser.upload(image, { account, signal }));
            const attachments = uploaded.map(image => ({ source: 'local', material_id: image.id, materialId: image.id,
                styleType: null, image: { material_id: image.id, thumbnail_url: '', preview_url: '', cdn_url: image.url, type: 'image', url: image.url },
                sourceId: '', source_id: '', type: 'image' }));
            for (const image of uploaded) prepared.data.messages.push({ mime_type: 'image/url', content: image.url,
                meta_data: { resource_infos: [image] }, status: 'complete' });
            Object.assign(prepared.data, { sub_scene: '', ai_tool_scene: 'zaodian_generate_image', chat_mode: 'quick',
                biz_data: JSON.stringify({ req: { rootModel: 'qwen2', prompt, originPrompt: prompt,
                    params: { size: uploaded.length ? 'origin' : ratio || '3:4', features: [model.upstream], ...(uploaded.length ? { attachments } : {}) } }, bizScene: 'genImage', is_preference_exp: '1' }) });
            const events = await collect(await post(prepared.url, prepared.data, prepared.headers, signal));
            const { completeQwenImages } = require('./chat2api-qwen-images');
            return completeQwenImages(events, { http, headers: prepared.headers, signal, prepared });
        }, ...adapters
    };
    async function generate(input, { signal } = {}) {
        const model = resolveImageModel(input.model);
        if (input.response_format && input.response_format !== 'url') throw imageError('image_format_unsupported', '当前生图接口仅支持 URL 返回');
        if (input.n != null) throw imageError('image_count_unsupported', '图片数量由上游模型决定，请省略 n');
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000) throw imageError('image_prompt_invalid', '生图提示词为空或过长');
        if (input.ratio && !['1:1','3:4','4:3','16:9','9:16','auto'].includes(input.ratio)) throw imageError('image_ratio_invalid', '生图比例无效');
        const referenceInput = input.references || input.reference_images || [];
        if (!Array.isArray(referenceInput)) throw imageError('image_reference_invalid', '参考图必须是数组');
        const references = referenceInput.map(image => {
            if (Buffer.isBuffer(image?.data)) return image;
            const value = typeof image === 'string' ? image : image?.dataUrl;
            const match = typeof value === 'string' && value.length <= 28 * 1024 * 1024
                && /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(value);
            if (!match) throw imageError('image_reference_invalid', '参考图需使用图片data URL');
            return { mimeType: match[1], data: Buffer.from(match[2], 'base64') };
        });
        const maxReferences = model.referenceLimit || 0;
        if (!Array.isArray(references) || references.length > maxReferences) throw imageError('image_reference_unsupported', `当前模型最多支持 ${maxReferences} 张参考图`);
        if (references.some(image => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mimeType) || !Buffer.isBuffer(image.data) || !image.data.length || image.data.length > 20 * 1024 * 1024)) throw imageError('image_reference_invalid', '参考图数据无效或过大');
        const candidates = (await dataStore.listAccounts()).filter(a => a.providerId === model.providerId
            && a.enabled !== false && a.secretConfigured !== false && (!a.status || a.status === 'active'));
        if (!candidates.length) throw imageError('image_account_missing', '生图 Provider 尚未登录', 401);
        const account = await dataStore.getAccount(candidates[0].accountId);
        const provider = (await providerRegistry.listProviders()).find(p => p.id === model.providerId && p.enabled !== false);
        if (!provider) throw imageError('image_provider_disabled', '生图 Provider 已停用');
        const deadline = AbortSignal.timeout(180000);
        const data = await handlers[model.providerId]({ account, provider, model, prompt: input.prompt.trim(),
            ratio: input.ratio, references, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
        if (!Array.isArray(data) || !data.length) throw imageError('image_empty', '生图未返回有效图片', 502);
        return { created: Math.floor(Date.now() / 1000), data };
    }
    return { generate, stop: () => qwenBrowser?.stop(), listModels: () => IMAGE_MODELS.map(model => ({ id: model.id, object: 'model',
        owned_by: model.providerId, capability: 'image' })) };
}
module.exports = { createChat2ApiImageService, parseImageEvents, extractGlmImages, extractDoubaoImages, doubaoImagePayload, uniqueImages };
