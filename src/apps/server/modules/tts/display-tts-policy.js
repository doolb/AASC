'use strict';

/**
 * 判断目标显示端是否处于会阻止特定 TTS 的睡眠状态。
 * 未上报状态时按允许发送处理，避免服务器重启或显示端刚连接时误丢播报。
 *
 * @param {object|null|undefined} displayData 显示端运行时状态
 * @param {object} options TTS 下发选项
 * @returns {boolean} 是否应跳过本次 TTS 下发
 */
function shouldSkipDisplayTts(displayData, options = {}) {
    if (options.checkSleep !== true) return false;

    const sleepState = displayData?.state?.sleepState;
    return sleepState === 'sleep' || sleepState === 'deep';
}

module.exports = {
    shouldSkipDisplayTts
};
