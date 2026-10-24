'use strict';

const { normalizeEnabled } = require('../../../web-mediacenter/ui/public/js/video-black-borders');

/** 开关沿用显示端权威配置，不把当前视频的检测矩形写入持久状态。 */
function createVideoBlackBordersControl({ persist, broadcast, send }) {
    return {
        handle(display, data) {
            if (data.action !== 'autoBlackBorders') return false;
            const reply = error => broadcast({ type: 'autoBlackBordersConfig', displayId: display.displayId,
                enabled: normalizeEnabled(display.state.autoBlackBorders), ...(error ? { error } : {}) });
            if (typeof data.value !== 'boolean') { reply('自动去黑边必须为布尔值'); return true; }
            try {
                persist(display, { autoBlackBorders: data.value }, { requireSave: true });
                display.state.autoBlackBorders = data.value;
                send(display.displayId, { type: 'control', action: 'autoBlackBorders', value: data.value });
                reply();
            } catch { reply('自动去黑边保存失败，请重试'); }
            return true;
        }
    };
}

module.exports = { createVideoBlackBordersControl, normalizeEnabled };
