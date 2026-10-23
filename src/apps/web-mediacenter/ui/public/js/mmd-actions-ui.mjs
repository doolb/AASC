import { registerLightingAdapters } from './mmd-lighting-adapters.mjs';
import { initLightingPresets } from './mmd-lighting-presets.mjs';
import './mmd-mpl-ui.mjs';
import './mmd-human-ui.mjs';
import './mmd-human-ik-ui.mjs';
import './mmd-reply-ui.mjs';
import './mmd-expressions-ui.mjs';

function initialize() {
    registerLightingAdapters();
    initLightingPresets();
}
// 静态module在interactive阶段也可能早于DOMContentLoaded，须等既有控件完成分组注册。
if (document.readyState === 'complete') initialize();
else document.addEventListener('DOMContentLoaded', () => queueMicrotask(initialize), { once: true });
