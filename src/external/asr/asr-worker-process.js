const { SherpaOnnxASR } = require('./asr-service');

let asr = null;

function sendMessage(message) {
    if (typeof process.send !== 'function') {
        return;
    }
    process.send(message);
}

function initAsr(options = {}) {
    asr = new SherpaOnnxASR(options);
    sendMessage({
        type: 'ready',
        ready: asr.isReady()
    });
}

async function handleRecognize(message) {
    const requestId = message.id;
    if (!requestId) {
        return;
    }

    if (!asr || !asr.isReady()) {
        sendMessage({
            type: 'response',
            id: requestId,
            ok: false,
            error: 'ASR 独立进程未初始化'
        });
        return;
    }

    try {
        const text = await asr.recognize(message.audioPath);
        sendMessage({
            type: 'response',
            id: requestId,
            ok: true,
            text: text || ''
        });
    } catch (error) {
        sendMessage({
            type: 'response',
            id: requestId,
            ok: false,
            error: error.message
        });
    }
}

process.on('message', async (message) => {
    if (!message || typeof message !== 'object') {
        return;
    }

    if (message.type === 'init') {
        try {
            initAsr(message.options || {});
        } catch (error) {
            sendMessage({
                type: 'ready',
                ready: false,
                error: error.message
            });
        }
        return;
    }

    if (message.type === 'recognize') {
        await handleRecognize(message);
    }
});
