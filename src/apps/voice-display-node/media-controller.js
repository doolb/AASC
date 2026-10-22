'use strict';

const { MpvPlayer } = require('./mpv-player');
const { MpvTextPlayer } = require('./mpv-text-player');

const MEDIA_CONTROLS = new Set(['play', 'seek', 'volume', 'clearMedia', 'rotate', 'fit', 'crop', 'dynamicFitConfig', 'textStyle', 'textPlayback']);
const VISUAL_CONTROLS = new Set(['rotate', 'fit', 'crop', 'dynamicFitConfig']);

/** 只适配已有AASC媒体协议，不在本机增加配置HTTP端口或外部命令执行接口。 */
class NodeMediaController {
    constructor(config, { send, onError, player } = {}) {
        this.send = send || (() => {});
        this.onError = onError || (() => {});
        this.player = player || new MpvPlayer({ ...config.mediaPlayer, serverUrl: config.serverUrl }, { onError: this.onError });
        this.text = new MpvTextPlayer({ send: this.send, onError: this.onError, serverUrl: config.serverUrl,
            render: page => this.player.setTextPage?.(page), dimensions: () => this.player.textDimensions?.() || {} });
        this.textEnabled = false;
        this.available = false;
        this.capabilityKnown = false;
        this.enabled = false;
        this.pendingRestore = null;
        this.pendingMedia = null;
        this.lastPlayState = null;
        this.sequence = 0;
        this.restoring = null;
        this.capabilityEpoch = 0;
        this.player.on('progress', progress => {
            if (!this.capabilityKnown || this.text.active) return;
            // 播放状态只在变化时上报，进度走已有节流消息，避免每秒触发状态持久化。
            const stateKey = `${progress.mediaType || ''}:${progress.isPlaying}`;
            if (stateKey !== this.lastPlayState) {
                this.lastPlayState = stateKey;
                this.send({ type: 'playStateReport', isPlaying: progress.isPlaying,
                    currentTime: progress.currentTime, duration: progress.duration });
            }
            if (['audio', 'video'].includes(progress.mediaType)) {
                this.send({ type: `${progress.mediaType}Progress`, currentTime: progress.currentTime, duration: progress.duration });
            }
        });
        this.player.on('dimensions', dimensions => {
            this.send({ type: 'canvasSize', ...dimensions });
            void this.text.reflow().catch(this.onError);
        });
    }

    async initialize() {
        this.available = await this.player.checkAvailable();
        return this.available;
    }

    updateOverlay(data) { this.player.updateOverlay?.(data); }
    configureAudio(options) { this.text.configureAudio(options); }
    handleTextMessage(data) { return this.text.handleMessage(data); }

    disconnected() {
        this.capabilityEpoch += 1;
        this.sequence += 1;
        this.capabilityKnown = false;
        this.enabled = false;
        this.pendingMedia = null;
        this.pendingRestore = null;
        this.lastPlayState = null;
        this.text.suspend();
    }

    async setCapabilities(capabilities) {
        const epoch = ++this.capabilityEpoch;
        const sequence = this.sequence;
        this.capabilityKnown = true;
        this.enabled = this.available && capabilities.mediaRendering === true;
        this.textEnabled = this.enabled && capabilities.displayText === true;
        this.text.voiceCapabilityChanged(capabilities.voicePlayback === true);
        if (!this.enabled) {
            this.sequence += 1;
            this.pendingRestore = null;
            this.pendingMedia = null;
            // 立即使在途加载失效，不能等待OSD回执才清空；两条链路仍各自串行。
            await Promise.all([this.text.clear(), this.player.clear(), this.player.setOverlayEnabled?.(false)]);
            return;
        }
        if (!this.textEnabled && this.text.active) { await this.text.clear(); this.send({ type: 'playStateReport', isPlaying: false }); }
        try { await this.player.setOverlayEnabled?.(true); }
        catch (error) { this.onError(error); }
        // 启动空闲窗口期间可能已收到新媒体或断线，旧恢复不得覆盖最新状态。
        if (epoch !== this.capabilityEpoch || sequence !== this.sequence || !this.enabled) return;
        const restore = this.pendingRestore;
        const media = this.pendingMedia;
        this.pendingRestore = null;
        this.pendingMedia = null;
        if (restore) {
            const operation = this.restore(restore);
            const sequence = this.sequence;
            await operation;
            if (sequence !== this.sequence) return;
        }
        if (media) await this.handleMedia(media);
    }

    acknowledge(commandType, success, details, correlationId) {
        this.send({ type: 'commandAck', commandType, success, details, timestamp: Date.now(),
            ...(correlationId ? { correlationId } : {}) });
    }

