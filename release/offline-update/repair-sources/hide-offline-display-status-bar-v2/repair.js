'use strict';

module.exports = async ({ services, assert, log }) => {
    const displayId = 'offline-display';
    const current = await services.config.getDisplayStateById(displayId);
    assert(current && typeof current === 'object', '无法读取 offline-display 的持久状态');

    const updated = await services.config.updateDisplayStateById(displayId, null, { showStatusBar: false });
    assert(updated?.displayId === displayId, '状态栏设置没有保存到 offline-display');
    assert(updated.showStatusBar === false, 'offline-display 的状态栏仍为显示状态');
    log('已隐藏离线本机显示端状态栏', { displayId, showStatusBar: false });
};
