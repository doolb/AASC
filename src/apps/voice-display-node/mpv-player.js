'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { platformOptions, resolveXauthority, ipcAddress, executeFile } = require('./mpv-platform');
const { FIT_MODES, normalizeRotation, normalizeCrop, normalizeDynamic, calculateGeometry } = require('./mpv-geometry');
const { MpvOverlay, assDocument } = require('./mpv-overlay');
const { textAss } = require('./mpv-text-renderer');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const MEDIA_TYPES = new Set(['image', 'gif', 'video', 'audio']);
const MAX_TEMP_BYTES = 64 * 1024 * 1024;
const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

class MpvPlayer extends EventEmitter {
    constructor(config = {}, dependencies = {}) {
        super();
        this.config = config;
        this.dependencies = dependencies;
        this.onError = dependencies.onError || (() => {});
        this.options = null;
        this.available = false;
        this.process = null;
        this.session = null;
        this.initializing = null;
        this.tail = Promise.resolve();
        this.pending = new Map();
        this.requestId = 0;
        this.revision = 0;
        this.closed = false;
        this.current = null;
        this.loading = null;
        this.properties = {};
        this.paused = false;
        this.volume = 100;
        this.visual = { rotation: 0, fit: 'contain', crop: normalizeCrop(), dynamicFitConfig: normalizeDynamic() };
        this.dynamicTimer = null;
        this.geometryTimer = null;
        this.geometryVersion = 0;
        this.geometryUpdate = null;
        this.dynamicEpoch = 0;
        this.lastProgressAt = 0;
        this.disposals = new Set();
        this.unsupportedResetProperties = new Set();
        this.overlayVersion = 0;
        this.overlayWrite = null;
        this.textPage = null;
        this.overlay = new MpvOverlay(() => { void this.queueOverlay(); }, dependencies.overlayClock);
    }

    async checkAvailable() {
        if (this.config.enabled !== true) return false;
        try {
            this.options = platformOptions(this.config, this.dependencies.platform, this.dependencies.env);
            await (this.dependencies.executeFile || executeFile)(this.options.command, ['--version'], {
                env: this.options.env, timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true
            });
            this.available = true;
        } catch (error) {
            this.available = false;
            this.onError(new Error(`mpv不可用：${error.message}`));
        }
        return this.available;
    }

    enqueue(operation) {
        const result = this.tail.then(operation);
        this.tail = result.catch(() => {});
        return result;
    }

    async ensureStarted() {
        if (this.closed) throw new Error('mpv播放器已关闭');
        if (!this.available) throw new Error('mpv播放未启用或不可用');
        if (this.initializing) return this.initializing;
        if (this.session?.socket && !this.session.socket.destroyed) return;
        this.initializing = this.startSession();
        try {
            await this.initializing;
        } finally {
            this.initializing = null;
        }
    }

