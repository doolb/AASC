const { SherpaOnnxASR } = require('./asr-service');

process.on('message', async (message) => {
    if (!message || message.type !== 'recognize' || !message.id) {
        process.exit(1);
    }

    const asr = new SherpaOnnxASR(message.options || {});
    if (!asr.isReady()) {
        process.send({ type: 'response', id: message.id, ok: false, error: 'ASR 初始化失败' });
        process.exit(1);
    }

    try {
        const text = await asr.recognize(message.audioPath);
        process.send({ type: 'response', id: message.id, ok: true, text: text || '' });
    } catch (error) {
        process.send({ type: 'response', id: message.id, ok: false, error: error.message });
    }

    setImmediate(() => process.exit(0));
});
