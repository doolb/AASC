'use strict';

const { createHash, createHmac, randomBytes } = require('node:crypto');

// 对应 .src/framework/tts-provider-configuration.md：所有令牌只在Chat2API内存中保存。
const SECURITY_ENDPOINT = 'https://sec.qianwen.com';
const AUDIO_ENDPOINT = 'wss://speech-tts.qianwen.com/api/v3/tts';
const AUDIO_SCENE = 'qwen_audio_asr';
const BASE_SCENE = 'qwen_web';
const VERSION = '1.0.0';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_SESSIONS = 16;
const IDLE_TTL_MS = 30 * 60 * 1000;
const AUTH_ERROR_MESSAGES = Object.freeze({
    speech_auth_credentials: 'Chat2API 国内千问登录凭证格式不合法',
    speech_auth_calibration: 'Chat2API 国内千问语音校时失败',
    speech_auth_register: 'Chat2API 国内千问语音令牌注册失败',
    speech_auth_refresh: 'Chat2API 国内千问语音令牌刷新失败',
    speech_auth_timeout: 'Chat2API 国内千问语音鉴权超时',
    speech_auth_capacity: 'Chat2API 国内千问语音鉴权繁忙，请稍后重试'
});

function authError(stage) {
    const code = `speech_auth_${stage}`;
    return Object.assign(new Error(AUTH_ERROR_MESSAGES[code]), {
        code, statusCode: stage === 'timeout' ? 504 : stage === 'capacity' ? 503 : 502
    });
}

function parseCookies(credential) {
    if (typeof credential !== 'string' || !credential.trim() || credential.length > 16384
        || /[\x00-\x1f\x7f]/u.test(credential)) throw authError('credentials');
    const isCookie = credential.includes(';') || /^(?:Cookie:\s*)?[A-Za-z_][\w-]{0,63}=/iu.test(credential);
    const source = isCookie ? credential.replace(/^Cookie:\s*/iu, '') : `tongyi_sso_ticket=${credential}`;
    return source.split(';').filter(part => part.trim()).map(part => {
        const index = part.indexOf('=');
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (index < 1 || !/^[\w-]+$/u.test(name)) throw authError('credentials');
        return { name, value };
    });
}

// 公开SDK按对象插入顺序拼接chid/nonce/timestamp，盐为一次性令牌与校时毫秒。
function buildSpeechSignature({ reqid, nonce, timestamp, authTime, base, scene, kp = '' }) {
    const data = { chid: reqid, nonce, timestamp };
    const token = scene.tokens.pop();
    const sign = createHmac('sha256', `${token}:${authTime}`)
        .update(`${base.deviceId}${VERSION}${kp}${Object.values(data).join('')}`).digest('base64');
    const url = new URL(AUDIO_ENDPOINT);
    const values = { bizid: 'qwen-chat-pc', ...data,
        'clt-acs-sign': sign, 'clt-acs-reqt': String(authTime), 'clt-acs-request-params': Object.keys(data).join(','),
        'eo-clt-dvidn': base.deviceId, 'eo-clt-sacsft': token, 'eo-clt-snver': base.version,
        'eo-clt-actkn': scene.accessToken, 'eo-clt-acs-ve': VERSION, 'clt-acs-caer': 'vrad', 'eo-clt-acs-kp': kp };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
    return { url: url.toString(), userAgent: USER_AGENT };
}

function normalizeToken(data, now, stage, fallbackDeviceId) {
    const string = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
        && !/[\x00-\x1f\x7f]/u.test(value);
    const expiresAt = Number(data?.['eo-clt-actkn-dl']) * 1000;
    const deviceId = data?.['eo-clt-dvidn'] || fallbackDeviceId;
    if (!data || !string(deviceId) || !string(data['eo-clt-actkn']) || !string(data['eo-clt-snver'])
        || !Number.isSafeInteger(expiresAt) || expiresAt <= now
        || !Array.isArray(data['eo-clt-bacsft']) || !data['eo-clt-bacsft'].length
        || data['eo-clt-bacsft'].length > 200 || !data['eo-clt-bacsft'].every(string)
        || new Set(data['eo-clt-bacsft']).size !== data['eo-clt-bacsft'].length) throw authError(stage);
    return { deviceId, accessToken: data['eo-clt-actkn'], version: data['eo-clt-snver'],
        expiresAt, tokens: [...data['eo-clt-bacsft']] };
}

