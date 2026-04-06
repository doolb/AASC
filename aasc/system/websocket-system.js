const { getBus, Message, MessageType, MessageTopic, ActorAddress } = require('../message-bus');
const { Actor, ActorBuilder, ActorStatus } = require('../actor');
const { MessageParser } = require('../components/message-parser');
const { MessageDispatcher } = require('../components/message-dispatcher');
const { StateManager } = require('../components/state-manager');

class WebSocketSystem {
    constructor(options = {}) {
        this.bus = options.bus || getBus();
        this.parser = options.parser || new MessageParser(options.parserOptions);
        this.dispatcher = options.dispatcher || new MessageDispatcher({
            actorRegistry: this.bus.actors
        });
        this.stateManager = options.stateManager || new StateManager(options.stateOptions);
        
        this.actors = new Map();
        this.agents = new Map();
        this.middlewares = [];
        
        this.config = {
            localIP: options.localIP || '127.0.0.1',
            port: options.port || 8081,
            ...options.config
        };
        
        this.callbacks = {
            sendToDisplay: options.sendToDisplay || null,
            broadcastToControls: options.broadcastToControls || null,
            onDisplayConnect: options.onDisplayConnect || null,
            onDisplayDisconnect: options.onDisplayDisconnect || null,
            onControlConnect: options.onControlConnect || null,
            onControlDisconnect: options.onControlDisconnect || null
        };
        
        this._initialized = false;
    }

    async initialize() {
        if (this._initialized) {
            return this;
        }

        await this._initSystemActor();
        await this._initDefaultActors();
        
        this.dispatcher.actorRegistry = this.bus.actors;
        
        this._initialized = true;
        console.log('[WebSocketSystem] 系统初始化完成');
        
        return this;
    }

    async _initSystemActor() {
        const systemActor = new ActorBuilder()
            .withAddress(this.config.localIP, 'server', 'websocket-system')
            .withCapabilities([
                {
                    id: 'websocket-routing',
                    name: 'WebSocket 路由',
                    category: 'special',
                    level: 5,
                    securityLevel: 0,
                    description: 'WebSocket 消息路由和分发能力'
                },
                {
                    id: 'state-management',
                    name: '状态管理',
                    category: 'special',
                    level: 3,
                    securityLevel: 0,
                    description: '系统状态管理能力'
                }
            ])
            .withSubscriptions([
                MessageTopic.SYSTEM,
                MessageTopic.ACTOR_LIFECYCLE
            ])
            .withBus(this.bus)
            .build();

        await systemActor.init();
        this.actors.set('websocket-system', systemActor);
        
        return systemActor;
    }

    async _initDefaultActors() {
        return this;
    }

    registerActor(name, actor) {
        const actorName = actor.name || actor.address?.name || name;
        this.actors.set(actorName, actor);
        this.dispatcher.registerHandler(actorName, actorName);
        
        if (actor.silentTypes && actor.silentTypes.length > 0) {
            this.dispatcher.addSilentTypes(actor.silentTypes);
        }
        return this;
    }

    unregisterActor(name) {
        this.actors.delete(name);
        return this;
    }

    getActor(name) {
        return this.actors.get(name);
    }

    registerAgent(name, agent) {
        this.agents.set(name, agent);
        return this;
    }

    getAgent(name) {
        return this.agents.get(name);
    }

    use(middleware) {
        this.middlewares.push(middleware);
        this.dispatcher.use(middleware);
        return this;
    }

    setSendToDisplay(callback) {
        this.callbacks.sendToDisplay = callback;
        return this;
    }

    setBroadcastToControls(callback) {
        this.callbacks.broadcastToControls = callback;
        return this;
    }

    sendToDisplay(displayId, data) {
        if (this.callbacks.sendToDisplay) {
            return this.callbacks.sendToDisplay(displayId, data);
        }
        console.warn('[WebSocketSystem] sendToDisplay callback not set');
        return false;
    }

    broadcastToControls(data) {
        if (this.callbacks.broadcastToControls) {
            return this.callbacks.broadcastToControls(data);
        }
        console.warn('[WebSocketSystem] broadcastToControls callback not set');
        return false;
    }

    async handleDisplayMessage(displayId, rawMessage, ws) {
        const source = new ActorAddress(
            this._getDisplayIP(displayId),
            'display',
            displayId
        );

        const parsed = this.parser.parseToMessage(rawMessage, source);
        
        if (!parsed.success) {
            console.error('[WebSocketSystem] 消息解析失败:', parsed.error);
            return { success: false, error: parsed.error };
        }

        const context = {
            displayId,
            ws,
            source,
            system: this,
            stateManager: this.stateManager,
            actorMap: this.actors,
            sendToDisplay: (id, data) => this.sendToDisplay(id, data),
            broadcastToControls: (data) => this.broadcastToControls(data)
        };

        const result = await this.dispatcher.dispatch(parsed.data, context);
        
        return {
            success: result.dispatched,
            ...result
        };
    }

