'use strict';

(function exposeDynamicFitController(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
        return;
    }
    root.DynamicFitController = api.DynamicFitController;
})(typeof globalThis !== 'undefined' ? globalThis : window, () => {
    const DEFAULT_TRANSITION_MS = 3000;
    const DEFAULT_HOLD_MS = 2000;

    function positiveMilliseconds(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    class DynamicFitController {
        constructor(options = {}) {
            this.transitionMs = positiveMilliseconds(options.transitionMs, DEFAULT_TRANSITION_MS);
            this.holdMs = positiveMilliseconds(options.holdMs, DEFAULT_HOLD_MS);
            this.schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
            this.cancel = options.cancel || (timer => clearTimeout(timer));
            this.onPhase = typeof options.onPhase === 'function' ? options.onPhase : (() => {});
            this.timer = null;
            this.running = false;
        }

        start() {
            this.stop();
            this.running = true;
            this.emitPhase('contain', 0);
            this.scheduleNext(() => this.enterCoverTransition(), this.holdMs);
        }

        stop() {
            this.running = false;
            if (this.timer !== null) {
                this.cancel(this.timer);
                this.timer = null;
            }
        }

        scheduleNext(callback, delay) {
            if (!this.running) return;
            this.timer = this.schedule(() => {
                this.timer = null;
                callback();
            }, delay);
        }

        emitPhase(mode, transitionMs) {
            this.onPhase({ mode, transitionMs });
        }

        enterCoverTransition() {
            if (!this.running) return;
            this.emitPhase('cover', this.transitionMs);
            this.scheduleNext(() => this.enterCoverHold(), this.transitionMs);
        }

        enterCoverHold() {
            if (!this.running) return;
            this.emitPhase('cover', 0);
            this.scheduleNext(() => this.enterContainTransition(), this.holdMs);
        }

        enterContainTransition() {
            if (!this.running) return;
            this.emitPhase('contain', this.transitionMs);
            this.scheduleNext(() => this.enterContainHold(), this.transitionMs);
        }

        enterContainHold() {
            if (!this.running) return;
            this.emitPhase('contain', 0);
            this.scheduleNext(() => this.enterCoverTransition(), this.holdMs);
        }
    }

    return { DynamicFitController };
});
