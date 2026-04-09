const { Actor, CapabilityCategory } = require('./actor');
const { MessageTopic } = require('./message');
const { CapabilityLevel } = require('./registry');

class AgentActorAdapter extends Actor {
    constructor(options = {}) {
        const agent = options.agent;
        
        super({
            ip: options.ip || '127.0.0.1',
            role: 'server',
            name: options.name || agent?.name || 'agent-actor',
            capabilities: agent?.capabilities || options.capabilities || [],
            subscriptions: options.subscriptions || [MessageTopic.SYSTEM],
            ...options
        });

        this.agent = agent;
        this.supportedTypes = options.supportedTypes || [];
        this.actionMap = options.actionMap || {};
        this.silentTypes = options.silentTypes || [];
    }

    setAgent(agent) {
        this.agent = agent;
        return this;
    }

    async onInit() {
        if (this.agent && typeof this.agent.init === 'function') {
            await this.agent.init();
        }
        
        for (const type of this.supportedTypes) {
            this.registerHandler(type, this.handleTypedMessage.bind(this));
        }
    }

    async onDestroy() {
        if (this.agent && typeof this.agent.destroy === 'function') {
            await this.agent.destroy();
        }
    }

    async handleMessage(message, context) {
        if (!this.agent) {
            return { success: false, error: 'Agent not configured' };
        }

        const data = message.payload || message;
        const type = data.type;
        
        const specialActions = ['testTimeAnnounce', 'stop', 'getState', 'getReminders'];
        
        let action;
        if (data.action && specialActions.includes(data.action)) {
            action = data.action;
        } else if (this.actionMap[type]) {
            action = this.actionMap[type];
        } else if (data.action) {
            action = data.action;
            if (action === 'play') {
                action = 'playText';
            }
        } else {
            action = type;
        }
        
        try {
            const result = await this.agent.execute(action, data, context);
            return { success: true, result };
        } catch (error) {
            console.error(`[AgentActorAdapter] Agent ${this.agent.name} 执行失败:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async handleTypedMessage(message, context) {
        return this.handleMessage(message, context);
    }

    static createFromAgent(agent, options = {}) {
        return new AgentActorAdapter({
            agent,
            name: options.name || agent.name,
            capabilities: agent.capabilities,
            supportedTypes: options.supportedTypes || [],
            actionMap: options.actionMap || {},
            ...options
        });
    }
}

class ActorFactory {
    static createVoiceCommandActor(options = {}) {
        const { VoiceCommandAgent } = require('./agents');
        const agent = new VoiceCommandAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'voice-command-actor',
            supportedTypes: [
                'voiceCommand',
                'confirmVoiceCommand',
                'executeCommands',
                'getSearchHistory',
                'clearSearchHistory',
                'deleteSearchHistory',
                'getAssistantConfig',
                'setAssistantConfig'
            ],
            actionMap: {
                'voiceCommand': 'processCommand',
                'confirmVoiceCommand': 'confirmCommand',
                'executeCommands': 'executeCommands',
                'getSearchHistory': 'getSearchHistory',
                'clearSearchHistory': 'clearSearchHistory',
                'deleteSearchHistory': 'deleteSearchHistoryItem',
                'getAssistantConfig': 'getAssistantConfig',
                'setAssistantConfig': 'setAssistantConfig'
            },
            ...options
        });
    }

    static createChatActor(options = {}) {
        const { ChatAgent } = require('./agents');
        const agent = new ChatAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'chat-actor',
            supportedTypes: ['chat', 'chatMessage', 'getChatCommands', 'setChatCommands', 'getChatSession', 'setChatSession'],
            actionMap: {
                'chat': 'processMessage',
                'chatMessage': 'processChatMessage',
                'getChatCommands': 'getChatCommands',
                'setChatCommands': 'setChatCommands',
                'getChatSession': 'getChatSession',
                'setChatSession': 'setChatSession'
            },
            ...options
        });
    }

    static createMediaControlActor(options = {}) {
        const { MediaControlAgent } = require('./agents');
        const agent = new MediaControlAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'media-control-actor',
            supportedTypes: ['media', 'mediaBatch', 'control', 'getState'],
            actionMap: {
                'media': 'sendMedia',
                'mediaBatch': 'sendMediaBatch',
                'control': 'sendControl',
                'getState': 'getState'
            },
            ...options
        });
    }

    static createTTSActor(options = {}) {
        const { TTSAgent } = require('./agents');
        const agent = new TTSAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'tts-actor',
            supportedTypes: ['tts'],
            actionMap: {
                'tts': 'playText'
            },
            ...options
        });
    }

    static createReminderActor(options = {}) {
        const { ReminderAgent } = require('./agents');
        const agent = new ReminderAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'reminder-actor',
            supportedTypes: ['getReminders'],
            actionMap: {
                'getReminders': 'getReminders'
            },
            ...options
        });
    }

    static createDisplayRenderActor(options = {}) {
        const { DisplayRenderAgent } = require('./agents');
        const agent = new DisplayRenderAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'display-render-actor',
            supportedTypes: ['canvasSize', 'browserInfo', 'voiceInput', 'voiceStatus', 'commandAck'],
            silentTypes: ['voiceStatus', 'voiceInput'],
            actionMap: {
                'canvasSize': 'updateCanvasSize',
                'browserInfo': 'updateBrowserInfo',
                'voiceInput': 'handleVoiceInput',
                'voiceStatus': 'updateVoiceStatus',
                'commandAck': 'handleCommandAck'
            },
            ...options
        });
    }

    static createSystemCommandActor(options = {}) {
        const { SystemCommandAgent } = require('./agents');
        const agent = new SystemCommandAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'system-command-actor',
            supportedTypes: ['timeAnnounce'],
            actionMap: {
                'timeAnnounce': 'handleTimeAnnounce'
            },
            ...options
        });
    }

    static createSearchActor(options = {}) {
        const { SearchAgent } = require('./agents');
        const agent = new SearchAgent(options);
        
        return AgentActorAdapter.createFromAgent(agent, {
            name: 'search-actor',
            supportedTypes: ['getSearchHistory', 'clearSearchHistory', 'deleteSearchHistory'],
            actionMap: {
                'getSearchHistory': 'getHistory',
                'clearSearchHistory': 'clearHistory',
                'deleteSearchHistory': 'deleteHistoryItem'
            },
            ...options
        });
    }

    static createAllActors(options = {}) {
        return {
            voiceCommandActor: ActorFactory.createVoiceCommandActor(options.voiceCommand || {}),
            chatActor: ActorFactory.createChatActor(options.chat || {}),
            mediaControlActor: ActorFactory.createMediaControlActor(options.mediaControl || {}),
            ttsActor: ActorFactory.createTTSActor(options.tts || {}),
            reminderActor: ActorFactory.createReminderActor(options.reminder || {}),
            displayRenderActor: ActorFactory.createDisplayRenderActor(options.displayRender || {}),
            systemCommandActor: ActorFactory.createSystemCommandActor(options.systemCommand || {}),
            searchActor: ActorFactory.createSearchActor(options.search || {})
        };
    }
}

module.exports = { AgentActorAdapter, ActorFactory };
