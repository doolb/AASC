'use strict';

const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const fs = require('node:fs');
const { decodeAudio, wrapPcm, adjustWav, MAX_AUDIO_BYTES } = require('../../../../external/tts/tts-wav');

const QWEN_TTS_ENDPOINT = 'https://speech-tts.qianwen.com/api/v3/tts';
const QWEN_VOICE = 'zh_female_quarkF531S0_ptts';

function parseCookies(credential) {
    const isCookie = credential.includes(';') || /^(?:Cookie:\s*)?[A-Za-z_][\w-]{0,63}=/iu.test(credential);
    const source = isCookie ? credential.replace(/^Cookie:\s*/iu, '') : `tongyi_sso_ticket=${credential}`;
    return source.split(';').filter(part => part.trim()).map(part => {
        const index = part.indexOf('=');
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (index < 1 || !/^[\w-]+$/u.test(name) || /[\r\n]/u.test(value)) throw new Error('国内千问Cookie格式不合法');
        return { name, value, domain: '.qianwen.com', path: '/', secure: true };
    });
}

// 使用官方网页签名SDK，避免复制其设备注册/令牌算法。每次使用隔离的临时浏览器。
function launchQwenBrowser(options) {
    const puppeteer = require('puppeteer');
    const executablePath = [process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer.executablePath(),
        '/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(file => file && fs.existsSync(file));
    if (!executablePath) throw new Error('Chrome unavailable');
    return puppeteer.launch({ ...options, executablePath });
}

function createQwenSigner({ launch = launchQwenBrowser } = {}) {
    let active = 0;
    return async ({ credential, reqid, timeoutMs }) => {
        if (active >= 2) throw new Error('国内千问签名繁忙，请稍后重试');
        const cookies = parseCookies(credential);
        active += 1;
        let browser;
        let expired = false;
        let timer;
        const work = async () => {
            browser = await launch({ headless: true, timeout: timeoutMs,
                args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            if (expired) throw new Error('国内千问签名超时');
            await browser.setCookie(...cookies);
            const page = await browser.newPage();
            await page.goto('https://www.qianwen.com/', { waitUntil: 'domcontentloaded', timeout: timeoutMs });
            await page.waitForFunction(() => Boolean(window.webpackChunk_ali_qianwen_web), { timeout: timeoutMs });
            return page.evaluate(async ({ reqid, endpoint }) => {
                let runtime;
                window.webpackChunk_ali_qianwen_web.push([[`aasc-tts-${reqid}`], {}, requireModule => { runtime = requireModule; }]);
                const { doQwenAuth } = runtime(33669);
                const url = new URL(endpoint);
                url.searchParams.set('bizid', 'qwen-chat-pc');
                url.searchParams.set('chid', reqid);
                const auth = await doQwenAuth({ url: url.toString(), useSignature: true, forceExternal: true,
                    businessScene: 'qwen_audio_asr', signScene: 'qwen_audio_asr', appendCommonParams: false, signData: { chid: reqid } });
                if (!auth.signedHeaders || !Object.keys(auth.signedHeaders).length) throw new Error('missing signature');
                const signed = new URL(auth.url);
                for (const [key, value] of Object.entries(auth.signedHeaders)) signed.searchParams.set(key, String(value));
                signed.protocol = 'wss:';
                return { url: signed.toString(), userAgent: navigator.userAgent };
            }, { reqid, endpoint: QWEN_TTS_ENDPOINT });
        };
        // 超时关闭已启动的浏览器；启动迟到时work的finally也会关闭，不留下后台签名。
        const pending = work().finally(async () => {
            if (browser) await browser.close().catch(() => {});
            active -= 1;
        });
        try {
            const signed = await Promise.race([pending, new Promise((resolve, reject) => {
                timer = setTimeout(() => { expired = true; reject(new Error('sign timeout')); }, timeoutMs);
            })]);
            const url = new URL(signed.url);
            if (url.protocol !== 'wss:' || url.hostname !== 'speech-tts.qianwen.com' || url.pathname !== '/api/v3/tts') throw new Error('invalid signed endpoint');
            return signed;
        } catch (error) {
            // Chromium错误可能含签名URL；只向业务层抛出固定消息。
            throw new Error(expired ? '国内千问签名超时' : 'Chat2API 国内千问签名失败，请检查登录状态和语音运行环境');
        } finally {
            clearTimeout(timer);
            if (expired && browser) await browser.close().catch(() => {});
        }
    };
}

function collectQwenAudio(url, request, settings, reqid, { Socket = WebSocket } = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        let lastSequence = -1;
        let finished = false;
        const socket = new Socket(url, { origin: 'https://www.qianwen.com', maxPayload: 24 * 1024 * 1024,
            headers: { Cookie: parseCookies(settings.credential).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
                ...(request.userAgent ? { 'User-Agent': request.userAgent } : {}) },
            handshakeTimeout: request.timeoutMs });
        const timer = setTimeout(() => finish(new Error('国内千问朗读超时')), request.timeoutMs);
        const finish = (error, audio) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            socket.terminate();
            if (error) reject(error);
            else resolve(audio);
        };
        socket.on('error', () => finish(new Error('国内千问朗读连接失败，请检查登录凭证')));
        socket.on('close', () => finish(new Error('国内千问朗读中断，未收到完成事件')));
        socket.on('open', () => {
            const packet = { reqid, model: settings.model, vcn: request.voice, speed: request.speed,
                type: 'stream', volume: 1, format: 'pcm', sample_rate: settings.model === 'MINI_MAX' ? 32000 : 24000 };
            socket.send(JSON.stringify({ ...packet, text: request.text, status: 1, ced: request.text.length }));
            socket.send(JSON.stringify({ ...packet, text: '', status: 2, ced: request.text.length }));
        });
        socket.on('message', raw => {
            if (finished) return;
            try {
                const event = JSON.parse(String(raw));
                if (event.code && Number(event.code) !== 2000000) throw new Error('国内千问朗读失败，请检查音色与登录凭证');
                const data = event.data || {};
                if (data.audio) {
                    const sequence = data.res_ced;
                    if (sequence !== undefined && (!Number.isFinite(sequence) || sequence < 0)) throw new Error('国内千问音频序号无效');
                    if (sequence === undefined || sequence > lastSequence) {
                        const chunk = decodeAudio(data.audio);
                        bytes += chunk.length;
                        if (bytes + 44 > MAX_AUDIO_BYTES) throw new Error('TTS 音频超过16MiB上限');
                        chunks.push(chunk);
                        if (sequence !== undefined) lastSequence = sequence;
                    }
                }
                if (Number(data.status) === 2 || event.type === 'user.tts.ended') {
                    const sampleRate = settings.model === 'MINI_MAX' ? 32000 : 24000;
                    finish(null, adjustWav(wrapPcm(Buffer.concat(chunks, bytes), sampleRate), 0, request.volume));
                }
            } catch (error) {
                finish(error instanceof SyntaxError ? new Error('国内千问返回无效朗读事件') : error);
            }
        });
    });
}

// Chat2API负责账号与签名，适配器只接收请求内存中的当前凭证。
function createChat2ApiQwenSpeechAdapter({ sign = createQwenSigner(), Socket = WebSocket } = {}) {
    return {
        async generate(request, credential) {
            const deadline = Date.now() + request.timeoutMs;
            const reqid = randomUUID();
            const signed = await sign({ credential, reqid, timeoutMs: request.timeoutMs });
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('国内千问朗读超时');
            return collectQwenAudio(typeof signed === 'string' ? signed : signed.url,
                { ...request, userAgent: signed.userAgent, timeoutMs: remaining }, { model: request.model, credential }, reqid, { Socket });
        }
    };
}

module.exports = { createChat2ApiQwenSpeechAdapter, createQwenSigner, collectQwenAudio, parseCookies, QWEN_VOICE };