function createQwenSigner({ fetchImpl = globalThis.fetch, now = Date.now, securityEndpoint = SECURITY_ENDPOINT } = {}) {
    const sessions = new Map();
    const randomId = () => `${now()}${randomBytes(8).toString('hex').slice(0, 10)}`;

    const request = async (session, pathname, stage, signal, body, extraHeaders = {}) => {
        try {
            if (signal.aborted) throw authError('timeout');
            const response = await fetchImpl(`${securityEndpoint}${pathname}`, {
                method: body ? 'POST' : 'GET', redirect: 'error', signal,
                headers: { Origin: 'https://www.qianwen.com', Referer: 'https://www.qianwen.com/',
                    'User-Agent': USER_AGENT, Cookie: [...session.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
                    ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            if (signal.aborted) throw authError('timeout');
            // 只接收官方固定主机的Cookie，不跟随重定向；校时证书留在该账号会话内。
            for (const cookie of response.headers.getSetCookie()) {
                const first = cookie.split(';')[0];
                const index = first.indexOf('=');
                const name = first.slice(0, index);
                const value = first.slice(index + 1);
                if (index < 1 || !/^[\w-]+$/u.test(name) || value.length > 8192 || /[\x00-\x1f\x7f]/u.test(value)) throw authError(stage);
                if (!['tongyi_sso_ticket', 'tongyi_sso_ticket_hash'].includes(name)) session.cookies.set(name, value);
            }
            if (session.cookies.size > 64 || [...session.cookies].reduce((size, [key, value]) => size + key.length + value.length, 0) > 32768)
                throw authError(stage);
            if (!response.ok || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
                await response.body?.cancel().catch(() => {});
                throw authError(stage);
            }
            const chunks = [];
            let size = 0;
            const reader = response.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (signal.aborted) throw authError('timeout');
                    if (done) break;
                    size += value.length;
                    if (size > MAX_RESPONSE_BYTES) throw authError(stage);
                    chunks.push(Buffer.from(value));
                }
            } finally { await reader.cancel().catch(() => {}); }
            const result = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
            if (!result || result.status !== 0 || !result.data || typeof result.data !== 'object') throw authError(stage);
            return result.data;
        } catch (error) {
            // 网络错误、JSON原文或签名URL可能带凭证，业务层仅接收预定义错误。
            throw authError(signal.aborted ? 'timeout' : stage);
        }
    };

    const calibrate = async (session, signal) => {
        const data = await request(session, `/api/calibration/getMillisTimeStamp?t=${now()}&chid=${randomId()}`,
            'calibration', signal, undefined, { 'eo-clt-acs-fgnt': session.fingerprint });
        const serverTime = Number(data.millisTimeStamp);
        if (!Number.isSafeInteger(serverTime) || serverTime <= 0) throw authError('calibration');
        session.clockOffset = serverTime - now();
    };

    const updateTokens = (session, data, stage) => {
        const related = Array.isArray(data.unifyRelate) ? data.unifyRelate.find(item => item?.businessScene === AUDIO_SCENE) : null;
        const base = normalizeToken(data, now() + session.clockOffset, stage);
        // 官方关联场景不重复返回设备ID，按SDK规则继承基础场景的设备标识。
        const scene = normalizeToken(related, now() + session.clockOffset, stage, base.deviceId);
        if (base.deviceId !== scene.deviceId) throw authError(stage);
        session.base = base;
        session.scene = scene;
    };

    const register = async (session, signal) => {
        await calibrate(session, signal);
        const chid = randomId();
        // 官方通用场景支持指纹校时注册；语音作为关联场景获取自己的令牌，不需要UMID或DOM。
        const data = await request(session, `/security/external/access/register?chid=${chid}`, 'register', signal,
            { screenResolution: '800x600', cookieEnabled: true, localStorageEnabled: true,
                timezoneOffset: 'Asia/Shanghai', fontList: [], pluginList: [], language: ['en-US'],
                unifyRelateGenerate: [AUDIO_SCENE, 'voice_command'], fingerprint: session.fingerprint,
                businessScene: BASE_SCENE, chid },
            { 'eo-clt-sftcnt': '100', 'clt-acs-caer': 'vrad', 'eo-clt-acs-bx-intss': '2', 'bx-umidtoken': '' });
        updateTokens(session, data, 'register');
    };

    const refresh = async (session, signal) => {
        await calibrate(session, signal);
        const query = new URLSearchParams({ businessScene: BASE_SCENE, unifyRelateGenerate: `${AUDIO_SCENE},voice_command`, chid: randomId() });
        const data = await request(session, `/security/external/access/refresh?${query}`, 'refresh', signal, undefined,
            { 'eo-clt-dvidn': session.base.deviceId, 'eo-clt-actkn': session.base.accessToken,
                'eo-clt-sftcnt': '100', 'clt-acs-caer': 'vrad', 'eo-clt-acs-bx-intss': '2', 'bx-umidtoken': '' });
        updateTokens(session, data, 'refresh');
    };

    return async ({ credential, reqid, timeoutMs }) => {
        const cookies = parseCookies(credential);
        if (typeof reqid !== 'string' || !reqid || reqid.length > 128 || /[\x00-\x1f\x7f]/u.test(reqid)) throw authError('credentials');
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw authError('timeout');
        const key = createHash('sha256').update(credential).digest('hex');
        for (const [id, cached] of sessions) {
            if (!cached.busy && now() - cached.lastUsed > IDLE_TTL_MS) sessions.delete(id);
        }
        let session = sessions.get(key);
        if (!session) {
            if (sessions.size >= MAX_SESSIONS) {
                const idle = [...sessions].filter(([, value]) => !value.busy).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
                if (!idle) throw authError('capacity');
                sessions.delete(idle[0]);
            }
            session = { cookies: new Map(cookies.map(cookie => [cookie.name, cookie.value])), fingerprint: randomBytes(16).toString('hex'),
                clockOffset: 0, base: null, scene: null, lastUsed: now(), busy: 0, queue: Promise.resolve() };
            sessions.set(key, session);
        }
        const controller = new AbortController();
        const deadline = now() + timeoutMs;
        const checkDeadline = () => {
            if (controller.signal.aborted || now() >= deadline) throw authError('timeout');
        };
        let timer;
        session.busy += 1;
        // 同账号串行初始化/刷新/消费，其他账号可以独立并发；超时排队请求不会迟到注册。
        const pending = session.queue.then(async () => {
            checkDeadline();
            try {
                if (!session.base) await register(session, controller.signal);
                else if (Math.min(session.base.expiresAt, session.scene.expiresAt) - (now() + session.clockOffset) < 1800000
                    || session.scene.tokens.length <= 20) await refresh(session, controller.signal);
                checkDeadline();
                return buildSpeechSignature({ reqid, nonce: randomBytes(8).toString('hex').slice(0, 11), timestamp: now(),
                    authTime: now() + session.clockOffset, base: session.base, scene: session.scene,
                    kp: session.cookies.get('tongyi_sso_ticket_hash') || '' });
            } catch (error) {
                session.base = null;
                session.scene = null;
                throw error;
            }
        }).finally(() => { session.busy -= 1; session.lastUsed = now(); });
        session.queue = pending.catch(() => {});
        try {
            return await Promise.race([pending, new Promise((resolve, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(authError('timeout')); }, timeoutMs);
            })]);
        } finally { clearTimeout(timer); }
    };
}

module.exports = { createQwenSigner, parseCookies, buildSpeechSignature, AUTH_ERROR_MESSAGES };
