const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');
const voiceCommand = require('../../core/voiceCommand');

class VoiceCommandActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'voice-command-handler',
      capabilities: [
        {
          id: 'voice-recognition',
          name: '语音识别',
          category: CapabilityCategory.PROFESSIONAL,
          level: CapabilityLevel.L3,
          securityLevel: 0,
          description: '语音命令解析能力'
        },
        {
          id: 'command-parsing',
          name: '命令解析',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '命令解析和处理能力'
        }
      ],
      subscriptions: [MessageTopic.VOICE],
      ...options
    });

    this.voiceCommandCore = voiceCommand;
  }

  async onInit() {
    this.registerHandler(MessageTopic.VOICE, this.handleVoice.bind(this));
    this.registerHandler('voice.command', this.handleCommand.bind(this));
    this.registerHandler('voice.parse', this.handleParse.bind(this));
  }

  async handleVoice(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'command':
        return this.handleCommand(message);
      case 'parse':
        return this.handleParse(message);
      default:
        return this.handleCommand(message);
    }
  }

  async handleCommand(message) {
    const { text, displayId, userId } = message.payload.data || message.payload;
    
    try {
      const result = await this.voiceCommandCore.processVoiceCommand(text, displayId, userId);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleParse(message) {
    const { text } = message.payload.data || message.payload;
    
    try {
      const parsed = this.voiceCommandCore.parseCommand(text);
      return { success: true, data: parsed };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = VoiceCommandActor;
