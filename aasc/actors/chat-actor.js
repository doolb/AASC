const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');
const chat = require('../../core/chat');

class ChatActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'chat-handler',
      capabilities: [
        {
          id: 'chat',
          name: '聊天能力',
          category: CapabilityCategory.PROFESSIONAL,
          level: CapabilityLevel.L4,
          securityLevel: 1,
          description: 'AI对话生成能力'
        },
        {
          id: 'llm-base',
          name: '语言模型基础',
          category: CapabilityCategory.PROFESSIONAL,
          level: CapabilityLevel.L4,
          securityLevel: 1,
          description: 'AI语言模型基础能力'
        }
      ],
      subscriptions: [MessageTopic.CHAT],
      ...options
    });

    this.chatCore = chat;
  }

  async onInit() {
    this.registerHandler(MessageTopic.CHAT, this.handleChat.bind(this));
    this.registerHandler('chat.send', this.handleSend.bind(this));
    this.registerHandler('chat.history', this.handleHistory.bind(this));
    this.registerHandler('chat.clear', this.handleClear.bind(this));
  }

  async handleChat(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'send':
        return this.handleSend(message);
      case 'history':
        return this.handleHistory(message);
      case 'clear':
        return this.handleClear(message);
      default:
        return this.handleSend(message);
    }
  }

  async handleSend(message) {
    const { text, assistantName, mode } = message.payload.data || message.payload;
    
    try {
      const response = await this.chatCore.sendMessage(text, {
        assistantName,
        mode
      });
      
      return { success: true, data: response };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleHistory(message) {
    const { limit, offset } = message.payload.data || message.payload;
    
    try {
      const history = this.chatCore.getHistory({ limit, offset });
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleClear(message) {
    try {
      this.chatCore.clearHistory();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ChatActor;
