const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');
const chat = require('../../external/llm/llm-service');

class SystemCommandActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'system-command-handler',
      capabilities: [
        {
          id: 'system-command',
          name: '系统指令',
          category: CapabilityCategory.PROFESSIONAL,
          level: CapabilityLevel.L3,
          securityLevel: 0,
          description: '系统指令处理能力，包括自定义指令配置和指令组合执行'
        },
        {
          id: 'command-config',
          name: '指令配置',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 1,
          description: '自定义指令配置能力'
        },
        {
          id: 'command-execute',
          name: '指令执行',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '指令组合执行能力'
        }
      ],
      subscriptions: [MessageTopic.SYSTEM, 'system.command'],
      ...options
    });

    this.chatCore = chat;
    this.commandHandlers = new Map();
    this._initDefaultHandlers();
  }

  _initDefaultHandlers() {
    this.registerCommandHandler('privateMode', this._handlePrivateMode.bind(this));
    this.registerCommandHandler('groupMode', this._handleGroupMode.bind(this));
    this.registerCommandHandler('showHelp', this._handleShowHelp.bind(this));
    this.registerCommandHandler('commands', this._handleCommands.bind(this));
    this.registerCommandHandler('systemMessage', this._handleSystemMessage.bind(this));
  }

  async onInit() {
    this.registerHandler('system.command', this.handleSystemCommand.bind(this));
    this.registerHandler('system.command.parse', this.handleParse.bind(this));
    this.registerHandler('system.command.execute', this.handleExecute.bind(this));
    this.registerHandler('system.command.config', this.handleConfig.bind(this));
    this.registerHandler('system.command.list', this.handleList.bind(this));
    this.registerHandler('system.command.add', this.handleAdd.bind(this));
    this.registerHandler('system.command.remove', this.handleRemove.bind(this));
  }

  registerCommandHandler(type, handler) {
    this.commandHandlers.set(type, handler);
  }

  async handleSystemCommand(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'parse':
        return this.handleParse(message);
      case 'execute':
        return this.handleExecute(message);
      case 'config':
        return this.handleConfig(message);
      case 'list':
        return this.handleList(message);
      case 'add':
        return this.handleAdd(message);
      case 'remove':
        return this.handleRemove(message);
      default:
        return this.handleParse(message);
    }
  }

  async handleParse(message) {
    const { text } = message.payload.data || message.payload;
    
    if (!text) {
      return { success: false, error: 'Text is required' };
    }

    try {
      const result = this.parseCommand(text);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  parseCommand(text) {
    const trimmedText = text.trim();
    
    if (trimmedText === '系统' || trimmedText === '系统帮助') {
      return { type: 'showHelp' };
    }
    
    if (trimmedText.startsWith('私聊')) {
      const name = trimmedText.substring(2).trim();
      if (name) {
        return { type: 'privateMode', target: name };
      }
      return { type: 'systemMessage', content: '请指定有效的助手名字' };
    }
    
    if (trimmedText === '退出私聊') {
      return { type: 'groupMode' };
    }
    
    const commands = this.chatCore.getCommands();
    for (const [keyword, actions] of Object.entries(commands.commands || {})) {
      if (trimmedText.includes(keyword)) {
        return { type: 'commands', keyword, actions };
      }
    }
    
    return null;
  }

  async handleExecute(message) {
    const { command, displayId, callbacks } = message.payload.data || message.payload;
    
    if (!command) {
      return { success: false, error: 'Command is required' };
    }

    try {
      const handler = this.commandHandlers.get(command.type);
      
      if (handler) {
        const result = await handler(command, displayId, callbacks);
        return { success: true, data: result };
      }
      
      return { success: false, error: `Unknown command type: ${command.type}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleConfig(message) {
    const { commands } = message.payload.data || message.payload;
    
    try {
      const result = this.chatCore.setCommands(commands);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleList(message) {
    try {
      const commands = this.chatCore.getCommands();
      return { success: true, data: commands };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleAdd(message) {
    const { keyword, actions } = message.payload.data || message.payload;
    
    if (!keyword || !actions) {
      return { success: false, error: 'Keyword and actions are required' };
    }

    try {
      const result = this.chatCore.addCommand(keyword, actions);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleRemove(message) {
    const { keyword } = message.payload.data || message.payload;
    
    if (!keyword) {
      return { success: false, error: 'Keyword is required' };
    }

    try {
      const result = this.chatCore.removeCommand(keyword);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async _handlePrivateMode(command, displayId) {
    const { target } = command;
    const session = this.chatCore.setMode('private', target);
    return { type: 'privateMode', target, session };
  }

  async _handleGroupMode(command, displayId) {
    const session = this.chatCore.setMode('group', null);
    return { type: 'groupMode', session };
  }

  async _handleShowHelp(command, displayId) {
    const commands = this.chatCore.getCommands();
    const customCommands = Object.keys(commands.commands || {});
    
    const helpText = this._generateHelpText(customCommands);
    return { type: 'showHelp', helpText };
  }

  _generateHelpText(customCommands) {
    const lines = [
      '系统指令帮助：',
      '- 私聊{助手名字}：与指定助手私聊',
      '- 退出私聊：退出私聊模式',
      '- 系统/系统帮助：显示帮助信息'
    ];
    
    if (customCommands.length > 0) {
      lines.push('- 自定义指令：');
      customCommands.forEach(cmd => {
        lines.push(`  - ${cmd}`);
      });
    }
    
    return lines.join('\n');
  }

  async _handleCommands(command, displayId, callbacks) {
    const { keyword, actions } = command;
    
    const results = [];
    for (const action of actions) {
      if (callbacks && callbacks.onAction) {
        const result = await callbacks.onAction(action, displayId);
        results.push({ action, result });
      }
    }
    
    return { type: 'commands', keyword, actions, results };
  }

  async _handleSystemMessage(command, displayId) {
    const { content } = command;
    return { type: 'systemMessage', content };
  }
}

module.exports = SystemCommandActor;
