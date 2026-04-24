const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');
const chat = require('../../external/llm/llm-service');

class ImportantRecordActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'important-record-handler',
      capabilities: [
        {
          id: 'important-record',
          name: '重要记录',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 1,
          description: '重要记录管理能力，支持记录的添加、查询、删除'
        },
        {
          id: 'record-storage',
          name: '记录存储',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 1,
          description: '记录持久化存储能力'
        }
      ],
      subscriptions: [MessageTopic.USER_RECORD, 'record.important'],
      ...options
    });

    this.chatCore = chat;
  }

  async onInit() {
    this.registerHandler('record.important', this.handleRecord.bind(this));
    this.registerHandler('record.important.add', this.handleAdd.bind(this));
    this.registerHandler('record.important.get', this.handleGet.bind(this));
    this.registerHandler('record.important.list', this.handleList.bind(this));
    this.registerHandler('record.important.query', this.handleQuery.bind(this));
    this.registerHandler('record.important.delete', this.handleDelete.bind(this));
    this.registerHandler('record.important.clear', this.handleClear.bind(this));
  }

  async handleRecord(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'add':
        return this.handleAdd(message);
      case 'get':
        return this.handleGet(message);
      case 'list':
        return this.handleList(message);
      case 'query':
        return this.handleQuery(message);
      case 'delete':
        return this.handleDelete(message);
      case 'clear':
        return this.handleClear(message);
      default:
        return this.handleList(message);
    }
  }

  async handleAdd(message) {
    const { content, role, name, tags, importance } = message.payload.data || message.payload;
    
    if (!content) {
      return { success: false, error: 'Content is required' };
    }

    try {
      const record = this.chatCore.addImportantRecord(content, role || 'user', name || '');
      
      if (tags && Array.isArray(tags)) {
        record.tags = tags;
      }
      
      if (importance !== undefined) {
        record.importance = importance;
      }
      
      return { 
        success: true, 
        data: record 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleGet(message) {
    const { id } = message.payload.data || message.payload;
    
    if (!id) {
      return { success: false, error: 'Record ID is required' };
    }

    try {
      const records = this.chatCore.getImportantRecords();
      const record = records.find(r => r.id === id);
      
      if (!record) {
        return { success: false, error: `Record not found: ${id}` };
      }
      
      return { success: true, data: record };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleList(message) {
    try {
      const records = this.chatCore.getImportantRecords();
      return { success: true, data: records };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleQuery(message) {
    const { keyword, startDate, endDate, tags, limit } = message.payload.data || message.payload;
    
    try {
      let records = this.chatCore.getImportantRecords();
      
      if (keyword) {
        const keywordLower = keyword.toLowerCase();
        records = records.filter(r => 
          r.content.toLowerCase().includes(keywordLower)
        );
      }
      
      if (startDate) {
        const start = new Date(startDate).getTime();
        records = records.filter(r => r.timestamp >= start);
      }
      
      if (endDate) {
        const end = new Date(endDate).getTime();
        records = records.filter(r => r.timestamp <= end);
      }
      
      if (tags && Array.isArray(tags) && tags.length > 0) {
        records = records.filter(r => 
          r.tags && tags.some(t => r.tags.includes(t))
        );
      }
      
      if (limit && limit > 0) {
        records = records.slice(0, limit);
      }
      
      return { 
        success: true, 
        data: records,
        total: records.length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleDelete(message) {
    const { id } = message.payload.data || message.payload;
    
    if (!id) {
      return { success: false, error: 'Record ID is required' };
    }

    try {
      const records = this.chatCore.getImportantRecords();
      const index = records.findIndex(r => r.id === id);
      
      if (index === -1) {
        return { success: false, error: `Record not found: ${id}` };
      }
      
      records.splice(index, 1);
      
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleClear(message) {
    try {
      const records = this.chatCore.getImportantRecords();
      records.length = 0;
      
      return { success: true, data: { cleared: true } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  parseRecordCommand(text) {
    const trimmedText = text.trim();
    
    if (trimmedText.startsWith('系统记录')) {
      const content = trimmedText.replace('系统记录', '').trim();
      if (content) {
        return {
          type: 'add',
          content: content
        };
      }
    }
    
    if (trimmedText === '系统查询记录') {
      return {
        type: 'list'
      };
    }
    
    if (trimmedText.startsWith('系统查询记录')) {
      const keyword = trimmedText.replace('系统查询记录', '').trim();
      return {
        type: 'query',
        keyword: keyword
      };
    }
    
    return null;
  }
}

module.exports = ImportantRecordActor;
