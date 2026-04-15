const { BaseAgent, AgentBuilder } = require('./base-agent');
const config = require('../../core/config');

class VoiceCommandAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'voice-command-agent',
            description: '语音命令处理 Agent',
            capabilities: [
                { id: 'voice-command', name: '语音命令', category: 'professional', level: 4 }
            ],
            ...options
        });

        this.voiceCommand = options.voiceCommand || null;
        this.tts = options.tts || null;
        this.chat = options.chat || null;
    }

    setVoiceCommand(voiceCommand) {
        this.voiceCommand = voiceCommand;
        return this;
    }

    setTTS(tts) {
        this.tts = tts;
        return this;
    }

    setChat(chat) {
        this.chat = chat;
        return this;
    }

    async processCommand(params, context) {
        const { text, displayId, playOnControl, ws } = params;
        
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        const callbacks = playOnControl ? {
            onResult: async (resultText) => {
                if (this.tts && ws) {
                    const audioPath = await this.tts.generateTTS(resultText);
                    const fileName = require('path').basename(audioPath);
                    ws.send(JSON.stringify({
                        type: 'playOnControl',
                        audioUrl: `/uploads/tts/${fileName}`,
                        text: resultText
                    }));
                }
            },
            onError: async (errorText) => {
                if (this.tts && ws) {
                    const audioPath = await this.tts.generateTTS(errorText);
                    const fileName = require('path').basename(audioPath);
                    ws.send(JSON.stringify({
                        type: 'playOnControl',
                        audioUrl: `/uploads/tts/${fileName}`,
                        text: errorText
                    }));
                }
            }
        } : null;

        const result = await this.voiceCommand.processVoiceCommand(text, displayId, callbacks);
        
        return result;
    }

    async executeCommands(params, context) {
        const { actions, displayId, playOnControl, ws } = params;
        
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        await this.voiceCommand.executeCommands(actions, displayId, {
            onChat: async (message) => {
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chatMessage',
                        content: message,
                        displayId,
                        playOnControl
                    }));
                }
            }
        });

        return { success: true };
    }

    async confirmCommand(params, context) {
        const { confirmationId, confirmed } = params;
        
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        this.voiceCommand.executeReminderConfirmation(confirmationId, confirmed);
        
        return { success: true };
    }

    async getSearchHistory(params, context) {
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        return this.voiceCommand.getSearchHistory();
    }

    async clearSearchHistory(params, context) {
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        this.voiceCommand.clearSearchHistory();
        return [];
    }

    async deleteSearchHistoryItem(params, context) {
        const { id } = params;
        
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        this.voiceCommand.deleteSearchHistoryItem(id);
        return this.voiceCommand.getSearchHistory();
    }

    async getAssistantConfig(params, context) {
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        return this.voiceCommand.getAssistantConfig();
    }

    async setAssistantConfig(params, context) {
        const { config } = params;
        
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        this.voiceCommand.setAssistantConfig(config);
        return this.voiceCommand.getAssistantConfig();
    }

    async processVoiceInput(params, context) {
        const { text, displayId, fullText } = params;
        
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        const voiceText = text || fullText;
        
        if (!voiceText) {
            return { success: false, error: 'No text in voiceInput' };
        }

        const displayClient = context.stateManager?.getDisplayClient(displayId);
        const displayIP = displayClient?.ip || 'unknown';
        const normalizedText = typeof voiceText === 'string' ? voiceText.trim() : '';

        if (!normalizedText || /^[\s.!?，。！？、]+$/u.test(normalizedText)) {
            console.log(`[语音输入] 忽略无效语音输入: ${voiceText}`);
            return { success: true, ignored: true };
        }
        
        console.log(`[语音输入] 显示端 ${displayId} (${displayIP}): ${normalizedText}`);

        const result = await this.voiceCommand.enqueueVoiceInput(normalizedText, displayId, null);
        
        return { success: true, data: result };
    }
}

class ChatAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'chat-agent',
            description: '聊天处理 Agent',
            capabilities: [
                { id: 'chat', name: '聊天', category: 'professional', level: 4 }
            ],
            ...options
        });

        this.chat = options.chat || null;
        this.tts = options.tts || null;
    }

    setChat(chat) {
        this.chat = chat;
        return this;
    }

    setTTS(tts) {
        this.tts = tts;
        return this;
    }

    async processMessage(params, context) {
        const { message, displayId, useTemplate, playOnControl, ws } = params;
        
        if (!this.chat) {
            throw new Error('Chat 模块未初始化');
        }

        const callbacks = {
            onChunk: (chunk, fullMessage) => {
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chatChunk',
                        chunk: chunk,
                        message: fullMessage
                    }));
                }
            },
            onSentence: async (sentence, fullMessage) => {
                if (this.tts && displayId && !playOnControl) {
                    const audioPath = await this.tts.generateTTS(sentence);
                    const fileName = require('path').basename(audioPath);
                    context.sendToDisplay(displayId, {
                        type: 'tts',
                        action: 'playAudio',
                        audioUrl: `/uploads/tts/${fileName}`,
                        text: sentence
                    });
                } else if (this.tts && playOnControl && ws) {
                    const audioPath = await this.tts.generateTTS(sentence);
                    const fileName = require('path').basename(audioPath);
                    ws.send(JSON.stringify({
                        type: 'playOnControl',
                        audioUrl: `/uploads/tts/${fileName}`,
                        text: sentence
                    }));
                }
            },
            onComplete: (fullMessage, history) => {
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chatResponse',
                        success: true,
                        message: fullMessage,
                        history: history
                    }));
                }
            },
            onError: (error) => {
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chatResponse',
                        success: false,
                        error: error
                    }));
                }
            }
        };

        await this.chat.chatStream(message, {
            useTemplate,
            displayId
        }, callbacks);

        return { success: true };
    }

    async processChatMessage(params, context) {
        const { content, displayId, mode, target, templateTarget, playOnControl, ws } = params;
        
        if (!this.chat) {
            throw new Error('Chat 模块未初始化');
        }

        const session = this.chat.getSession();
        const actualPlayOnControl = playOnControl || session.playOnControl;
        const targetDisplayId = displayId;
        const messageMode = mode || session.mode;
        const messageTarget = messageMode === 'private' ? (target || session.privateTarget) : null;

        this.chat.addMessage({
            role: 'control',
            name: '控制端',
            content: params.displayContent || content,
            mode: messageMode,
            target: messageTarget
        });

        let systemPrompt = null;
        let includeHistory = false;
        
        if (templateTarget) {
            const template = this.chat.getTemplateByName(templateTarget);
            if (template) {
                systemPrompt = template.content;
                if (messageMode === 'private') {
                    includeHistory = true;
                }
            }
        }

        const callbacks = {
            onChunk: (chunk, fullMessage) => {
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chatChunk',
                        chunk: chunk,
                        message: fullMessage
                    }));
                }
            },
            onSentence: async (sentence, fullMessage) => {
                if (this.tts) {
                    const audioPath = await this.tts.generateTTS(sentence);
                    const fileName = require('path').basename(audioPath);
                    const audioUrl = `/uploads/tts/${fileName}`;

                    if (actualPlayOnControl && ws) {
                        ws.send(JSON.stringify({
                            type: 'playOnControl',
                            audioUrl: audioUrl,
                            text: sentence
                        }));
                    } else if (targetDisplayId) {
                        context.sendToDisplay(targetDisplayId, {
                            type: 'tts',
                            action: 'playAudio',
                            audioUrl: audioUrl,
                            text: sentence
                        });
                    }
                }
            },
            onComplete: (fullMessage, history) => {
                this.chat.addMessage({
                    role: 'assistant',
                    name: templateTarget || '助手',
                    content: fullMessage,
                    mode: messageMode,
                    target: messageTarget
                });

                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chatResponse',
                        success: true,
                        message: fullMessage,
                        history: this.chat.getHistory()
                    }));
                }
            },
            onError: (error) => {
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chatResponse',
                        success: false,
                        error: error
                    }));
                }
            }
        };

        await this.chat.chatStream(content, {
            useTemplate: params.useTemplate,
            displayId: targetDisplayId,
            systemPrompt: systemPrompt,
            includeHistory: includeHistory
        }, callbacks);

        return { success: true };
    }

    async getChatCommands(params, context) {
        if (!this.chat) {
            throw new Error('Chat 模块未初始化');
        }

        const commands = this.chat.getCommands();
        
        if (context.ws) {
            context.ws.send(JSON.stringify({
                type: 'chatCommands',
                commands: commands
            }));
        }

        return { success: true, commands };
    }

    async setChatCommands(params, context) {
        if (!this.chat) {
            throw new Error('Chat 模块未初始化');
        }

        this.chat.setCommands(params.commands);
        
        context.broadcastToControls({
            type: 'chatCommands',
            commands: this.chat.getCommands()
        });

        return { success: true };
    }

    async getChatSession(params, context) {
        if (!this.chat) {
            throw new Error('Chat 模块未初始化');
        }

        const session = this.chat.getSession();
        
        if (context.ws) {
            context.ws.send(JSON.stringify({
                type: 'chatSession',
                session: session
            }));
        }

        return { success: true, session };
    }

    async setChatSession(params, context) {
        if (!this.chat) {
            throw new Error('Chat 模块未初始化');
        }

        this.chat.setSession(params.session);
        
        context.broadcastToControls({
            type: 'chatSession',
            session: this.chat.getSession()
        });

        return { success: true };
    }
}

class MediaControlAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'media-control-agent',
            description: '媒体控制 Agent',
            capabilities: [
                { id: 'media-control', name: '媒体控制', category: 'special', level: 3 }
            ],
            ...options
        });
    }

    async sendMedia(params, context) {
        const { displayId, media } = params;
        
        const displayClient = context.stateManager?.getDisplayClient(displayId);
        if (!displayClient) {
            throw new Error(`显示端不存在: ${displayId}`);
        }

        displayClient.state.currentMedia = media;
        config.updateDisplayState(displayClient.ip, { currentMedia: media });
        context.sendToDisplay(displayId, media);

        return { success: true, displayId };
    }

    async sendMediaBatch(params, context) {
        const { displayIds, media } = params;
        const results = [];

        for (const displayId of displayIds) {
            try {
                const displayClient = context.stateManager?.getDisplayClient(displayId);
                if (displayClient) {
                    displayClient.state.currentMedia = media;
                    config.updateDisplayState(displayClient.ip, { currentMedia: media });
                    context.sendToDisplay(displayId, media);
                    results.push({ displayId, success: true });
                } else {
                    results.push({ displayId, success: false, error: '显示端不存在' });
                }
            } catch (error) {
                results.push({ displayId, success: false, error: error.message });
            }
        }

        return { success: true, results };
    }

    async sendControl(params, context) {
        const { displayId, action, value } = params;
        
        const displayClient = context.stateManager?.getDisplayClient(displayId);
        if (!displayClient) {
            throw new Error(`显示端不存在: ${displayId}`);
        }

        if (action === 'rotate') {
            displayClient.state.rotation = value;
            config.updateDisplayState(displayClient.ip, { rotation: value });
        } else if (action === 'fit') {
            displayClient.state.fit = value;
            config.updateDisplayState(displayClient.ip, { fit: value });
        } else if (action === 'crop') {
            displayClient.state.crop = value;
            config.updateDisplayState(displayClient.ip, { crop: value });
        } else if (action === 'volume') {
            displayClient.state.volume = value;
            config.updateDisplayState(displayClient.ip, { volume: value });
        } else if (action === 'play') {
            displayClient.state.isPlaying = value;
            config.updateDisplayState(displayClient.ip, { isPlaying: value });
        }

        context.sendToDisplay(displayId, { type: 'control', action, value });

        return { success: true, displayId, action };
    }

    async getState(params, context) {
        const { displayId } = params;
        
        const displayClient = context.stateManager?.getDisplayClient(displayId);
        if (!displayClient) {
            if (context.ws) {
                context.ws.send(JSON.stringify({
                    type: 'displayState',
                    displayId: displayId,
                    state: {}
                }));
            }
            return { success: true, displayId, state: {} };
        }

        const state = { ...displayClient.state };
        if (state.currentMedia) {
            state.currentMediaUrl = state.currentMedia.url;
            state.currentMediaType = state.currentMedia.mediaType;
        }

        if (context.ws) {
            context.ws.send(JSON.stringify({
                type: 'displayState',
                displayId: displayId,
                state: state
            }));
        }

        return { success: true, displayId, state };
    }
}

class TTSAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'tts-agent',
            description: 'TTS 语音合成 Agent',
            capabilities: [
                { id: 'tts', name: '语音合成', category: 'professional', level: 3 }
            ],
            ...options
        });

        this.tts = options.tts || null;
        this.timeAnnounce = options.timeAnnounce || null;
    }

    setTTS(tts) {
        this.tts = tts;
        return this;
    }

    setTimeAnnounce(timeAnnounce) {
        this.timeAnnounce = timeAnnounce;
        return this;
    }

    async playText(params, context) {
        const { text, displayId, playOnControl, ws } = params;
        
        if (!this.tts) {
            throw new Error('TTS 模块未初始化');
        }

        const chat = require('../../core/chat');
        const sentences = chat.splitIntoSentences(text);
        const path = require('path');

        for (const sentence of sentences) {
            const audioPath = await this.tts.generateTTS(sentence);
            const fileName = path.basename(audioPath);
            const audioUrl = `/uploads/tts/${fileName}`;

            if (playOnControl && ws) {
                ws.send(JSON.stringify({
                    type: 'playOnControl',
                    audioUrl: audioUrl,
                    text: sentence
                }));
            } else if (displayId) {
                context.sendToDisplay(displayId, {
                    type: 'tts',
                    action: 'playAudio',
                    audioUrl: audioUrl,
                    text: sentence
                });
            }
        }

        return { success: true };
    }

    async stop(params, context) {
        const displayClients = context.stateManager?.get('displayClients');
        
        if (displayClients) {
            for (const [displayId] of displayClients) {
                context.sendToDisplay(displayId, { type: 'tts', action: 'stop' });
            }
        }

        return { success: true };
    }

    async testTimeAnnounce(params, context) {
        if (!this.timeAnnounce) {
            throw new Error('TimeAnnounce 模块未初始化');
        }

        const displayClients = context.stateManager?.get('displayClients');
        await this.timeAnnounce.checkAndAnnounce(displayClients, context.sendToDisplay, true);

        return { success: true };
    }
}

class ReminderAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'reminder-agent',
            description: '提醒处理 Agent',
            capabilities: [
                { id: 'reminder', name: '提醒', category: 'basic', level: 2 }
            ],
            ...options
        });

        this.reminder = options.reminder || null;
        this.tts = options.tts || null;
    }

    setReminder(reminder) {
        this.reminder = reminder;
        return this;
    }

    setTTS(tts) {
        this.tts = tts;
        return this;
    }

    async getReminders(params, context) {
        if (!this.reminder) {
            throw new Error('Reminder 模块未初始化');
        }

        const reminders = this.reminder.getReminders();
        const today = new Date();
        const todayReminders = reminders.filter(r => {
            const reminderTime = new Date(r.timestamp);
            return reminderTime.toDateString() === today.toDateString();
        });

        if (todayReminders.length > 0 && params.displayId && this.tts) {
            const text = todayReminders.map(r => `${r.time} ${r.content}`).join('，');
            const audioPath = await this.tts.generateTTS(`今日提醒：${text}`);
            const fileName = require('path').basename(audioPath);
            context.sendToDisplay(params.displayId, {
                type: 'tts',
                action: 'playAudio',
                audioUrl: `/uploads/tts/${fileName}`,
                text: `今日提醒：${text}`
            });
        }

        return { success: true, reminders, todayReminders };
    }
}

class DisplayRenderAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'display-render-agent',
            description: '显示端渲染 Agent',
            capabilities: [
                { id: 'display-render', name: '显示渲染', category: 'basic', level: 2 }
            ],
            ...options
        });
    }

    async updateCanvasSize(params, context) {
        const { displayId, width, height } = params;
        
        const displayClient = context.stateManager?.getDisplayClient(displayId);
        if (!displayClient) {
            throw new Error(`显示端不存在: ${displayId}`);
        }

        displayClient.state.canvasSize = { width, height };
        context.broadcastToControls({ type: 'displayList', list: context.stateManager.getDisplayList() });

        return { success: true };
    }

    async updateBrowserInfo(params, context) {
        const { displayId, ...browserInfo } = params;
        
        const displayClient = context.stateManager?.getDisplayClient(displayId);
        if (!displayClient) {
            throw new Error(`显示端不存在: ${displayId}`);
        }

        displayClient.state.browserInfo = {
            userAgent: browserInfo.userAgent,
            browserName: browserInfo.browserName,
            browserVersion: browserInfo.browserVersion,
            os: browserInfo.os,
            deviceType: browserInfo.deviceType,
            screenWidth: browserInfo.screenWidth,
            screenHeight: browserInfo.screenHeight,
            devicePixelRatio: browserInfo.devicePixelRatio,
            featureSupport: browserInfo.featureSupport
        };

        context.broadcastToControls({ type: 'displayList', list: context.stateManager.getDisplayList() });

        return { success: true };
    }

    async updateVoiceStatus(params, context) {
        const { displayId, supported, listening } = params;
        
        const displayClient = context.stateManager?.getDisplayClient(displayId);
        if (!displayClient) {
            return { success: true, warning: `显示端不存在: ${displayId}` };
        }

        displayClient.state.voiceSupported = supported;
        displayClient.state.voiceListening = listening;

        context.broadcastToControls({ type: 'displayList', list: context.stateManager.getDisplayList() });

        return { success: true };
    }

    async handleCommandAck(params, context) {
        const { displayId, commandType, success, details, timestamp, extraData } = params;

        const ackMsg = {
            type: 'commandAck',
            displayId: displayId,
            commandType: commandType,
            success: success,
            details: details,
            timestamp: timestamp
        };

        if (extraData) {
            ackMsg.extraData = extraData;
        }

        context.broadcastToControls(ackMsg);

        return { success: true };
    }

    async updateCapabilities(params, context) {
        const { displayId, capabilities } = params;
        const displayClient = context.stateManager?.getDisplayClient(displayId);
        if (!displayClient) {
            return { success: true, warning: `显示端不存在: ${displayId}` };
        }

        displayClient.state.capabilities = {
            mediaRendering: true,
            voicePlayback: true,
            voiceRecording: true,
            voiceRecognition: false,
            displayText: true,
            ...(capabilities || {})
        };

        context.broadcastToControls({ type: 'displayList', list: context.stateManager.getDisplayList() });
        console.log(`[能力] 显示端 ${displayId} 声明能力:`, displayClient.state.capabilities);

        return { success: true, capabilities: displayClient.state.capabilities };
    }
}

class SystemCommandAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'system-command-agent',
            description: '系统命令 Agent',
            capabilities: [
                { id: 'system-command', name: '系统命令', category: 'special', level: 5 }
            ],
            ...options
        });

        this.timeAnnounce = options.timeAnnounce || null;
        this.config = options.config || null;
    }

    setTimeAnnounce(timeAnnounce) {
        this.timeAnnounce = timeAnnounce;
        return this;
    }

    setConfig(config) {
        this.config = config;
        return this;
    }

    async handleTimeAnnounce(params, context) {
        const { action } = params;

        if (!this.timeAnnounce) {
            throw new Error('TimeAnnounce 模块未初始化');
        }

        if (action === 'enable') {
            this.timeAnnounce.setConfig({ enabled: true });
            if (this.config) {
                this.config.set('timeAnnounce', this.timeAnnounce.getConfig());
            }
        } else if (action === 'disable') {
            this.timeAnnounce.setConfig({ enabled: false });
            if (this.config) {
                this.config.set('timeAnnounce', this.timeAnnounce.getConfig());
            }
        } else if (action === 'announce') {
            const displayClients = context.stateManager?.get('displayClients');
            await this.timeAnnounce.checkAndAnnounce(displayClients, context.sendToDisplay, true);
        }

        return { success: true, config: this.timeAnnounce.getConfig() };
    }
}

class SearchAgent extends BaseAgent {
    constructor(options = {}) {
        super({
            name: 'search-agent',
            description: '搜索 Agent',
            capabilities: [
                { id: 'search', name: '搜索', category: 'basic', level: 2 }
            ],
            ...options
        });

        this.voiceCommand = options.voiceCommand || null;
    }

    setVoiceCommand(voiceCommand) {
        this.voiceCommand = voiceCommand;
        return this;
    }

    async getHistory(params, context) {
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        return this.voiceCommand.getSearchHistory();
    }

    async clearHistory(params, context) {
        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        this.voiceCommand.clearSearchHistory();
        return [];
    }

    async deleteHistoryItem(params, context) {
        const { id } = params;

        if (!this.voiceCommand) {
            throw new Error('VoiceCommand 模块未初始化');
        }

        this.voiceCommand.deleteSearchHistoryItem(id);
        return this.voiceCommand.getSearchHistory();
    }
}

module.exports = {
    BaseAgent,
    AgentBuilder,
    VoiceCommandAgent,
    ChatAgent,
    MediaControlAgent,
    TTSAgent,
    ReminderAgent,
    DisplayRenderAgent,
    SystemCommandAgent,
    SearchAgent
};
