const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');
const tts = require('../../external/tts/tts-service');
const path = require('path');

class TTSActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'tts-handler',
      capabilities: [
        {
          id: 'tts',
          name: '语音合成',
          category: CapabilityCategory.PROFESSIONAL,
          level: CapabilityLevel.L3,
          securityLevel: 0,
          description: '文字转语音能力，支持多种语音和语速'
        },
        {
          id: 'voice-broadcast',
          name: '语音播报',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '语音播报能力，支持显示端和控制端播报'
        }
      ],
      subscriptions: [MessageTopic.VOICE, 'tts'],
      ...options
    });

    this.ttsCore = tts;
    this.displayClients = options.displayClients || null;
    this.sendToDisplay = options.sendToDisplay || null;
    this.broadcastToControls = options.broadcastToControls || null;
  }

  setClients(clients, sendFunc, broadcastFunc) {
    this.displayClients = clients;
    this.sendToDisplay = sendFunc;
    this.broadcastToControls = broadcastFunc;
  }

  async onInit() {
    this.registerHandler('tts', this.handleTTS.bind(this));
    this.registerHandler('tts.generate', this.handleGenerate.bind(this));
    this.registerHandler('tts.broadcast', this.handleBroadcast.bind(this));
    this.registerHandler('tts.play', this.handlePlay.bind(this));
    this.registerHandler('tts.config', this.handleConfig.bind(this));
    this.registerHandler('tts.cleanup', this.handleCleanup.bind(this));
  }

  async handleTTS(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'generate':
        return this.handleGenerate(message);
      case 'broadcast':
        return this.handleBroadcast(message);
      case 'play':
        return this.handlePlay(message);
      case 'config':
        return this.handleConfig(message);
      case 'cleanup':
        return this.handleCleanup(message);
      default:
        return this.handleGenerate(message);
    }
  }

  async handleGenerate(message) {
    const { text, voice, speed } = message.payload.data || message.payload;
    
    if (!text) {
      return { success: false, error: 'Text is required' };
    }

    try {
      const audioPath = await this.ttsCore.generateTTS(text, voice, speed);
      const fileName = path.basename(audioPath);
      const audioUrl = `/uploads/tts/${fileName}`;
      
      return { 
        success: true, 
        data: {
          text: text,
          audioPath: audioPath,
          audioUrl: audioUrl,
          fileName: fileName
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleBroadcast(message) {
    const { text, voice, speed, displayId, showText } = message.payload.data || message.payload;
    
    if (!text) {
      return { success: false, error: 'Text is required' };
    }

    try {
      const audioPath = await this.ttsCore.generateTTS(text, voice, speed);
      const fileName = path.basename(audioPath);
      const audioUrl = `/uploads/tts/${fileName}`;
      
      if (displayId && this.sendToDisplay) {
        this.sendToDisplay(displayId, {
          type: 'tts',
          action: 'playAudio',
          audioUrl: audioUrl,
          text: showText !== false ? text : undefined
        });
      }
      
      if (this.broadcastToControls) {
        this.broadcastToControls({
          type: 'tts',
          action: 'broadcast',
          audioUrl: audioUrl,
          text: text,
          displayId: displayId
        });
      }
      
      return { 
        success: true, 
        data: {
          text: text,
          audioUrl: audioUrl,
          displayId: displayId
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handlePlay(message) {
    const { text, voice, speed, displayId, showText } = message.payload.data || message.payload;
    
    if (!text) {
      return { success: false, error: 'Text is required' };
    }

    if (!displayId) {
      return { success: false, error: 'Display ID is required' };
    }

    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      const audioPath = await this.ttsCore.generateTTS(text, voice, speed);
      const fileName = path.basename(audioPath);
      const audioUrl = `/uploads/tts/${fileName}`;
      
      this.sendToDisplay(displayId, {
        type: 'tts',
        action: 'playAudio',
        audioUrl: audioUrl,
        text: showText !== false ? text : undefined
      });
      
      return { 
        success: true, 
        data: {
          text: text,
          audioUrl: audioUrl,
          displayId: displayId
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleConfig(message) {
    const { action } = message.payload || {};
    
    if (action === 'get') {
      try {
        const config = this.ttsCore.getConfig();
        return { success: true, data: config };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    
    const { serviceUrl, defaultVoice, defaultSpeed } = message.payload.data || message.payload;
    
    try {
      const config = {};
      if (serviceUrl !== undefined) config.serviceUrl = serviceUrl;
      if (defaultVoice !== undefined) config.defaultVoice = defaultVoice;
      if (defaultSpeed !== undefined) config.defaultSpeed = defaultSpeed;
      
      this.ttsCore.init(config);
      
      const newConfig = this.ttsCore.getConfig();
      return { success: true, data: newConfig };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleCleanup(message) {
    try {
      this.ttsCore.cleanupOldTtsFiles();
      return { success: true, data: { cleaned: true } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async generateAndPlay(text, displayId, options = {}) {
    const { voice, speed, showText } = options;
    
    if (!this.sendToDisplay) {
      throw new Error('Display clients not configured');
    }

    const audioPath = await this.ttsCore.generateTTS(text, voice, speed);
    const fileName = path.basename(audioPath);
    const audioUrl = `/uploads/tts/${fileName}`;
    
    this.sendToDisplay(displayId, {
      type: 'tts',
      action: 'playAudio',
      audioUrl: audioUrl,
      text: showText !== false ? text : undefined
    });
    
    return { audioUrl, fileName };
  }
}

module.exports = TTSActor;