    async handleControlMessage(rawMessage, ws) {
        const source = new ActorAddress(
            this.config.localIP,
            'control',
            `control-${Date.now()}`
        );

        const parsed = this.parser.parseToMessage(rawMessage, source);
        
        if (!parsed.success) {
            console.error('[WebSocketSystem] 消息解析失败:', parsed.error);
            return { success: false, error: parsed.error };
        }

        const context = {
            ws,
            source,
            system: this,
            stateManager: this.stateManager,
            actorMap: this.actors,
            displayClients: this.stateManager.get('displayClients'),
            sendToDisplay: (id, data) => this.sendToDisplay(id, data),
            broadcastToControls: (data) => this.broadcastToControls(data)
        };

        const result = await this.dispatcher.dispatch(parsed.data, context);
        
        return {
            success: result.dispatched,
            ...result
        };
    }

    handleDisplayConnect(displayId, clientIP, ws, savedState = null) {
        const displayState = {
            ws: ws,
            ip: clientIP,
            state: {
                ...this._createDisplayState(),
                ...savedState
            }
        };

        this.stateManager.setDisplayClient(displayId, displayState);

        if (this.callbacks.onDisplayConnect) {
            this.callbacks.onDisplayConnect(displayId, clientIP, ws);
        }

        this.broadcastToControls({ 
            type: 'displayList', 
            list: this.stateManager.getDisplayList() 
        });

        console.log(`[WebSocketSystem] 显示端 ${displayId} (${clientIP}) 已连接`);
        
        return displayState;
    }

    handleDisplayDisconnect(displayId) {
        this.stateManager.removeDisplayClient(displayId);

        if (this.callbacks.onDisplayDisconnect) {
            this.callbacks.onDisplayDisconnect(displayId);
        }

        this.broadcastToControls({ 
            type: 'displayList', 
            list: this.stateManager.getDisplayList() 
        });

        console.log(`[WebSocketSystem] 显示端 ${displayId} 已断开`);
    }

    handleControlConnect(ws) {
        const controlClients = this.stateManager.get('controlClients') || new Set();
        controlClients.add(ws);
        this.stateManager.set('controlClients', controlClients);

        if (this.callbacks.onControlConnect) {
            this.callbacks.onControlConnect(ws);
        }

        console.log(`[WebSocketSystem] 控制端已连接，当前连接数: ${controlClients.size}`);
        
        return controlClients.size;
    }

    handleControlDisconnect(ws) {
        const controlClients = this.stateManager.get('controlClients');
        if (controlClients) {
            controlClients.delete(ws);
            this.stateManager.set('controlClients', controlClients);
        }

        if (this.callbacks.onControlDisconnect) {
            this.callbacks.onControlDisconnect(ws);
        }

        console.log(`[WebSocketSystem] 控制端已断开`);
    }

    _createDisplayState() {
        return {
            currentMedia: null,
            rotation: 0,
            fit: 'contain',
            crop: { x: 0, y: 0, width: 100, height: 100 },
            volume: 100,
            isPlaying: false,
            canvasSize: { width: 1920, height: 1080 },
            browserInfo: null
        };
    }

    _getDisplayIP(displayId) {
        const displayClient = this.stateManager.getDisplayClient(displayId);
        return displayClient?.ip || 'unknown';
    }

    getDisplayList() {
        return this.stateManager.getDisplayList();
    }

    getDisplayClient(displayId) {
        return this.stateManager.getDisplayClient(displayId);
    }

    getStats() {
        return {
            actors: this.actors.size,
            agents: this.agents.size,
            displayClients: this.stateManager.get('displayClients')?.size || 0,
            controlClients: this.stateManager.get('controlClients')?.size || 0,
            middlewares: this.middlewares.length,
            bus: this.bus.getStats()
        };
    }

    async shutdown() {
        for (const [name, actor] of this.actors) {
            try {
                await actor.destroy();
                console.log(`[WebSocketSystem] Actor ${name} 已销毁`);
            } catch (error) {
                console.error(`[WebSocketSystem] Actor ${name} 销毁失败:`, error.message);
            }
        }

        this.actors.clear();
        this.agents.clear();
        this._initialized = false;
        
        console.log('[WebSocketSystem] 系统已关闭');
    }

    static create(options = {}) {
        return new WebSocketSystem(options);
    }
}

module.exports = { WebSocketSystem };
