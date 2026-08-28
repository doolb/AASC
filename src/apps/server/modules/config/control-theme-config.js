'use strict';

// 控制端主题的服务端白名单必须与 ui-theme.js 保持同步，防止配置文件写入未注册主题。
const CONTROL_THEMES = Object.freeze([
    'dark', 'light', 'warm', 'pink', 'lavender-yellow', 'red-blue', 'gold',
    'mint', 'ocean', 'forest', 'slate', 'algae-salt', 'girl-pink',
    'rose-gold', 'new-year-red'
]);

function isControlTheme(theme) {
    return typeof theme === 'string' && CONTROL_THEMES.includes(theme);
}

function normalizeControlTheme(theme, fallback = 'dark') {
    return isControlTheme(theme) ? theme : fallback;
}

module.exports = {
    CONTROL_THEMES,
    isControlTheme,
    normalizeControlTheme
};
