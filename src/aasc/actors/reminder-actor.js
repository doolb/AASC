const { Actor, ActorStatus, CapabilityCategory } = require('../actor');
const { MessageTopic, MessageType } = require('../message');
const { CapabilityLevel } = require('../registry');
const reminder = require('../../apps/web-mediacenter/modules/reminder/reminder-app-service');

class ReminderActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'reminder-handler',
      capabilities: [
        {
          id: 'reminder',
          name: '提醒管理',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '定时提醒功能'
        }
      ],
      subscriptions: [MessageTopic.REMINDER],
      ...options
    });

    this.reminderCore = reminder;
  }

  async onInit() {
    this.registerHandler(MessageTopic.REMINDER, this.handleReminder.bind(this));
    this.registerHandler('reminder.add', this.handleAdd.bind(this));
    this.registerHandler('reminder.remove', this.handleRemove.bind(this));
    this.registerHandler('reminder.list', this.handleList.bind(this));
    this.registerHandler('reminder.query', this.handleQuery.bind(this));
  }

  async handleReminder(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'add':
        return this.handleAdd(message);
      case 'remove':
        return this.handleRemove(message);
      case 'list':
        return this.handleList(message);
      case 'query':
        return this.handleQuery(message);
      default:
        return { error: `Unknown action: ${action}` };
    }
  }

  async handleAdd(message) {
    const { time, content, repeat } = message.payload.data || message.payload;
    
    try {
      const result = await this.reminderCore.add({
        time,
        content,
        repeat
      });
      
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleRemove(message) {
    const { id } = message.payload.data || message.payload;
    
    try {
      const result = this.reminderCore.remove(id);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleList(message) {
    try {
      const list = this.reminderCore.getAll();
      return { success: true, data: list };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleQuery(message) {
    const { filter } = message.payload.data || message.payload;
    
    try {
      const list = this.reminderCore.query(filter);
      return { success: true, data: list };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ReminderActor;
