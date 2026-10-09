/* 按显示端保存持续监听模式；录音能力和临时录音用途保持各自职责。 */
function createDisplayVoiceListeningConfig({ displays, isControl, persist, sendToDisplay, broadcast }) {
    function snapshot(displayId, requestId) {
        return {
            type: 'displayVoiceListeningConfig', displayId,
            enabled: displays.get(displayId)?.state.voiceContinuousEnabled !== false,
            ...(requestId ? { requestId } : {})
        };
    }

    function handle(data, ws, sourceDisplayId = null) {
        if (data.type !== 'setDisplayVoiceListeningConfig') return false;
        const displayId = sourceDisplayId || String(data.displayId || '');
        const display = displays.get(displayId);
        if (!display || (!isControl(ws) && display.ws !== ws)) return true;
        const previous = display.state.voiceContinuousEnabled !== false;
        try {
            if (typeof data.enabled !== 'boolean') throw new Error('监听模式必须为布尔值');
            if (persist(display, { voiceContinuousEnabled: data.enabled }) === false) throw new Error('监听模式保存失败');
            display.state.voiceContinuousEnabled = data.enabled;
            const message = { ...snapshot(displayId, data.requestId), success: true };
            sendToDisplay(displayId, message);
            broadcast(message);
        } catch (error) {
            display.state.voiceContinuousEnabled = previous;
            const message = { ...snapshot(displayId, data.requestId), success: false, message: error.message };
            if (display.ws === ws) sendToDisplay(displayId, message);
            else if (ws?.readyState === 1) ws.send(JSON.stringify(message));
        }
        return true;
    }
    return Object.freeze({ snapshot, handle });
}
module.exports = { createDisplayVoiceListeningConfig };
