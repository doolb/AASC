'use strict';

const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiProviderRegistry } = require('./chat2api-provider-registry');
const { createChat2ApiLoadBalancer } = require('./chat2api-load-balancer');
const { createChat2ApiQwenSpeechAdapter, parseCookies, QWEN_VOICE } = require('./chat2api-qwen-speech-adapter');
const { validateWav } = require('../../../../external/tts/tts-wav');
const { AUTH_ERROR_MESSAGES } = require('./chat2api-qwen-speech-auth');
const { createChat2ApiModelMapper } = require('./chat2api-model-mapper');
const { createDoubaoSpeechAdapter, getDoubaoSpeechCredential } = require('./chat2api-doubao-speech-adapter');
const { DOUBAO_SPEECH_VOICE, doubaoSpeechError, SPEECH_ERRORS } = require('./chat2api-doubao-speech-protocol');

const MODELS = new Set(['qwen-chat', 'QUARK_VOICE', 'MINI_MAX', 'doubao-chat']);
const STRATEGIES = new Set(['round-robin', 'fill-first', 'failover']);
const speechError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

function normalizeSpeechRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw speechError(400, 'invalid_speech_request', '语音请求必须为对象');
    if (typeof request.input !== 'string' || !request.input.trim() || request.input.length > 16000) throw speechError(400, 'invalid_speech_request', '语音文本必须为1至16000字符');
    const model = request.model ?? 'qwen-chat';
    if (!MODELS.has(model)) throw speechError(400, 'invalid_speech_request', '不支持的 Chat2API 语音模型');
    const doubao = model === 'doubao-chat';
    if (doubao && (request.input.length > 1000 || Buffer.byteLength(request.input, 'utf8') > 4000)) throw speechError(400, 'invalid_speech_request', '豆包网页语音文本超过1000字符或4000字节');
    const voice = request.voice ?? (doubao ? DOUBAO_SPEECH_VOICE : QWEN_VOICE);
    if (typeof voice !== 'string' || !voice.trim() || voice.length > 512 || /[\r\n]/u.test(voice)) throw speechError(400, 'invalid_speech_request', '语音音色参数不合法');
    if (request.response_format !== undefined && request.response_format !== 'wav') throw speechError(400, 'invalid_speech_request', 'Chat2API 语音仅支持wav格式');
    const speed = request.speed ?? 1;
    const volume = request.volume ?? 100;
    if (doubao && (voice !== DOUBAO_SPEECH_VOICE || speed !== 1 || volume !== 100)) throw speechError(400, 'invalid_speech_request', '豆包网页语音仅支持网页默认音色、1倍速与默认音量');
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4
        || typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) throw speechError(400, 'invalid_speech_request', '语音速度或音量超出范围');
    return { text: request.input, model: model === 'qwen-chat' ? 'QUARK_VOICE' : model, voice, speed, volume };
}

// 凭证只在Chat2API内部解析；统一兼容其既有Cookie和ticket字段，不进入TTS配置。
function getQwenCredential(account) {
    try {
        const credentials = account.credentials || account;
        const values = new Map();
        for (const cookie of [account.cookie, credentials.cookie, credentials.cookies]) {
            if (!cookie) continue;
            const source = typeof cookie === 'object' && !Array.isArray(cookie)
                ? Object.entries(cookie).map(([name, value]) => {
                    if (!/^[\w-]+$/u.test(name) || typeof value !== 'string' || /[;\r\n\x00-\x1f\x7f]/u.test(value)) throw new Error('invalid cookie');
                    return `${name}=${value}`;
                }).join('; ') : cookie;
            if (typeof source !== 'string' || source.length > 16384 || /[\r\n\x00-\x1f\x7f]/u.test(source)) throw new Error('invalid cookie');
            for (const item of parseCookies(source)) values.set(item.name, item.value);
        }
        const ticket = credentials.ticket || credentials.tongyi_sso_ticket;
        if (ticket) {
            if (typeof ticket !== 'string' || /[;\r\n\x00-\x1f\x7f]/u.test(ticket) || ticket.length > 16384) throw new Error('invalid ticket');
            values.set('tongyi_sso_ticket', ticket.trim());
        }
        if (!values.get('tongyi_sso_ticket')) throw new Error('missing ticket');
        const result = [...values].map(([name, value]) => `${name}=${value}`).join('; ');
        if (result.length > 16384) throw new Error('oversized cookie');
        return result;
    } catch (error) {
        throw speechError(503, 'speech_credentials_unavailable', 'Chat2API 国内千问账号缺少有效登录凭证，请在账户管理中更新');
    }
}

