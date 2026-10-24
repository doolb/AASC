'use strict';

const { normalizeEnabled } = require('../../../web-mediacenter/ui/public/js/video-black-borders');

/** 开关沿用显示端权威配置，不把当前视频的检测矩形写入持久状态。 */
function createVideoBlackBordersControl({ persist, broadcast, send }) {
    return {
        handle(display, data) {
            const fields = { autoBlackBorders: 'autoBlackBorders', blackBorderTransition: 'blackBorderTransition' };
            const field = Object.hasOwn(fields, data.action) ? fields[data.action] : null;
            if (!field) return false;
            const reply = error => broadcast({ type: 'autoBlackBordersConfig', displayId: display.displayId,
                enabled: normalizeEnabled(display.state.autoBlackBorders), transition: normalizeEnabled(display.state.blackBorderTransition),
                ...(error ? { error } : {}) });
            if (typeof data.value !== 'boolean') { reply('黑边设置必须为布尔值'); return true; }
            try {
                persist(display, { [field]: data.value }, { requireSave: true });
                display.state[field] = data.value;
                send(display.displayId, { type: 'control', action: data.action, value: data.value });
                reply();
            } catch { reply('黑边设置保存失败，请重试'); }
            return true;
        }
    };
}

module.exports = { createVideoBlackBordersControl, normalizeEnabled };
