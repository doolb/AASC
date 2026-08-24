'use strict';

/**
 * 注册文本媒体显示端协议。通用显示端事件继续走既有回退处理，分句 TTS
 * 使用独立服务，避免被通用路由吞掉或和整段 TTS 队列混用。
 *
 * @param {object} dependencies 服务器 WebSocket 依赖
 * @param {object} dependencies.wsServer ViewBind WebSocket 服务
 * @param {string[]} dependencies.displayTypes 通用显示端消息类型
 * @param {Function} dependencies.handleDisplayMessage 既有显示端回退处理
 * @param {{handleSentenceRequest: Function, handleSentenceFinished: Function}} textMediaTtsService 文本媒体 TTS 服务
 */
function registerTextMediaDisplayHandlers({ wsServer, displayTypes, handleDisplayMessage }, textMediaTtsService) {
    for (const type of displayTypes) {
        wsServer.registerHandler(type, (data, ctx) => {
            handleDisplayMessage(ctx.displayId, data, ctx.ws);
        });
    }

    wsServer.registerHandler('textSentenceTts', async (data, ctx) => {
        await textMediaTtsService.handleSentenceRequest(ctx.displayId, data);
    });

    wsServer.registerHandler('textSentenceTtsFinished', (data, ctx) => {
        textMediaTtsService.handleSentenceFinished(ctx.displayId, data);
    });
}

/**
 * 处理显示端上报的文本播放进度。只复制恢复文本播放所需的标量字段，
 * 防止临时播放列表的 base64 正文进入设备持久化配置。
 *
 * @returns {boolean} 当前消息是否已处理
 */
function handleTextMediaDisplayMessage({ displayId, data, displayData, persistDisplayState, broadcastToControls }) {
    if (data.type !== 'textProgress' || !displayData) return false;

    const textProgress = {
        playbackId: data.playbackId,
        pageIndex: data.pageIndex,
        pageTotal: data.pageTotal,
        sentenceIndex: data.sentenceIndex,
        sentenceTotal: data.sentenceTotal,
        state: data.state,
        format: data.format
    };
    displayData.state.currentTextProgress = textProgress;
    persistDisplayState(displayData, { currentTextProgress: textProgress });
    broadcastToControls({
        displayId,
        type: 'textProgress',
        ...textProgress
    });
    return true;
}

/**
 * 处理文本媒体的控制消息。样式需要持久化；暂停、翻页和停止必须使旧的
 * 异步音频回包失效。两类消息均原样继续转发给显示端。
 *
 * @returns {boolean} 当前消息是否已处理并转发
 */
function handleTextMediaControlMessage({
    displayId,
    data,
    displayData,
    persistDisplayState,
    sendToDisplay,
    textMediaTtsService
}) {
    if (data.type !== 'control' || !displayData) return false;

    if (data.action === 'textStyle') {
        displayData.state.textStyle = data.value;
        persistDisplayState(displayData, { textStyle: data.value });
    } else if (data.action === 'textPlayback') {
        const playbackAction = data.value?.action;
        const playbackId = data.value?.playbackId || displayData.state.currentTextProgress?.playbackId;
        if (['pause', 'prev', 'next', 'stop'].includes(playbackAction) && playbackId) {
            textMediaTtsService.cancel(displayId, playbackId);
        }
        if (playbackAction === 'stop') {
            textMediaTtsService.clearDisplayRoute?.(displayId);
        }
    } else {
        return false;
    }

    sendToDisplay(displayId, data);
    return true;
}

module.exports = {
    registerTextMediaDisplayHandlers,
    handleTextMediaDisplayMessage,
    handleTextMediaControlMessage
};
