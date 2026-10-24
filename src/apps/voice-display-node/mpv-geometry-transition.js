'use strict';

/** 黑边确认后的短过渡只写原生几何，不等待其完成才处理其他媒体指令。 */
class MpvGeometryTransition {
    constructor({ write, complete, onError, now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout }) {
        Object.assign(this, { write, complete, onError, now, schedule, cancelTimer: cancel });
        this.current = null; this.timer = null;
    }
    cancel() { this.current = null; this.cancelTimer(this.timer); this.timer = null; }
    start(from, to, valid) {
        this.cancel();
        const state = { started: this.now() }; this.current = state;
        const active = () => this.current === state && valid();
        const tick = async () => {
            this.timer = null;
            if (!active()) { if (this.current === state) this.cancel(); return; }
            const fraction = Math.min(1, Math.max(0, (this.now() - state.started) / 200));
            const eased = fraction * fraction * (3 - 2 * fraction);
            const geometry = {};
            for (const key of ['scaleX', 'panX', 'panY']) geometry[key] = from[key] + (to[key] - from[key]) * eased;
            try { await this.write(geometry, active); }
            catch (error) { if (this.current === state) { this.cancel(); this.onError(error); } return; }
            if (!active()) return;
            if (fraction === 1) { this.current = null; this.complete(); return; }
            this.timer = this.schedule(tick, 16);
        };
        this.timer = this.schedule(tick, 16);
    }
}

module.exports = { MpvGeometryTransition };
