'use strict';

// 只接受明确列出的操作，并由连接身份决定目标，不能让显示端代替其他设备发指令。
function normalizeQuickControl(data, displayId) {
    if (!data || !displayId) return null;
    const action = data.action;
    if (action === 'quickPlay') {
        const name = typeof data.value === 'string' ? data.value.trim().slice(0, 200) : '';
        return name ? { type: 'voiceCommand', displayId, text: `播放${name}` } : null;
    }
    if (action === 'playlist') {
        return ['pause', 'resume', 'prev', 'next', 'stop'].includes(data.value)
            ? { type: 'playlistControl', displayIds: [displayId], action: data.value } : null;
    }
    const validators = {
        clearMedia: value => value === undefined,
        play: value => typeof value === 'boolean',
        volume: value => Number.isInteger(value) && value >= 0 && value <= 100,
        fit: value => ['contain', 'cover', 'dynamic', 'crop'].includes(value),
        textPlayback: value => value && ['play', 'pause', 'prev', 'next', 'stop'].includes(value.action),
        textStyle: value => value && ['auto', 'small', 'medium', 'large'].includes(value.fontSize)
            && ['compact', 'normal', 'loose'].includes(value.lineHeight)
            && ['small', 'normal', 'large'].includes(value.pageMargin)
    };
    if (!Object.hasOwn(validators, action) || !validators[action](data.value)) return null;
    let value = data.value;
    if (action === 'textPlayback') value = { action: value.action };
    if (action === 'textStyle') value = { background: '#FFF4B8', color: '#333333', fontSize: value.fontSize, lineHeight: value.lineHeight, pageMargin: value.pageMargin };
    return { type: 'control', displayId, action, value };
}
module.exports = { normalizeQuickControl };