    async startSession() {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-mpv-'));
        const session = { directory, socket: null, child: null, exit: null, buffer: '', disposed: false };
        this.session = session;
        try {
            const env = this.dependencies.resolveEnvironment
                ? await this.dependencies.resolveEnvironment(this.options)
                : await resolveXauthority(this.options);
            if (this.closed) throw new Error('mpv播放器已关闭');
            session.address = ipcAddress(this.options.platform, directory);
            const args = [...this.options.args, '--no-config', '--idle=yes', '--keep-open=yes',
                `--force-window=${this.overlay.active ? 'immediate' : 'yes'}`, '--fullscreen', '--no-terminal', '--input-terminal=no',
                '--audio-exclusive=no',
                ...(this.overlay.active ? ['--osc=no', '--osd-level=0', '--osd-bar=no'] : []),
                '--image-display-duration=inf', '--loop-file=inf', `--input-ipc-server=${session.address}`];
            const child = (this.dependencies.spawn || spawn)(this.options.command, args, {
                env, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
            });
            session.child = child;
            this.process = child;
            session.exit = new Promise(resolve => {
                child.once('close', resolve);
                child.once('error', resolve);
            });
            let diagnostic = '';
            child.stderr?.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-2048); });
            child.once('error', error => this.sessionFailed(session, new Error(`启动mpv失败：${error.message}`)));
            child.once('close', code => this.sessionFailed(session,
                new Error(`mpv已退出(${code})${diagnostic ? `：${diagnostic.trim()}` : ''}`)));
            session.socket = await this.connectSocket(session);
            if (this.closed || session.disposed) throw new Error('mpv初始化已取消');
            session.socket.on('data', chunk => this.receive(session, chunk));
            session.socket.on('error', error => this.sessionFailed(session, error));
            session.socket.on('close', () => this.sessionFailed(session, new Error('mpv IPC连接已关闭')));
            const observed = ['time-pos', 'duration', 'pause', 'video-dec-params', 'osd-dimensions', 'idle-active'];
            for (const [index, name] of observed.entries()) await this.command(['observe_property', index + 1, name]);
            await this.command(['set_property', 'volume', this.volume]);
            if (this.overlay.active) await this.queueOverlay();
        } catch (error) {
            await this.disposeSession(session);
            throw error;
        }
    }

    async connectSocket(session) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !this.closed && !session.disposed) {
            const socket = (this.dependencies.connect || net.createConnection)(session.address);
            const connected = await new Promise(resolve => {
                const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 250);
                socket.once('connect', () => { clearTimeout(timer); resolve(true); });
                socket.once('error', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
            });
            if (connected) return socket;
            await sleep(50);
        }
        throw new Error('等待mpv IPC就绪超时或已取消');
    }

    command(command) {
        const session = this.session;
        if (!session?.socket || session.disposed || session.socket.destroyed) return Promise.reject(new Error('mpv IPC未连接'));
        const requestId = ++this.requestId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`mpv命令超时：${command[0] || command.name}`));
            }, this.dependencies.commandTimeoutMs || 3000);
            this.pending.set(requestId, { resolve, reject, timer, session });
            session.socket.write(`${JSON.stringify({ command, request_id: requestId })}\n`, error => {
                if (!error) return;
                const pending = this.pending.get(requestId);
                if (!pending) return;
                clearTimeout(pending.timer);
                this.pending.delete(requestId);
                reject(error);
            });
        });
    }

    receive(session, chunk) {
        if (this.session !== session || session.disposed) return;
        session.buffer += chunk.toString();
        if (session.buffer.length > 1024 * 1024) {
            this.sessionFailed(session, new Error('mpv IPC消息超出限制'));
            return;
        }
        let newline;
        while ((newline = session.buffer.indexOf('\n')) >= 0) {
            const line = session.buffer.slice(0, newline);
            session.buffer = session.buffer.slice(newline + 1);
            if (!line.trim()) continue;
            try {
                const message = JSON.parse(line);
                const pending = this.pending.get(message.request_id);
                if (pending?.session === session) {
                    clearTimeout(pending.timer);
                    this.pending.delete(message.request_id);
                    if (message.error === 'success') pending.resolve(message.data);
                    else pending.reject(Object.assign(new Error(`mpv命令失败：${message.error}`), { mpvError: message.error }));
                }
                this.receiveEvent(message);
            } catch (error) { this.onError(error); }
        }
    }

    receiveEvent(message) {
        if (message.event === 'file-loaded') this.loading?.resolve();
        if (message.event === 'end-file' && message.reason === 'error') {
            const error = new Error(`mpv加载媒体失败：${message.file_error || '无法读取或解码'}`);
            if (this.loading) this.loading.reject(error);
            else this.onError(error);
        }
        if (message.event !== 'property-change') return;
        const previous = this.properties[message.name];
        this.properties[message.name] = message.data;
        if (['video-dec-params', 'osd-dimensions'].includes(message.name)) {
            const changed = message.name === 'osd-dimensions'
                ? previous?.w !== message.data?.w || previous?.h !== message.data?.h
                : JSON.stringify(previous) !== JSON.stringify(message.data);
            if (changed) this.scheduleGeometry();
            if (changed && message.name === 'osd-dimensions' && this.overlay.active) void this.queueOverlay();
            if (message.name === 'osd-dimensions' && changed && message.data?.w > 0 && message.data?.h > 0) {
                this.emit('dimensions', { width: message.data.w, height: message.data.h });
            }
        }
        if (message.name === 'pause' || message.name === 'idle-active') this.reportProgress(true);
        if (message.name === 'time-pos') this.reportProgress();
    }

    reportProgress(force = false) {
        if (!this.current) return;
        const now = Date.now();
        if (!force && now - this.lastProgressAt < 1000) return;
        this.lastProgressAt = now;
        const duration = nonnegative(this.properties.duration);
        const currentTime = nonnegative(this.properties['time-pos']);
        const isPlaying = !this.paused && this.properties.pause !== true && this.properties['idle-active'] !== true;
        this.emit('progress', { mediaType: this.current.mediaType, duration, currentTime, isPlaying });
    }

    async prepareSource(media) {
        if (!MEDIA_TYPES.has(media.mediaType)) throw new Error('mpv仅支持图片、视频和音频');
        if (media.type === 'base64' || (media.data && !media.url)) {
            if (typeof media.data !== 'string' || media.data.length > Math.ceil(MAX_TEMP_BYTES * 4 / 3) + 4 ||
                !/^[A-Za-z0-9+/]*={0,2}$/.test(media.data) || media.data.length % 4 !== 0) {
                throw new Error('临时媒体base64无效或超过64MiB');
            }
            const bytes = Buffer.from(media.data, 'base64');
            if (!bytes.length || bytes.length > MAX_TEMP_BYTES) throw new Error('临时媒体为空或超过64MiB');
            const extension = { image: '.img', gif: '.gif', video: '.video', audio: '.audio' }[media.mediaType];
            const file = path.join(this.session.directory, `${crypto.randomUUID()}${extension}`);
            await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
            return { source: file, file };
        }
        const rawUrl = media.url || media.fallbackUrl;
        if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new Error('媒体URL不能为空');
        const url = new URL(rawUrl, this.config.serverUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('媒体URL仅支持HTTP/HTTPS');
        return { source: url.href, file: null };
    }

    cancelLoad() {
        this.loading?.reject(new Error('媒体请求已被后续操作替换'));
    }

    async loadSource(source) {
        let timer;
        const loaded = new Promise((resolve, reject) => {
            this.loading = { resolve, reject };
            timer = setTimeout(() => reject(new Error('mpv加载媒体超时')), this.dependencies.loadTimeoutMs || 15000);
        });
        // 文件事件可能早于loadfile命令回执，两者都完成后才认为加载成功。
        try {
            await Promise.all([loaded, this.command(['loadfile', source, 'replace'])]);
        } finally {
            clearTimeout(timer);
            this.loading = null;
        }
    }

    load(media, { paused = false, resumeTime = 0 } = {}) {
        const revision = ++this.revision;
        this.cancelLoad();
        this.stopDynamic();
        this.paused = paused;
        return this.enqueue(async () => {
            if (revision !== this.revision || this.closed) return false;
            await this.ensureStarted();
            if (revision !== this.revision || this.closed) return false;
            const prepared = await this.prepareSource(media);
            const previous = this.current;
            try {
                this.current = null;
                this.properties = { 'osd-dimensions': this.properties['osd-dimensions'] };
                await this.command(['set_property', 'pause', this.paused]);
                await this.command(['set_property', 'volume', this.volume]);
                try {
                    await this.loadSource(prepared.source);
                } catch (error) {
                    if (!media.fallbackUrl || revision !== this.revision) throw error;
                    const fallback = await this.prepareSource({ ...media, type: 'url', data: null, url: media.fallbackUrl });
                    await this.loadSource(fallback.source);
                }
                if (revision !== this.revision || this.closed) {
                    await this.command(['stop']);
                    return false;
                }
                this.current = { ...prepared, mediaType: media.mediaType };
                if (media.mediaType !== 'audio') {
                    for (const name of ['video-dec-params', 'osd-dimensions']) {
                        this.properties[name] = await this.command(['get_property', name]).catch(() => null);
                    }
                }
                if (nonnegative(resumeTime) > 0 && ['audio', 'video'].includes(media.mediaType)) {
                    const duration = nonnegative(await this.command(['get_property', 'duration']).catch(() => 0));
                    const target = duration > 0 ? Math.min(nonnegative(resumeTime), Math.max(0, duration - 0.05)) : nonnegative(resumeTime);
                    await this.command(['seek', target, 'absolute+exact']);
                }
                await this.applyGeometry();
                if (revision !== this.revision || this.closed) return false;
                this.startDynamic();
                this.reportProgress(true);
                return true;
            } catch (error) {
                if (this.session?.socket && !this.session.disposed) {
                    try { await this.command(['stop']); } catch { /* 保留原始加载错误。 */ }
                }
                this.current = null;
                if (revision === this.revision) throw error;
                return false;
            } finally {
                if (previous?.file) await this.removeTemporary(previous.file);
                if (this.current?.file !== prepared.file && prepared.file) await this.removeTemporary(prepared.file);
            }
        });
    }

    updateVisual(action, value) {
        const setters = {
            rotate: () => { this.visual.rotation = normalizeRotation(value); },
            fit: () => {
                if (!FIT_MODES.has(value)) throw new Error('不支持的画面填充模式');
                this.visual.fit = value;
            },
            crop: () => { this.visual.crop = normalizeCrop(value); this.visual.fit = 'crop'; },
            dynamicFitConfig: () => { this.visual.dynamicFitConfig = normalizeDynamic(value); }
        };
        if (!setters[action]) return false;
        setters[action]();
        this.geometryVersion += 1;
        this.stopDynamic();
        if (this.overlay.active) void this.queueOverlay();
        return true;
    }

    updateOverlay(data) { if (this.available && !this.closed) this.overlay.update(data); }

    async setTextPage(snapshot) {
        this.textPage = snapshot;
        if (snapshot && (this.closed || !this.session?.socket || this.session.disposed)) throw new Error('mpv正文会话已断开');
        await this.queueOverlay();
        if (snapshot && this.session?.overlayFailed) throw new Error('mpv ASS正文绘制失败');
    }

    textDimensions() {
        const dimensions = this.properties['osd-dimensions'];
        return { width: dimensions?.w || 1280, height: dimensions?.h || 720, rotation: this.visual.rotation };
    }

    async setOverlayEnabled(enabled) {
        enabled = enabled === true && this.available && !this.closed;
        this.overlay.setActive(enabled);
        if (!enabled) { await this.queueOverlay(); return; }
        await this.enqueue(async () => {
            if (this.closed || !this.overlay.active) return;
            await this.ensureStarted();
            await this.command(['set_property', 'force-window', 'immediate']);
            await this.queueOverlay();
        });
    }

    /** OSD有独立的单任务写入，不等待媒体加载，也不由时钟启动/重启进程。 */
    queueOverlay() {
        const session = this.session;
        this.overlayVersion += 1;
        if (this.closed || !session?.socket || session.disposed || session.overlayFailed) return Promise.resolve();
        if (this.overlayWrite?.session === session && this.overlayWrite.draining) return this.overlayWrite.promise;
        const update = { session, promise: null, draining: true };
        this.overlayWrite = update;
        update.promise = (async () => {
            let version;
            do {
                version = this.overlayVersion;
                if (this.closed || this.session !== session || session.disposed) return;
                const dimensions = this.properties['osd-dimensions'];
                const command = this.overlay.active ? assDocument(this.overlay.state, {
                    width: dimensions?.w > 0 ? dimensions.w : 1280,
                    height: dimensions?.h > 0 ? dimensions.h : 720
                }, this.visual.rotation, this.overlay.now()) : { name: 'osd-overlay', id: 40, format: 'none', data: '' };
                const key = JSON.stringify(command);
                if (key !== session.lastOverlay) {
                    await this.command(command);
                    session.lastOverlay = key;
                }
                const body = textAss(this.overlay.active ? this.textPage : null, this.overlay.state.appearance);
                const bodyKey = JSON.stringify(body);
                if (bodyKey !== session.lastTextOverlay) {
                    await this.command(body);
                    session.lastTextOverlay = bodyKey;
                }
            } while (version !== this.overlayVersion);
            // 同步标记排空；Promise的finally尚未运行时，新输入仍须创建新一轮刷新。
            update.draining = false;
        })().catch(error => {
            // 字幕不可用只报一次，不中断媒体/TTS，也不让1Hz时钟反复尝试错误会话。
            if (!this.closed && this.session === session && !session.disposed) {
                session.overlayFailed = true;
                this.onError(new Error(`mpv ASS信息层失败：${error.message}`));
            }
        }).finally(() => { if (this.overlayWrite === update) this.overlayWrite = null; });
        return update.promise;
    }

    control(action, value) {
        if (this.updateVisual(action, value)) return this.queueGeometry();
        if (action === 'clearMedia') return this.clear();
        const commands = {
            play: () => { this.paused = value !== true; return ['set_property', 'pause', this.paused]; },
            volume: () => {
                if (!Number.isFinite(Number(value))) throw new Error('音量必须是数字');
                this.volume = Math.max(0, Math.min(100, Number(value)));
                return ['set_property', 'volume', this.volume];
            },
            seek: () => {
                if (!Number.isFinite(Number(value))) throw new Error('进度必须是数字');
                return ['seek', Math.max(0, Math.min(100, Number(value))), 'absolute-percent+exact'];
            }
        };
        if (!commands[action]) return Promise.resolve(false);
        const command = commands[action]();
        return this.enqueue(async () => {
            if (this.session?.socket && !this.session.disposed) await this.command(command);
            this.reportProgress(true);
            return true;
        });
    }

    geometry(mode = this.visual.fit) {
        const parameters = this.properties['video-dec-params'];
        const dimensions = this.properties['osd-dimensions'];
        if (!parameters || !dimensions) return null;
        // decoder参数保留文件自身方向，先得到浏览器naturalWidth/videoWidth同义尺寸，再叠加用户旋转。
        const intrinsicTurn = Number(parameters.rotate || 0) % 180 !== 0;
        return calculateGeometry({
            width: intrinsicTurn ? parameters.dh : parameters.dw,
            height: intrinsicTurn ? parameters.dw : parameters.dh,
            windowWidth: dimensions.w, windowHeight: dimensions.h,
            ...this.visual, fit: mode === 'dynamic' ? 'contain' : mode
        });
    }

    async writeGeometry(geometry, valid = () => true) {
        if (!geometry) return;
        // 裁剪保持等比缩放；zoom按2的指数放大，pan按完整缩放后矩形的尺寸计算。
        // 不依赖较新版本才提供的scale属性，也不在每次移动前将zoom/pan归零。
        for (const [name, value] of Object.entries({ 'video-zoom': Math.log2(geometry.scaleX),
            'video-pan-x': geometry.panX, 'video-pan-y': geometry.panY })) {
            if (!valid()) return;
            await this.command(['set_property', name, value]);
        }
    }

    async resetProperty(name, value) {
        if (this.unsupportedResetProperties.has(name)) return;
        try {
            await this.command(['set_property', name, value]);
        } catch (error) {
            // 老版mpv没有scale属性时也能使用原生panscan；仅忽略明确的可选属性缺失。
            if (!['property not found', 'property unavailable'].includes(error.mpvError)) throw error;
            if (error.mpvError === 'property not found') this.unsupportedResetProperties.add(name);
        }
    }

    nativePanscan() {
        const values = { contain: 0, cover: 1, dynamic: 0, crop: 0 };
        if (Object.hasOwn(values, this.visual.fit)) return values[this.visual.fit];
        // height/width在任意比例下均等价于contain或cover，沿用网页旋转后的指定轴语义。
        const geometry = this.geometry();
        return geometry && Math.max(geometry.scaleX, geometry.scaleY) > 1 + 1e-8 ? 1 : 0;
    }

    async applyGeometry() {
        if (!this.current || this.current.mediaType === 'audio' || !this.session?.socket || this.session.disposed) return;
        const revision = this.revision;
        const epoch = this.dynamicEpoch;
        const valid = () => revision === this.revision && epoch === this.dynamicEpoch && !this.closed && !!this.current;
        for (const [name, value] of [['video-rotate', this.visual.rotation], ['keepaspect', true],
            ['video-unscaled', 'no'], ['video-align-x', 0], ['video-align-y', 0]]) {
            if (!valid()) return;
            await this.command(['set_property', name, value]);
        }
        for (const name of ['video-scale-x', 'video-scale-y']) {
            if (!valid()) return;
            await this.resetProperty(name, 1);
        }
        if (!valid()) return;
        await this.command(['set_property', 'panscan', this.nativePanscan()]);
        const geometry = this.visual.fit === 'crop' ? this.geometry() : { scaleX: 1, panX: 0, panY: 0 };
        await this.writeGeometry(geometry, valid);
    }

    /** 高频裁剪和尺寸变化共用一个串行任务，丢弃过期中间状态，最后一次输入一定应用。 */
    queueGeometry() {
        if (this.geometryUpdate?.revision === this.revision) return this.geometryUpdate.promise;
        const update = { revision: this.revision, promise: null };
        this.geometryUpdate = update;
        update.promise = this.enqueue(async () => {
            let version;
            do {
                version = this.geometryVersion;
                if (this.closed || update.revision !== this.revision) return false;
                await this.applyGeometry();
            } while (version !== this.geometryVersion);
            if (this.closed || update.revision !== this.revision) return false;
            this.startDynamic();
            return true;
        }).finally(() => {
            // 新媒体可能已经创建下一代任务，旧任务不能清空新代次的引用。
            if (this.geometryUpdate === update) this.geometryUpdate = null;
        });
        return update.promise;
    }

    scheduleGeometry() {
        if (this.geometryTimer || this.closed || !this.current) return;
        this.geometryTimer = setTimeout(async () => {
            this.geometryTimer = null;
            if (this.closed) return;
            this.geometryVersion += 1;
            this.stopDynamic();
            try {
                await this.queueGeometry();
            } catch (error) { this.onError(error); }
        }, 50);
    }

    stopDynamic() {
        this.dynamicEpoch += 1;
        clearTimeout(this.dynamicTimer);
        this.dynamicTimer = null;
    }

    startDynamic() {
        if (this.visual.fit !== 'dynamic' || !this.current || this.current.mediaType === 'audio' || this.closed) return;
        this.stopDynamic();
        const epoch = this.dynamicEpoch;
        const { holdSeconds, transitionSeconds } = this.visual.dynamicFitConfig;
        let from = 0;
        let to = 1;
        let transitionStart = Date.now() + holdSeconds * 1000;
        const tick = async () => {
            if (epoch !== this.dynamicEpoch || this.closed || !this.current) return;
            const fraction = Math.max(0, Math.min(1, (Date.now() - transitionStart) / (transitionSeconds * 1000)));
            const panscan = from + (to - from) * fraction;
            try { await this.command(['set_property', 'panscan', panscan]); }
            catch (error) { if (epoch === this.dynamicEpoch) this.onError(error); return; }
            if (epoch !== this.dynamicEpoch) return;
            if (fraction === 1) {
                [from, to] = [to, from];
                transitionStart = Date.now() + holdSeconds * 1000;
            }
            this.dynamicTimer = setTimeout(tick, Date.now() < transitionStart ? transitionStart - Date.now() : 50);
        };
        this.dynamicTimer = setTimeout(tick, holdSeconds * 1000);
    }

    clear() {
        ++this.revision;
        this.cancelLoad();
        this.stopDynamic();
        clearTimeout(this.geometryTimer);
        this.geometryTimer = null;
        return this.enqueue(async () => {
            const current = this.current;
            this.current = null;
            try {
                if (this.session?.socket && !this.session.disposed) await this.command(['stop']);
            } finally {
                if (current?.file) await this.removeTemporary(current.file);
                this.emit('progress', { isPlaying: false, currentTime: 0, duration: 0 });
            }
        });
    }

    async removeTemporary(file) {
        // Windows可能在stop回执后短暂持有文件句柄，有限重试后交由退出清理并记录错误。
        for (const wait of [0, 30, 100, 250]) {
            if (wait) await sleep(wait);
            try { await fs.unlink(file); return; }
            catch (error) {
                if (error.code === 'ENOENT') return;
                if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || wait === 250) { this.onError(error); return; }
            }
        }
    }

    sessionFailed(session, error) {
        if (session.disposed) return;
        this.stopDynamic();
        this.loading?.reject(error);
        for (const [id, pending] of this.pending) {
            if (pending.session !== session) continue;
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
        this.emit('progress', { isPlaying: false, currentTime: 0, duration: 0 });
        if (!this.closed) this.onError(error);
        void this.disposeSession(session);
    }

    async disposeSession(session) {
        if (!session) return;
        if (session.disposal) return session.disposal;
        session.disposed = true;
        for (const [id, pending] of this.pending) {
            if (pending.session !== session) continue;
            clearTimeout(pending.timer);
            pending.reject(new Error('mpv进程或IPC已关闭'));
            this.pending.delete(id);
        }
        session.socket?.destroy();
        if (this.session === session) {
            this.session = null;
            this.process = null;
            this.current = null;
            this.properties = {};
        }
        session.disposal = (async () => {
            if (session.child && session.child.exitCode === null && !session.child.signalCode) {
                session.child.kill('SIGTERM');
                await Promise.race([session.exit, sleep(1000)]);
                if (session.child.exitCode === null && !session.child.signalCode) {
                    session.child.kill('SIGKILL');
                    await Promise.race([session.exit, sleep(1000)]);
                }
            }
            await fs.rm(session.directory, { recursive: true, force: true }).catch(error => this.onError(error));
        })();
        this.disposals.add(session.disposal);
        try { await session.disposal; }
        finally { this.disposals.delete(session.disposal); }
    }

    async close() {
        if (this.closing) return this.closing;
        this.closed = true;
        this.overlay.close();
        ++this.revision;
        this.cancelLoad();
        this.stopDynamic();
        clearTimeout(this.geometryTimer);
        this.geometryTimer = null;
        this.closing = (async () => {
            await this.disposeSession(this.session);
            if (this.initializing) await this.initializing.catch(() => {});
            await Promise.all([...this.disposals]);
            for (const pending of this.pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(new Error('mpv播放器已关闭'));
            }
            this.pending.clear();
            await this.tail;
            await this.overlayWrite?.promise;
        })();
        return this.closing;
    }
}

module.exports = { MpvPlayer, MEDIA_TYPES };
