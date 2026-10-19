'use strict';
const { listDoubaoVoices, validateDoubaoVoice } = require('./chat2api-doubao-voices');

const { createChat2ApiDataStore } = require('./chat2api-data-store');
const { createChat2ApiProviderRegistry } = require('./chat2api-provider-registry');
const { createChat2ApiLoadBalancer } = require('./chat2api-load-balancer');
const { createChat2ApiQwenSpeechAdapter, parseCookies, QWEN_VOICE } = require('./chat2api-qwen-speech-adapter');
const { validateWav } = require('../../../../external/tts/tts-wav');
const { AUTH_ERROR_MESSAGES } = require('./chat2api-qwen-speech-auth');
const { createChat2ApiModelMapper } = require('./chat2api-model-mapper');
const { createDoubaoSpeechAdapter, getDoubaoSpeechCredential } = require('./chat2api-doubao-speech-adapter');
const { DOUBAO_SPEECH_VOICE, doubaoSpeechError, SPEECH_ERRORS } = require('./chat2api-doubao-speech-protocol');
const {createChat2ApiApplicationService}=require('./chat2api-application-service');
const {createApiSpeechAdapters}=require('./chat2api-api-speech-adapters');
const {listSpeechModels,getSpeechBinding,isSupportedSpeechBinding}=require('./chat2api-model-capabilities');
const {QWEN_WEB_TTS_MODEL,assertFixedQwenTtsModel}=require('./chat2api-qwen-tts-models');
const {isProviderError}=require('../tts/tts-provider-errors');
const {createSpeechUpstreamController}=require('./chat2api-speech-upstream');

const MODELS = new Set(['qwen-chat', QWEN_WEB_TTS_MODEL, 'doubao-chat']);
const STRATEGIES = new Set(['round-robin', 'fill-first', 'failover']);
const speechError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const isQwenRateQuota = error => isProviderError(error) && error.httpStatus === 429
    && error.upstreamCode === 'Throttling.RateQuota';

// 仅频率限流进入持续退避；监听取消，避免用户结束本轮后仍留下等待的合成请求。
function waitForQwenRetry(delayMs, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(speechError(499, 'speech_cancelled', '语音生成已取消')); return; }
        const onAbort = () => finish(speechError(499, 'speech_cancelled', '语音生成已取消'));
        const timer = setTimeout(() => finish(), delayMs);
        function finish(error) {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve();
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
    });
}

// 排队可以跨越原请求预算，但每次真实上游合成仍有独立上限；挂起的适配器也不能卡住整句。
async function runQwenAttempt(task, timeoutMs, signal) {
    const controller = new AbortController();
    let timer;
    let rejectInterrupted;
    const onAbort = () => {
        rejectInterrupted?.(speechError(499, 'speech_cancelled', '语音生成已取消'));
        controller.abort();
    };
    if (signal?.aborted) throw speechError(499, 'speech_cancelled', '语音生成已取消');
    signal?.addEventListener('abort', onAbort, { once: true });
    const interrupted = new Promise((resolve, reject) => {
        rejectInterrupted = reject;
        timer = setTimeout(() => {
            reject(speechError(504, 'speech_timeout', 'Chat2API 语音生成超时'));
            controller.abort();
        }, timeoutMs);
    });
    try {
        if (signal?.aborted) onAbort();
        return await Promise.race([Promise.resolve().then(() => task(controller.signal)), interrupted]);
    } finally {
        clearTimeout(timer);
        rejectInterrupted = null;
        signal?.removeEventListener('abort', onAbort);
        controller.abort();
    }
}

function normalizeSpeechRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw speechError(400, 'invalid_speech_request', '语音请求必须为对象');
    if (typeof request.input !== 'string' || !request.input.trim() || request.input.length > 16000) throw speechError(400, 'invalid_speech_request', '语音文本必须为1至16000字符');
    const model = request.model ?? 'qwen-chat';
    if (!MODELS.has(model)) throw speechError(400, 'invalid_speech_request', '不支持的 Chat2API 语音模型');
    const doubao = model === 'doubao-chat';
    if (doubao && (request.input.length > 1000 || Buffer.byteLength(request.input, 'utf8') > 4000)) throw speechError(400, 'invalid_speech_request', '豆包网页语音文本超过1000字符或4000字节');
    // HTTP直调可绕过应用分句器；移除两种括号字形，保留括号内文字及其他标点。
    const speechText = doubao ? request.input.replace(/[（）()]/gu, '').trim() : request.input;
    if (!speechText.trim()) throw speechError(400, 'invalid_speech_request', '语音文本不能为空');
    const voice = request.voice ?? (doubao ? DOUBAO_SPEECH_VOICE : QWEN_VOICE);
    if (typeof voice !== 'string' || !voice.trim() || voice.length > 512 || /[\r\n]/u.test(voice)) throw speechError(400, 'invalid_speech_request', '语音音色参数不合法');
    if (request.response_format !== undefined && request.response_format !== 'wav') throw speechError(400, 'invalid_speech_request', 'Chat2API 语音仅支持wav格式');
    const speed = request.speed ?? 1;
    const volume = request.volume ?? 100;
    if (doubao) validateDoubaoVoice(voice);
    if (doubao && (speed !== 1 || volume !== 100)) throw speechError(400, 'invalid_speech_request', '豆包网页语音仅支持1倍速与默认音量');
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4
        || typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) throw speechError(400, 'invalid_speech_request', '语音速度或音量超出范围');
    return { text: speechText, model: model === 'qwen-chat' ? 'QUARK_VOICE' : model, voice, speed, volume };
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

