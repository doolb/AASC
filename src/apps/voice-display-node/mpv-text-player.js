'use strict';

const { randomUUID } = require('crypto');
const https = require('https');
const fetch = require('node-fetch');
const { splitIntoSentences } = require('../../core/utils/sentence-splitter');
const { normalizeStyle, readableText, paginate } = require('./mpv-text-renderer');
const MAX_BYTES = 8 * 1024 * 1024;
const agent = new https.Agent({ rejectUnauthorized: false });
const boundedIndex = (value, length) => Math.min(length - 1, Math.max(0, Math.floor(Number(value) || 0)));
const sameSentence = (a, b) => !!a && !!b && a.playbackId === b.playbackId && a.pageIndex === b.pageIndex && a.sentenceIndex === b.sentenceIndex;

/** 文档状态与mpv媒体进度分离，所有异步回包必须匹配当前播放代次和句子。 */
class MpvTextPlayer {
    constructor({ send, render, dimensions, serverUrl, onError = () => {}, fetchText = fetch }) {
        Object.assign(this, { send, render, dimensions, serverUrl, onError, fetchText });
        this.style = normalizeStyle();
        this.active = false;
        this.revision = 0;
        this.playbackId = randomUUID();
        this.state = 'stopped';
        this.audio = {};
        this.voice = new RemoteTextVoice(send);
    }

    configureAudio(options) { this.audio = options; this.voice.configure(options); }

    voiceCapabilityChanged(enabled) {
        if (enabled) return;
        this.voice.stop();
        // 本机声音被关闭时原队列会停止；重新请求当前句，由服务端选择新目标或阅读降级。
        if (this.expected?.local) { this.cancelSentence(); this.requestSentence(); }
    }

    /** 断线作废在途下载/朗读，保留已显示正文，等待服务端权威恢复。 */
    suspend() {
        this.voice.stop();
        if (!this.active) return;
        this.cancelSentence(); ++this.revision; this.download?.abort(); this.download = null;
        this.state = 'paused';
    }

    cancelSentence() {
        const id = this.playbackId;
        clearTimeout(this.timer);
        this.expected = null;
        this.audio.cancel?.(`text:${id}`);
        if (this.active) this.send({ type: 'textSentenceTtsCancel', playbackId: id });
        this.playbackId = randomUUID();
    }

