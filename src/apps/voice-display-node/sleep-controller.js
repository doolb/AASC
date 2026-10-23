'use strict';
const DEFAULT_SLEEP = Object.freeze({ enabled: false, startHour: 23, endHour: 8, deepStartHour: 1, deepEndHour: 6 });
const hour = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(23, Math.round(Number(value)))) : fallback;
const inWindow = (value, start, end) => start > end ? value >= start || value < end : value >= start && value < end;

/** 复用网页当前优先级：手动覆盖优先，临时激活清除覆盖；计时器不保持进程存活。 */
class NodeSleepController {
    constructor({ apply, send, extra = () => ({}), onError = () => {}, now = Date.now, setTimer = setInterval, clearTimer = clearInterval }) {
        Object.assign(this, { apply, send, extra, onError, now, clearTimer });
        this.settings = { ...DEFAULT_SLEEP }; this.state = 'normal'; this.manualMode = null; this.activationUntil = 0;
        this.pending = Promise.resolve(); this.closed = false;
        this.timer = setTimer(() => { void this.check().catch(onError); }, 10000); this.timer?.unref?.();
    }
    get paused() { return this.state === 'sleep' || this.state === 'deep'; }
    target() {
        if (this.manualMode) return this.manualMode;
        if (this.now() < this.activationUntil) return 'active';
        if (!this.settings.enabled) return 'normal';
        const h = new Date(this.now()).getHours();
        if (inWindow(h, this.settings.deepStartHour, this.settings.deepEndHour)) return 'deep';
        return inWindow(h, this.settings.startHour, this.settings.endHour) ? 'sleep' : 'normal';
    }
    report() { this.send({ type: 'sleepStateReport', sleepState: this.state, ...this.extra() }); }
    check(force = false) {
        if (this.closed) return Promise.resolve();
        const state = this.target();
        if (!force && state === this.state) return this.pending;
        this.state = state;
        // 状态先确定再串行应用；新媒体可立即看见当前遮罩/暂停意图。
        this.pending = this.pending.catch(this.onError).then(async () => { if (this.closed || state !== this.state) return; await this.apply(state); if (state === this.state) this.report(); });
        return this.pending;
    }
    restore(settings) {
        if (!settings || typeof settings !== 'object') return this.check();
        this.settings = { enabled: settings.enabled === true, ...Object.fromEntries(
            ['startHour', 'endHour', 'deepStartHour', 'deepEndHour'].map(key => [key, hour(settings[key], DEFAULT_SLEEP[key])])) };
        return this.check(true);
    }
    activate() { this.manualMode = null; this.activationUntil = this.now() + 60000; return this.check(); }
    handles(action) { return ['sleepSettings', 'sleepActivate', 'sleepOverride'].includes(action); }
    async control(data) {
        const actions = {
            sleepSettings: () => this.restore(data.value),
            sleepActivate: () => this.activate(),
            sleepOverride: () => { this.activationUntil = 0; this.manualMode = ['sleep', 'deep'].includes(data.value) ? data.value : null; return this.check(); }
        };
        await actions[data.action](); this.report();
    }
    async close() { this.closed = true; this.clearTimer(this.timer); await this.pending.catch(this.onError); }
}
module.exports = { NodeSleepController, DEFAULT_SLEEP, inWindow };