function createWebSpeechService({ dataStore = createChat2ApiDataStore(),
    providerRegistry = createChat2ApiProviderRegistry({ dataStore }),
    loadBalancer = createChat2ApiLoadBalancer({ dataStore, providerRegistry }),
    getConfig = () => dataStore.readCollection('config', {}),
    qwenAdapter = createChat2ApiQwenSpeechAdapter(), doubaoSpeechQueue, qwenChatRateGate,
    doubaoAdapter = createDoubaoSpeechAdapter({ queue: doubaoSpeechQueue }) } = {}) {
    const rateGate = qwenChatRateGate || createSpeechUpstreamController().forRoot(dataStore.rootDir).qwenChatRateGate;
    return {
        async generate(request, { timeoutMs = 60000, signal, mappedBinding } = {}) {
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
                    // 语音Provider已由统一应用规划器识别；未显式绑定时复用千问的可用账号调度。
                    // 明确指定账号仍传requiredAccountId，发送失败不退选其他账号或重新合成。
                    const boundAccount=mappedBinding?.preferredAccountId;
                    selection = await loadBalancer.selectAccount(normalized.model, strategy, providerId, boundAccount,
                        { requireSecret: true, ...(boundAccount ? { requiredAccountId: boundAccount } : {}) });
                    remaining();
                    if (selection) [account, provider] = await Promise.all([
                        dataStore.getAccount(selection.account.accountId), providerRegistry.getProvider(providerId)
                    ]);
                } catch (error) {
                    if (error.code === 'speech_timeout' || error.code?.startsWith('doubao_speech_') || signal?.aborted) throw signal?.aborted ? cancelError() : error;
                    throw speechError(503, 'speech_account_unavailable', doubao ? 'Chat2API 豆包语音账号读取失败' : 'Chat2API 国内千问账号读取失败');
                }
                remaining();
                const dailyLimit = account?.dailyLimit ?? account?.todayLimit;
                if (!account || account.providerId !== providerId || account.accountId !== selection.account.accountId || account.enabled === false
                    || (account.status && account.status !== 'active') || !provider || provider.enabled === false
                    || (dailyLimit && (account.todayUsed || 0) >= dailyLimit)) throw speechError(503, 'no_available_speech_account', doubao ? 'Chat2API 没有可用的豆包语音账号，请先登录或恢复资料' : 'Chat2API 没有可用的国内千问语音账号，请先登录或恢复资料');
                const credential = doubao ? getDoubaoSpeechCredential(account) : getQwenCredential(account);
                let audio;
                try {
                    if (doubao) {
                        audio = await adapter.generate({ ...normalized, timeoutMs: remaining(), signal: controller.signal }, credential,
                            { accountId: account.accountId, signal: controller.signal, deadline });
                        remaining();
                    } else {
                        // 账号/配置读取继续受原预算约束；已接收的朗读分句在本实例内保序等待，不因429丢弃。
                        remaining(); clearTimeout(timer);
                        let rateRetries = 0;
                        while (true) {
                            await rateGate.waitForStart(account.accountId, normalized.model, { signal: controller.signal });
                            if (controller.signal.aborted) throw cancelError();
                            try {
                                audio = await runQwenAttempt(attemptSignal => adapter.generate(
                                    { ...normalized, timeoutMs, signal: attemptSignal }, credential,
                                    { accountId: account.accountId, signal: attemptSignal, deadline: Date.now() + timeoutMs }),
                                timeoutMs, controller.signal);
                                break;
                            } catch (error) {
                                if (error.code !== 'speech_rate_limited') throw error;
                                rateRetries++;
                                await waitForQwenRetry(Math.min(30000, 1000 * 2 ** Math.min(rateRetries - 1, 5)), controller.signal);
                            }
                        }
                    }
                    if (controller.signal.aborted) throw cancelError();
                    validateWav(audio);
                } catch (error) {
                    if (!signal?.aborted && error.speechQueueFailure !== true
                        && !['doubao_speech_cancelled', 'doubao_speech_busy'].includes(error.code)) loadBalancer.markAccountFailed?.(account.accountId);
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

// HTTP代理与业务薄层共享这一入口。先解析映射/应用/参数，再由Provider策略选择账号和协议。
function createChat2ApiSpeechService(options={}) {
    const dataStore=options.dataStore||createChat2ApiDataStore();
    const qwenApiRateGate=options.qwenApiRateGate||createSpeechUpstreamController().forRoot(dataStore.rootDir).qwenApiRateGate;
    const providerRegistry=options.providerRegistry||createChat2ApiProviderRegistry({dataStore});
    const modelMapper=options.modelMapper||createChat2ApiModelMapper({dataStore});
    const loadBalancer=options.loadBalancer||createChat2ApiLoadBalancer({dataStore,providerRegistry,modelMapper});
    const getConfig=options.getConfig||(()=>dataStore.readCollection('config',{}));
    const web=createWebSpeechService({...options,dataStore,providerRegistry,modelMapper,loadBalancer,getConfig});
    const apiAdapters=options.apiAdapters||createApiSpeechAdapters();
    const planner=createChat2ApiApplicationService({modelMapper});
    const generate=async(request,{timeoutMs=60000,signal,resolvedPlan,legacyReplyContext,parameterDefaults,expectedProviderId}={})=>{
        if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)throw speechError(400,'invalid_speech_request','语音超时参数不合法');
        const deadline=Date.now()+timeoutMs;const controller=new AbortController();let timer,onAbort,expired=false;
        const cancelled=()=>request?.model==='doubao-chat'?doubaoSpeechError('doubao_speech_cancelled'):speechError(499,'speech_cancelled','语音生成已取消');
        const remaining=()=>{if(signal?.aborted)throw cancelled();if(expired||Date.now()>=deadline)throw speechError(504,'speech_timeout','Chat2API语音生成超时');return deadline-Date.now();};
        const work=async()=>{
            remaining();const plan=resolvedPlan||await planner.plan(request,{defaultModel:'qwen-chat',parameterDefaults});remaining();
            assertFixedQwenTtsModel(plan.providerId,plan.upstreamModel);
            if(plan.application!=='tts')throw speechError(400,'invalid_speech_request','模型不是语音应用');
            if(expectedProviderId&&plan.providerId!==expectedProviderId)throw speechError(400,'model_provider_conflict','业务选择与模型映射Provider不一致');
            const normalized={input:plan.text,model:plan.speechModel,voice:plan.parameters.voice,speed:plan.parameters.speed,volume:plan.parameters.volume,response_format:'wav'};
            if(['qwen','doubaochat'].includes(plan.providerId)){
                const webTimeoutMs=plan.providerId==='qwen'?timeoutMs:remaining();
                if(plan.providerId==='qwen'){remaining();clearTimeout(timer);}
                return web.generate(normalized,{timeoutMs:webTimeoutMs,signal:controller.signal,mappedBinding:plan});
            }
            const config=await getConfig();remaining();
            const selected=await loadBalancer.selectAccount(plan.speechModel,STRATEGIES.has(config?.loadBalanceStrategy)?config.loadBalanceStrategy:'round-robin',plan.providerId,plan.preferredAccountId,
                {requireSecret:true,...(plan.preferredAccountId?{requiredAccountId:plan.preferredAccountId}:{})});remaining();
            if(!selected)throw speechError(503,'no_available_speech_account','请在Chat2API配置并启用对应API账号');
            const [account,provider]=await Promise.all([dataStore.getAccount(selected.account.accountId),providerRegistry.getProvider(plan.providerId)]);remaining();
            if(!account||account.providerId!==plan.providerId||account.enabled===false||(account.status&&account.status!=='active')||!provider||provider.enabled===false)throw speechError(503,'no_available_speech_account','所选语音账号不可用');
            const adapter=apiAdapters[plan.providerId];
            if(!adapter)throw speechError(501,'unsupported_application','语音适配器未接入');
            try {
                const qwenApi=plan.providerId==='qwen-api';
                const providerContext={provider:{...provider,...(account.accountInfo?.endpoint?{apiEndpoint:account.accountInfo.endpoint}:{}),...(account.accountInfo?.resourceId?{resourceId:account.accountInfo.resourceId}:{})},account,signal:controller.signal,...(legacyReplyContext?{legacyReplyContext}:{})};
                const generateOnce=(attemptDeadline,attemptSignal=controller.signal)=>adapter.generate({text:plan.text,model:plan.upstreamModel,...plan.parameters,
                    timeoutMs:Math.min(timeoutMs,attemptDeadline-Date.now()),signal:attemptSignal},account.credentials?.apiKey,
                {...providerContext,signal:attemptSignal,deadline:attemptDeadline});
                let audio;
                if(qwenApi){
                    // 规划与选账号仍受原60秒约束；排队和限流重试按每次请求单独计时，不丢已提交分句。
                    remaining();clearTimeout(timer);
                    let rateRetries=0;
                    while(true){
                        await qwenApiRateGate.waitForStart(account.accountId,plan.upstreamModel,{signal:controller.signal});
                        if(controller.signal.aborted)throw cancelled();
                        try{audio=await runQwenAttempt(attemptSignal=>generateOnce(Date.now()+timeoutMs,attemptSignal),
                            timeoutMs,controller.signal);break;}
                        catch(error){
                            if(!isQwenRateQuota(error))throw error;
                            rateRetries++;
                            const delayMs=Math.min(30000,1000*2**Math.min(rateRetries-1,5));
                            await waitForQwenRetry(delayMs,controller.signal);
                        }
                    }
                }else{
                    audio=await generateOnce(deadline);
                    remaining();
                }
                if(controller.signal.aborted)throw cancelled();
                validateWav(audio);loadBalancer.clearAccountFailure?.(account.accountId);return {audio,contentType:'audio/wav'};
            }catch(error){
                if(plan.providerId!=='qwen-api')remaining();
                if(error.code==='ABORT_ERR'||controller.signal.aborted)throw cancelled();
                if(error.code==='speech_timeout')throw error;
                loadBalancer.markAccountFailed?.(account.accountId);
                if(isProviderError(error)){error.statusCode=502;throw error;}
                throw speechError(error.code==='TTS_PROVIDER_TIMEOUT'?504:502,error.code==='TTS_PROVIDER_TIMEOUT'?'speech_timeout':'speech_upstream_error','Chat2API API语音生成失败，请检查账号、模型和音色');
            }
        };
        try {return await Promise.race([work(),new Promise((resolve,reject)=>{
            onAbort=()=>{controller.abort();reject(cancelled());};signal?.addEventListener('abort',onAbort,{once:true});
            if(signal?.aborted)return onAbort();
            timer=setTimeout(()=>{expired=true;controller.abort();reject(speechError(504,'speech_timeout','Chat2API语音生成超时'));},timeoutMs);
        })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort();}
    };
    const voices=async(model)=>{
        if (model === 'doubao-chat') return listDoubaoVoices();
        if (typeof model !== 'string' || !model.trim() || model.length > 200
            || (!getSpeechBinding(model) && typeof modelMapper.resolveModel !== 'function')) throw speechError(400, 'invalid_speech_request', '不支持的语音目录模型');
        const plan=await planner.plan({model,input:'音色查询'});
        if (plan.application !== 'tts') throw speechError(400, 'invalid_speech_request', '模型没有语音目录');
        if (plan.providerId === 'doubaochat') return listDoubaoVoices();
        if(apiAdapters[plan.providerId])return apiAdapters[plan.providerId].voices({model:plan.upstreamModel});
        return [{id:plan.parameters.voice,name:plan.parameters.voice,available:['qwen','doubaochat'].includes(plan.providerId)}];
    };
    const listModels=async()=>{
        const [accounts,providers,mappings]=await Promise.all([dataStore.listAccounts(),providerRegistry.listProviders(),dataStore.readCollection('modelMappings',[])]);
        const available=id=>providers.some(p=>p.id===id&&p.enabled!==false)&&accounts.some(a=>a.providerId===id&&a.enabled!==false&&(!a.status||a.status==='active')&&a.secretConfigured);
        const models=listSpeechModels().filter(m=>available(m.providerId));
        for(const mapping of mappings){const binding=getSpeechBinding(mapping.actualModel,mapping.preferredProviderId||mapping.providerId,mapping.application);if(binding&&isSupportedSpeechBinding(binding)&&available(binding.providerId))models.push({id:mapping.model,providerId:binding.providerId,application:'tts',input_modalities:['text'],output_modalities:['audio'],stream:false});}
        return models.map(m=>({...m,object:'model',owned_by:m.providerId==='doubaochat'?'doubao':m.providerId}));
    };
    return {generate,voices,listModels,planner};
}

module.exports = { createChat2ApiSpeechService, normalizeSpeechRequest, getQwenCredential };