    async read(media, signal) {
        if (media.type === 'base64') {
            const encoded = String(media.data || '').replace(/^data:[^,]*;base64,/, '');
            if (!encoded || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
                throw new Error('文本base64无效或超过8MiB上限');
            }
            const buffer = Buffer.from(encoded, 'base64');
            if (buffer.length > MAX_BYTES) throw new Error('文本超过8MiB上限');
            return buffer.toString('utf8');
        }
        let lastError;
        for (const candidate of [media.url, media.fallbackUrl].filter(Boolean)) {
            try {
                const url = new URL(candidate, this.serverUrl);
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error('文本仅支持HTTP/HTTPS地址');
                const response = await this.fetchText(url.href, { signal, size: MAX_BYTES, timeout: 30000,
                    ...(url.protocol === 'https:' ? { agent } : {}) });
                if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) {
                    response.body?.destroy();
                    throw new Error(`文本下载失败或超过8MiB上限: HTTP ${response.status}`);
                }
                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.length > MAX_BYTES) throw new Error('文本超过8MiB上限');
                return buffer.toString('utf8');
            } catch (error) { lastError = error; if (signal.aborted) throw error; }
        }
        throw lastError || new Error('文本缺少下载地址');
    }

    async load(media, options = {}) {
        this.cancelSentence();
        this.download?.abort();
        const revision = ++this.revision;
        const download = new AbortController();
        this.download = download;
        this.active = true;
        this.layout = null;
        this.pageIndex = 0; this.sentenceIndex = 0;
        this.format = media.format === 'markdown' ? 'markdown' : 'plain';
        this.route = media.route;
        this.state = 'loading';
        this.loadingState = options.paused ? 'paused' : 'playing';
        this.sentences = [];
        this.report();
        try {
            const content = await this.read(media, download.signal);
            if (revision !== this.revision) return false;
            this.content = readableText(content, this.format);
            this.layout = paginate(this.content, this.dimensions(), this.style);
            this.pageIndex = boundedIndex(options.progress?.pageIndex, this.layout.pages.length);
            this.updateSentences();
            this.sentenceIndex = Math.max(0, boundedIndex(options.progress?.sentenceIndex, this.sentences.length));
            this.state = this.loadingState;
            await this.draw();
            if (revision !== this.revision) return false;
            this.report();
            this.requestSentence();
            return true;
        } catch (error) {
            if (revision !== this.revision) return false;
            this.cancelSentence();
            this.state = 'error';
            await this.render(null);
            this.report();
            throw error;
        } finally { if (this.download === download) this.download = null; }
    }

    updateSentences() { this.sentences = splitIntoSentences(this.layout.pages[this.pageIndex].text); }
    async draw() { await this.render(this.active && this.layout ? { layout: this.layout, pageIndex: this.pageIndex } : null); }
    report() {
        this.send({ type: 'textProgress', playbackId: this.playbackId, pageIndex: this.pageIndex || 0,
            pageTotal: this.layout?.pages.length || 0, sentenceIndex: this.sentenceIndex || 0,
            sentenceTotal: this.sentences?.length || 0, state: this.state, format: this.format || 'plain' });
        this.send({ type: 'playStateReport', isPlaying: this.state === 'playing' });
    }

    requestSentence() {
        if (!this.active || !this.layout || this.state !== 'playing' || this.expected) return;
        // 空白页不发TTS，使用异步推进避免长文空白页形成递归调用。
        if (!this.sentences[this.sentenceIndex]) {
            this.timer = setTimeout(() => { void this.advance().catch(error => this.fail(error)); }, 0);
            return;
        }
        const request = { type: 'textSentenceTts', playbackId: this.playbackId, pageIndex: this.pageIndex,
            sentenceIndex: this.sentenceIndex, text: this.sentences[this.sentenceIndex], ...(this.route ? { route: this.route } : {}) };
        this.expected = { ...request, received: false };
        this.send(request);
        this.timer = setTimeout(() => this.fail(new Error('文本朗读响应超时')), 60000);
    }

    fail(error) {
        this.cancelSentence();
        this.state = 'error';
        this.report(); this.onError(error);
    }

    async advance() {
        if (!this.active || this.state !== 'playing') return;
        clearTimeout(this.timer); this.expected = null;
        this.sentenceIndex++;
        if (this.sentenceIndex >= this.sentences.length) {
            if (this.pageIndex + 1 >= this.layout.pages.length) {
                this.state = 'finished'; this.report(); return;
            }
            this.pageIndex++; this.sentenceIndex = 0; this.updateSentences();
            const revision = this.revision;
            await this.draw();
            if (revision !== this.revision) return;
        }
        this.report(); this.requestSentence();
    }

    /** 暂停保留句号位置，恢复重播该句；翻页主动播放，停止保留正文。 */
    async control(action) {
        if (!['play', 'pause', 'prev', 'next', 'stop'].includes(action)) throw new Error('未知文本播放控制');
        if (!this.active) return;
        if (!this.layout) {
            this.loadingState = { pause: 'paused', stop: 'stopped' }[action] || 'playing';
            this.state = this.loadingState;
            this.report();
            return;
        }
        this.cancelSentence(); ++this.revision;
        if (['prev', 'next'].includes(action) && this.layout) {
            this.pageIndex = boundedIndex(this.pageIndex + (action === 'next' ? 1 : -1), this.layout.pages.length);
            this.sentenceIndex = 0; this.updateSentences();
        }
        this.state = { pause: 'paused', stop: 'stopped' }[action] || 'playing';
        const revision = this.revision;
        await this.draw();
        if (revision !== this.revision) return;
        this.report(); this.requestSentence();
    }

    async reflow(style) {
        this.style = normalizeStyle(style, this.style);
        if (!this.active || !this.layout) return;
        const anchor = this.layout.pages[this.pageIndex].start;
        const layout = paginate(this.content, this.dimensions(), this.style);
        this.cancelSentence(); const revision = ++this.revision;
        this.layout = layout;
        this.pageIndex = Math.max(0, layout.pages.findIndex(page => page.end > anchor));
        this.sentenceIndex = 0; this.updateSentences();
        await this.draw();
        if (revision !== this.revision) return;
        this.report(); this.requestSentence();
    }

    handleMessage(data) {
        if (data.textPlaybackRemote) { this.voice.handle(data); return true; }
        if (!data.textPlayback && !['textSentenceTtsReady', 'textSentenceTtsFinished', 'textSentenceTtsError'].includes(data.type)) return false;
        if (!sameSentence(this.expected, data) || !this.active || this.state !== 'playing') return true;
        if (data.type === 'textSentenceTtsReady') return true;
        if (data.type === 'textSentenceTtsFinished') {
            if (data.originDisplayId && data.originDisplayId !== this.audio.getDisplayId?.()) return true;
            if (data.status !== 'ended') this.onError(new Error('远端文本朗读失败，跳过该句'));
            void this.advance().catch(error => this.fail(error)); return true;
        }
        if (this.expected.received || data.prefetch) return true;
        clearTimeout(this.timer);
        const expected = this.expected;
        expected.received = true;
        const complete = error => {
            if (this.expected !== expected) return;
            if (error) this.onError(error);
            void this.advance().catch(failure => this.fail(failure));
        };
        if (data.type === 'textSentenceTtsError') {
            if (['punctuationOnly', 'noReadableText'].includes(data.errorCode)) this.timer = setTimeout(() => complete(), 0);
            else if (data.errorCode === 'noVoicePlaybackDevice') this.timer = setTimeout(() => complete(), Math.max(1000, Array.from(expected.text).length / 3 * 1000));
            else complete(new Error(data.message || '文本朗读失败'));
            return true;
        }
        if (data.action !== 'playAudio' || !data.audioUrl) { complete(new Error('文本朗读缺少音频地址')); return true; }
        if (!this.audio.play || (this.audio.voiceEnabled && !this.audio.voiceEnabled())) { complete(new Error('音频播放器未初始化或语音能力未开启')); return true; }
        this.timer = setTimeout(() => complete(new Error('文本朗读播放超时')), 120000);
        expected.local = true;
        try {
            Promise.resolve(this.audio.play(data.audioUrl, { owner: `text:${this.playbackId}`, text: data.text || expected.text, onComplete: complete })).catch(complete);
        } catch (error) { complete(error); }
        return true;
    }

    async clear() {
        this.cancelSentence(); ++this.revision; this.download?.abort(); this.download = null;
        this.active = false; this.layout = null; this.content = ''; this.sentences = []; this.state = 'stopped';
        await this.render(null);
    }
    async close() { this.voice.stop(); await this.clear(); }
}

