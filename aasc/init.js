const {
    WebSocketSystem,
    ActorFactory,
    createMiddlewareChain
} = require('./index');

async function initializeAASCSystem(options = {}) {
    const {
        localIP,
        port,
        voiceCommand,
        chat,
        tts,
        reminder,
        timeAnnounce,
        config,
        sendToDisplay,
        broadcastToControls,
        onDisplayConnect,
        onDisplayDisconnect,
        onControlConnect,
        onControlDisconnect
    } = options;

    const wsSystem = new WebSocketSystem({
        localIP,
        port,
        sendToDisplay,
        broadcastToControls,
        onDisplayConnect,
        onDisplayDisconnect,
        onControlConnect,
        onControlDisconnect
    });

    await wsSystem.initialize();

    const actors = ActorFactory.createAllActors({
        voiceCommand: { voiceCommand, tts, chat },
        chat: { chat, tts },
        tts: { tts, timeAnnounce },
        reminder: { reminder, tts },
        displayRender: {},
        systemCommand: { timeAnnounce, config },
        search: { voiceCommand }
    });

    for (const [name, actor] of Object.entries(actors)) {
        await actor.init();
        wsSystem.registerActor(name, actor);
    }

    const middlewareChain = createMiddlewareChain({
        logging: true,
        errorHandling: true,
        validation: true,
        displayCheck: true,
        timeout: 30000,
        rateLimit: {
            maxRequests: 100,
            windowMs: 60000,
            exemptTypes: ['voiceStatus', 'voiceInput', 'heartbeat', 'commandAck', 'canvasSize', 'browserInfo']
        }
    });

    wsSystem.use(async (message, context) => {
        const result = await middlewareChain.execute(message, context);
        if (result && result.success === false) {
            return false;
        }
        return message;
    });

    console.log('[AASC] 系统初始化完成，已注册 Actor:', Object.keys(actors).join(', '));

    return wsSystem;
}

module.exports = {
    initializeAASCSystem
};