    async handleMedia(media, options, restoreSequence) {
        if (restoreSequence === undefined) this.sequence += 1;
        else if (restoreSequence !== this.sequence) return false;
        if (!this.capabilityKnown) {
            this.pendingMedia = media;
            return;
        }
        if (!this.enabled) {
            this.acknowledge('media', false, 'mpv未启用、不可用或媒体能力已关闭', media.correlationId);
            return;
        }
        try {
            const sequence = this.sequence;
            const isText = media.mediaType === 'text';
            if (isText && !this.textEnabled) throw new Error('文本显示能力尚未开启');
            this.lastPlayState = null;
            await this.text.clear();
            if (sequence !== this.sequence) return false;
            let loaded;
            if (isText) {
                await this.player.clear();
                await this.player.ensureStarted();
                if (sequence !== this.sequence) return false;
                loaded = await this.text.load(media, options);
            } else loaded = await this.player.load(media, options);
            if (sequence !== this.sequence) return false;
            if (loaded) this.acknowledge('media', true, 'mpv已加载媒体', media.correlationId);
            return loaded;
        } catch (error) {
            this.acknowledge('media', false, error.message, media.correlationId);
            this.onError(error);
            return false;
        }
    }

    async handleControl(data) {
        if (!MEDIA_CONTROLS.has(data.action)) return false;
        try {
            // 画面和音量参数可以先于媒体/能力消息到达，只记忆状态，不启动播放器。
            const rememberOnly = VISUAL_CONTROLS.has(data.action) || ['volume', 'textStyle'].includes(data.action);
            if (!rememberOnly && data.action !== 'clearMedia' && !this.enabled) throw new Error('媒体能力尚未开启');
            if (data.action === 'clearMedia') {
                this.sequence += 1;
                this.pendingMedia = null;
                this.pendingRestore = null;
                // 原生清空立即作废加载；不能等待正文IPC后再清空后来收到的新媒体。
                await Promise.all([this.text.clear(), this.player.control('clearMedia')]);
                this.acknowledge('control', true, data.action, data.correlationId);
                return true;
            }
            if (data.action === 'play') {
                if (this.restoring) this.restoring.isPlaying = data.value === true;
                if (this.pendingRestore) this.pendingRestore.isPlaying = data.value === true;
            }
            if (this.pendingRestore) {
                const field = { rotate: 'rotation', fit: 'fit', crop: 'crop', dynamicFitConfig: 'dynamicFitConfig', volume: 'volume', textStyle: 'textStyle' }[data.action];
                if (field) this.pendingRestore[field] = data.value ?? data.rotation;
                if (data.action === 'crop') this.pendingRestore.fit = 'crop';
            }
            const actions = {
                textStyle: () => this.text.reflow(data.value),
                textPlayback: () => this.text.control(data.value?.action),
                play: () => this.text.active ? this.text.control(data.value === true ? 'play' : 'pause') : this.player.control('play', data.value)
            };
            if (actions[data.action]) await actions[data.action]();
            else await this.player.control(data.action, data.value ?? data.rotation);
            if (data.action === 'rotate') await this.text.reflow();
            this.acknowledge('control', true, data.action, data.correlationId);
        } catch (error) {
            this.acknowledge('control', false, `${data.action}: ${error.message}`, data.correlationId);
            this.onError(error);
        }
        return true;
    }

    async restore(state) {
        if (!state || typeof state !== 'object') return;
        state = { ...state };
        if (!this.capabilityKnown) {
            this.pendingRestore = state;
            this.pendingMedia = null;
            return;
        }
        const sequence = ++this.sequence;
        this.restoring = state;
        try {
            if (state.textStyle) await this.text.reflow(state.textStyle);
            if (sequence !== this.sequence) return;
            const operations = [];
            for (const [field, action] of [['rotation', 'rotate'], ['fit', 'fit'], ['dynamicFitConfig', 'dynamicFitConfig'], ['volume', 'volume']]) {
                if (state[field] !== undefined) operations.push(this.player.control(action, state[field]));
            }
            // crop字段一直保存在服务端；非crop模式恢复时不能因该字段存在而改变fit。
            if (state.crop && state.fit === 'crop') operations.push(this.player.control('crop', state.crop));
            await Promise.all(operations);
            if (!this.enabled || sequence !== this.sequence) return;
            if (state.currentMedia === null && !state.currentPlaylist) await Promise.all([this.text.clear(), this.player.clear()]);
            if (state.currentMedia) {
                const loaded = await this.handleMedia(state.currentMedia, {
                    paused: state.isPlaying === false,
                    ...(state.currentMedia.mediaType === 'text' ? { progress: state.currentTextProgress || state.currentMediaProgress } : {}),
                    resumeTime: Math.max(0, Number(state.currentMediaProgress?.currentTime) || 0)
                }, sequence);
                if (!loaded) return;
            }
            this.acknowledge('restoreState', true, 'mpv状态已恢复');
        } catch (error) {
            this.acknowledge('restoreState', false, error.message);
            this.onError(error);
        } finally {
            if (this.restoring === state) this.restoring = null;
        }
    }

    async close() { this.disconnected(); await this.text.close(); await this.player.close(); }
}

module.exports = { NodeMediaController, MEDIA_CONTROLS };