/** 远端朗读复用系统音频队列，播放归属独立，取消不会触碰普通TTS。 */
class RemoteTextVoice {
    constructor(send) { this.send = send; this.audio = {}; this.cancelled = new Set(); }
    configure(options) { this.audio = options; }
    context(data) { return JSON.stringify([data.originDisplayId, data.playbackId]); }
    stop(data, remember = true) {
        if (!data && remember) data = this.current || this.prefetch;
        if (data) {
            this.cancelled.add(this.context(data));
            if (this.cancelled.size > 128) this.cancelled.delete(this.cancelled.values().next().value);
            if (this.prefetch && this.context(this.prefetch) === this.context(data)) this.prefetch = null;
            if (this.current && this.context(this.current) !== this.context(data)) return;
        }
        clearTimeout(this.timer);
        if (this.current) this.audio.cancel?.(`remote:${this.context(this.current)}`);
        this.current = null; this.prefetch = null;
    }
    handle(data) {
        if (!data.originDisplayId || !data.playbackId || data.voiceTargetDisplayId !== this.audio.getDisplayId?.()) return;
        if (data.action === 'stop') { this.stop(data); return; }
        if (data.action !== 'playAudio' || !Number.isInteger(data.pageIndex) || !Number.isInteger(data.sentenceIndex)
            || data.pageIndex < 0 || data.sentenceIndex < 0 || this.cancelled.has(this.context(data))) return;
        if (data.prefetch) { this.prefetch = data; return; }
        if (sameSentence(this.current, data) && this.context(this.current) === this.context(data)) return;
        const previous = this.current || this.prefetch;
        this.stop(undefined, !!previous && this.context(previous) !== this.context(data)); this.play(data);
    }
    play(data) {
        this.current = data;
        const complete = error => {
            if (this.current !== data) return;
            clearTimeout(this.timer);
            if (error) this.audio.cancel?.(`remote:${this.context(data)}`);
            this.send({ type: 'textSentenceTtsFinished', originDisplayId: data.originDisplayId,
                voiceTargetDisplayId: data.voiceTargetDisplayId, playbackId: data.playbackId,
                pageIndex: data.pageIndex, sentenceIndex: data.sentenceIndex, status: error ? 'failed' : 'ended' });
            const next = this.prefetch;
            this.current = null; this.prefetch = null;
            if (!error && next && this.context(next) === this.context(data) && next.pageIndex === data.pageIndex && next.sentenceIndex === data.sentenceIndex + 1) this.play(next);
        };
        if (!data.audioUrl || !this.audio.play || this.audio.voiceEnabled?.() !== true) { complete(new Error('语音播放能力未开启')); return; }
        this.timer = setTimeout(() => complete(new Error('远端文本朗读播放超时')), 120000);
        try { Promise.resolve(this.audio.play(data.audioUrl, { owner: `remote:${this.context(data)}`, text: data.text, onComplete: complete })).catch(complete); }
        catch (error) { complete(error); }
    }
}

module.exports = { MpvTextPlayer, RemoteTextVoice };
