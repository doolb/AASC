const { MessageRouter, RoutingRule, MessageFilter, FilterBuilder } = require('../router');

class MessageDispatcher {
    constructor(options = {}) {
        this.router = options.router || new MessageRouter();
        this.handlers = new Map();
        this.middlewares = [];
        this.actorRegistry = options.actorRegistry || null;
        this.defaultHandler = null;
        this.silentTypes = new Set();
        
        this._initDefaultRoutes();
    }

    addSilentTypes(types) {
        types.forEach(type => this.silentTypes.add(type));
    }

    isSilentType(type) {
        return this.silentTypes.has(type);
    }

    _initDefaultRoutes() {
        this.registerRoute({
            type: 'voiceCommand',
            handler: 'voice-command-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'chat',
            handler: 'chat-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'chatMessage',
            handler: 'chat-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'getChatCommands',
            handler: 'chat-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'setChatCommands',
            handler: 'chat-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'getChatSession',
            handler: 'chat-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'setChatSession',
            handler: 'chat-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'media',
            handler: 'media-control-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'mediaBatch',
            handler: 'media-control-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'control',
            handler: 'media-control-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'getState',
            handler: 'media-control-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'tts',
            handler: 'tts-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'getReminders',
            handler: 'reminder-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'timeAnnounce',
            handler: 'system-command-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'voiceInput',
            handler: 'voice-command-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'canvasSize',
            handler: 'display-render-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'browserInfo',
            handler: 'display-render-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'commandAck',
            handler: 'display-render-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'capabilities',
            handler: 'display-render-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'voiceStatus',
            handler: 'display-render-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'getSearchHistory',
            handler: 'search-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'clearSearchHistory',
            handler: 'search-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'deleteSearchHistory',
            handler: 'search-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'getAssistantConfig',
            handler: 'voice-command-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'setAssistantConfig',
            handler: 'voice-command-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'confirmVoiceCommand',
            handler: 'voice-command-actor',
            priority: 10
        });

        this.registerRoute({
            type: 'executeCommands',
            handler: 'voice-command-actor',
            priority: 10
        });
    }

    registerRoute(route) {
        const rule = new RoutingRule({
            topic: route.topic || route.type,
            type: route.type,
            handler: route.handler,
            priority: route.priority || 5,
            condition: route.condition
        });

        this.router.addRule(rule);
        
        if (!this.handlers.has(route.type)) {
            this.handlers.set(route.type, route.handler);
        }

        return this;
    }

    registerHandler(type, handler) {
        this.handlers.set(type, handler);
        return this;
    }

    use(middleware) {
        if (typeof middleware === 'function') {
            this.middlewares.push(middleware);
        }
        return this;
    }

    setDefaultHandler(handler) {
        this.defaultHandler = handler;
        this.router.setDefaultHandler(handler);
        return this;
    }

    async dispatch(message, context = {}) {
        let processedMessage = message;

        if (this.isSilentType(processedMessage.type)) {
            processedMessage.silent = true;
        }

        for (const middleware of this.middlewares) {
            try {
                const result = await middleware(processedMessage, context);
                if (result === false) {
                    return { dispatched: false, reason: 'Middleware rejected' };
                }
                if (result && typeof result === 'object') {
                    processedMessage = result;
                }
            } catch (error) {
                console.error('[MessageDispatcher] 中间件错误:', error.message);
                return { dispatched: false, reason: error.message };
            }
        }

        const handlerName = this.handlers.get(processedMessage.type) || 
                           this.findHandlerByRule(processedMessage);

        if (!handlerName) {
            if (this.defaultHandler) {
                return await this.executeHandler(this.defaultHandler, processedMessage, context);
            }
            return { dispatched: false, reason: `No handler found for type: ${processedMessage.type}` };
        }

        return await this.executeHandler(handlerName, processedMessage, context);
    }

    findHandlerByRule(message) {
        const actors = this.actorRegistry ? Array.from(this.actorRegistry.values()) : [];
        const targets = this.router.route(message, actors);
        
        if (targets && targets.length > 0) {
            return targets[0].name;
        }

        return null;
    }

    async executeHandler(handlerName, message, context) {
        const handler = context.actorMap?.get(handlerName);
        
        if (!handler) {
            return { 
                dispatched: false, 
                reason: `Handler not found: ${handlerName}`,
                handlerName 
            };
        }

        try {
            const result = await handler.handleMessage(message, context);
            return {
                dispatched: true,
                handler: handlerName,
                result: result
            };
        } catch (error) {
            console.error(`[MessageDispatcher] 执行处理器错误 (${handlerName}):`, error.message);
            return {
                dispatched: false,
                reason: error.message,
                handler: handlerName
            };
        }
    }

    getHandler(type) {
        return this.handlers.get(type);
    }

    getHandlers() {
        return new Map(this.handlers);
    }

    getRoutes() {
        return this.router.getRules();
    }

    clearRoutes() {
        this.router.clearRules();
        this.handlers.clear();
        return this;
    }

    static create(options = {}) {
        return new MessageDispatcher(options);
    }
}

module.exports = { MessageDispatcher };
