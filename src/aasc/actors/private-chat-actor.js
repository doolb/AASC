const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');
const chat = require('../../external/llm/llm-service');

class PrivateChatActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'private-chat-handler',
      capabilities: [
        {
          id: 'private-chat',
          name: '私聊模式',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '私聊模式切换能力，支持群聊和私聊模式切换'
        },
        {
          id: 'chat-mode',
          name: '聊天模式管理',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '聊天模式管理能力'
        }
      ],
      subscriptions: [MessageTopic.CHAT, 'chat.mode'],
      ...options
    });

    this.chatCore = chat;
    this.assistants = options.assistants || [];
  }

  setAssistants(assistants) {
    this.assistants = assistants || [];
  }

  async onInit() {
    this.registerHandler('chat.mode', this.handleMode.bind(this));
    this.registerHandler('chat.mode.get', this.handleGetMode.bind(this));
    this.registerHandler('chat.mode.set', this.handleSetMode.bind(this));
    this.registerHandler('chat.mode.private', this.handlePrivateMode.bind(this));
    this.registerHandler('chat.mode.group', this.handleGroupMode.bind(this));
    this.registerHandler('chat.mode.toggle', this.handleToggleMode.bind(this));
    this.registerHandler('chat.assistants', this.handleAssistants.bind(this));
  }

  async handleMode(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'get':
        return this.handleGetMode(message);
      case 'set':
        return this.handleSetMode(message);
      case 'private':
        return this.handlePrivateMode(message);
      case 'group':
        return this.handleGroupMode(message);
      case 'toggle':
        return this.handleToggleMode(message);
      case 'assistants':
        return this.handleAssistants(message);
      default:
        return this.handleGetMode(message);
    }
  }

  async handleGetMode(message) {
    try {
      const session = this.chatCore.getSession();
      return { 
        success: true, 
        data: {
          mode: session.mode,
          privateTarget: session.privateTarget,
          playOnControl: session.playOnControl
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleSetMode(message) {
    const { mode, privateTarget, playOnControl } = message.payload.data || message.payload;
    
    try {
      const updates = {};
      if (mode !== undefined) updates.mode = mode;
      if (privateTarget !== undefined) updates.privateTarget = privateTarget;
      if (playOnControl !== undefined) updates.playOnControl = playOnControl;
      
      const session = this.chatCore.setSession(updates);
      return { 
        success: true, 
        data: {
          mode: session.mode,
          privateTarget: session.privateTarget,
          playOnControl: session.playOnControl
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handlePrivateMode(message) {
    const { target } = message.payload.data || message.payload;
    
    if (!target) {
      return { success: false, error: 'Target assistant name is required' };
    }

    const assistant = this._findAssistant(target);
    if (!assistant) {
      return { success: false, error: `Assistant not found: ${target}` };
    }

    try {
      const session = this.chatCore.setMode('private', target);
      return { 
        success: true, 
        data: {
          mode: 'private',
          privateTarget: target,
          assistant: assistant
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleGroupMode(message) {
    try {
      const session = this.chatCore.setMode('group', null);
      return { 
        success: true, 
        data: {
          mode: 'group',
          privateTarget: null
        }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleToggleMode(message) {
    try {
      const currentSession = this.chatCore.getSession();
      
      if (currentSession.mode === 'private') {
        const session = this.chatCore.setMode('group', null);
        return { 
          success: true, 
          data: {
            mode: 'group',
            privateTarget: null
          }
        };
      } else {
        const defaultAssistant = this.assistants[0];
        if (!defaultAssistant) {
          return { success: false, error: 'No assistant available for private chat' };
        }
        
        const session = this.chatCore.setMode('private', defaultAssistant.name);
        return { 
          success: true, 
          data: {
            mode: 'private',
            privateTarget: defaultAssistant.name,
            assistant: defaultAssistant
          }
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleAssistants(message) {
    const { action } = message.payload || {};
    
    if (action === 'list') {
      return { 
        success: true, 
        data: {
          assistants: this.assistants,
          defaultName: this.assistants[0]?.name || null
        }
      };
    }
    
    return { 
      success: true, 
      data: {
        assistants: this.assistants,
        defaultName: this.assistants[0]?.name || null
      }
    };
  }

  _findAssistant(name) {
    return this.assistants.find(a => a.name === name);
  }

  isPrivateMode() {
    const session = this.chatCore.getSession();
    return session.mode === 'private';
  }

  getPrivateTarget() {
    const session = this.chatCore.getSession();
    return session.privateTarget;
  }
}

module.exports = PrivateChatActor;