function createChat2ApiSpeechService({ dataStore = createChat2ApiDataStore(),
    providerRegistry = createChat2ApiProviderRegistry({ dataStore }),
    loadBalancer = createChat2ApiLoadBalancer({ dataStore, providerRegistry }),
    getConfig = () => dataStore.readCollection('config', {}),
    modelMapper = createChat2ApiModelMapper({ dataStore }),
    qwenAdapter = createChat2ApiQwenSpeechAdapter(), doubaoAdapter = createDoubaoSpeechAdapter() } = {}) {
    return {
        async generate(request, { timeoutMs = 60000, signal } = {}) {
            const normalized = normalizeSpeechRequest(request);
            const doubao = normalized.model === 'doubao-chat';
            const providerId = doubao ? 'doubaochat' : 'qwen';
            const adapter = doubao ? doubaoAdapter : qwenAdapter;
            const controller = new AbortController();
            const cancelError = () => doubao ? doubaoSpeechError('doubao_speech_cancelled') : speechError(499, 'speech_cancelled', '语音生成已取消');
            if (signal?.aborted) throw cancelError();
            if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw speechError(400, 'invalid_speech_request', '语音超时参数不合法');
            const deadline = Date.now() + timeoutMs;
            let expired = false;
            let timer;
            const remaining = () => {
                if (signal?.aborted) throw cancelError();
                if (expired || Date.now() >= deadline) throw speechError(504, 'speech_timeout', 'Chat2API 语音生成超时');
                return deadline - Date.now();
            };
            const work = async () => {
                let selection;
                let account;
                let provider;
                try {
                    const config = await getConfig();
                    remaining();
                    const strategy = STRATEGIES.has(config?.loadBalanceStrategy) ? config.loadBalanceStrategy : 'round-robin';
                    let boundAccount;
                    if (doubao) {
                        const mapping = await modelMapper.resolveModel('doubao-chat'); remaining();
                        if (mapping.preferredProviderId !== 'doubaochat' || typeof mapping.preferredAccountId !== 'string' || !mapping.preferredAccountId) throw doubaoSpeechError('doubao_speech_binding');
                        boundAccount = mapping.preferredAccountId;
                    }
                    selection = await loadBalancer.selectAccount(normalized.model, strategy, providerId, boundAccount,
                        { requireSecret: true, ...(doubao ? { requiredAccountId: boundAccount } : {}) });
                    remaining();
                    if (selection) [account, provider] = await Promise.all([
                        dataStore.getAccount(selection.account.accountId), providerRegistry.getProvider(providerId)
                    ]);
                } catch (error) {
                    if (error.code === 'speech_timeout' || error.code?.startsWith('doubao_speech_') || signal?.aborted) throw signal?.aborted ? cancelError() : error;
                    throw speechError(503, 'speech_account_unavailable', doubao ? 'Chat2API 豆包语音账号读取失败' : 'Chat2API 国内千问账号读取失败');
                }
                remaining();
                if (!account || account.providerId !== providerId || account.accountId !== selection.account.accountId || account.enabled === false
                    || (account.status && account.status !== 'active') || !provider || provider.enabled === false
                    || (account.dailyLimit && (account.todayUsed || 0) >= account.dailyLimit)) throw speechError(503, 'no_available_speech_account', doubao ? 'Chat2API 没有可用的所选豆包语音账号' : 'Chat2API 没有可用的国内千问语音账号');
                const credential = doubao ? getDoubaoSpeechCredential(account) : getQwenCredential(account);
                let audio;
                try {
                    audio = await adapter.generate({ ...normalized, timeoutMs: remaining(), signal: controller.signal }, credential,
                        { accountId: account.accountId, signal: controller.signal, deadline });
                    remaining();
                    validateWav(audio);
                } catch (error) {
                    if (!signal?.aborted && !['doubao_speech_cancelled', 'doubao_speech_busy'].includes(error.code)) loadBalancer.markAccountFailed?.(account.accountId);
                    if (signal?.aborted) throw cancelError();
                    if (error.code === 'speech_timeout') throw error;
                    if (doubao) {
                        if (Object.hasOwn(SPEECH_ERRORS, error.code)) throw doubaoSpeechError(error.code);
                        throw doubaoSpeechError('doubao_speech_upstream');
                    }
                    // 仅按预定义代码映射固定文案，不能回传上游错误原文或签名URL。
                    if (Object.hasOwn(AUTH_ERROR_MESSAGES, error.code)) {
                        const status = error.code === 'speech_auth_timeout' ? 504 : error.code === 'speech_auth_capacity' ? 503 : 502;
                        throw speechError(status, error.code, AUTH_ERROR_MESSAGES[error.code]);
                    }
                    // 上游异常可能包含签名URL或请求头，统一转换为固定业务错误。
                    throw speechError(502, 'speech_upstream_error', 'Chat2API 国内千问语音合成失败，请检查账号及语音运行环境');
                }
                loadBalancer.clearAccountFailure?.(account.accountId);
                return { audio, contentType: 'audio/wav' };
            };
            let abort;
            try {
                return await Promise.race([work(), new Promise((resolve, reject) => {
                    abort = () => { controller.abort(); reject(cancelError()); };
                    signal?.addEventListener('abort', abort, { once: true });
                    if (signal?.aborted) return abort();
                    timer = setTimeout(() => { expired = true; controller.abort(); reject(speechError(504, 'speech_timeout', 'Chat2API 语音生成超时')); }, timeoutMs);
                })]);
            } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); controller.abort(); }
        }
    };
}

module.exports = { createChat2ApiSpeechService, normalizeSpeechRequest, getQwenCredential };
