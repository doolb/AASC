const fs = require('fs');
const path = require('path');

const RecordType = {
  EVENT: 'event',
  CONVERSATION: 'conversation',
  TASK: 'task',
  NOTE: 'note',
  REMINDER: 'reminder'
};

const RecordSource = {
  VOICE: 'voice',
  TEXT: 'text',
  SYSTEM: 'system',
  IMPORT: 'import'
};

const ImportanceLevel = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4
};

class UserRecord {
  constructor(options = {}) {
    this.id = options.id || this.generateId();
    this.userId = options.userId || '';
    this.type = options.type || RecordType.NOTE;
    this.content = options.content || '';
    this.source = options.source || RecordSource.TEXT;
    this.timestamp = options.timestamp || Date.now();
    this.tags = options.tags || [];
    this.metadata = options.metadata || {
      location: null,
      relatedActors: [],
      importance: ImportanceLevel.NORMAL
    };
  }

  generateId() {
    return `rec_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  removeTag(tag) {
    const index = this.tags.indexOf(tag);
    if (index !== -1) {
      this.tags.splice(index, 1);
    }
  }

  setImportance(level) {
    this.metadata.importance = level;
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      type: this.type,
      content: this.content,
      source: this.source,
      timestamp: this.timestamp,
      tags: this.tags,
      metadata: this.metadata
    };
  }

  static fromJSON(json) {
    return new UserRecord(json);
  }
}

class UserRecordStore {
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(__dirname, '../config/records');
    this.records = new Map();
    this.userIndex = new Map();
  }

  init() {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
    this.loadAll();
  }

  loadAll() {
    try {
      const files = fs.readdirSync(this.basePath).filter(f => f.endsWith('.json'));
      this.records.clear();
      this.userIndex.clear();

      for (const file of files) {
        const filePath = path.join(this.basePath, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        for (const recordData of data.records || []) {
          const record = UserRecord.fromJSON(recordData);
          this.records.set(record.id, record);

          if (!this.userIndex.has(record.userId)) {
            this.userIndex.set(record.userId, new Set());
          }
          this.userIndex.get(record.userId).add(record.id);
        }
      }
      console.log(`[UserRecordStore] Loaded ${this.records.size} records`);
    } catch (err) {
      console.error('[UserRecordStore] Load failed:', err.message);
    }
  }

  saveUserRecords(userId) {
    try {
      const recordIds = this.userIndex.get(userId);
      if (!recordIds) return;

      const userRecords = Array.from(recordIds)
        .map(id => this.records.get(id))
        .filter(Boolean)
        .map(r => r.toJSON());

      const filePath = path.join(this.basePath, `${userId}.json`);
      const data = {
        userId,
        records: userRecords,
        savedAt: Date.now()
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`[UserRecordStore] Save failed for user ${userId}:`, err.message);
    }
  }

  save(record) {
    if (!(record instanceof UserRecord)) {
      record = new UserRecord(record);
    }

    this.records.set(record.id, record);

    if (!this.userIndex.has(record.userId)) {
      this.userIndex.set(record.userId, new Set());
    }
    this.userIndex.get(record.userId).add(record.id);

    this.saveUserRecords(record.userId);
    return record;
  }

  get(recordId) {
    return this.records.get(recordId);
  }

  query(userId, filter = {}) {
    const recordIds = this.userIndex.get(userId);
    if (!recordIds) return [];

    let results = Array.from(recordIds)
      .map(id => this.records.get(id))
      .filter(Boolean);

    if (filter.type) {
      results = results.filter(r => r.type === filter.type);
    }
    if (filter.startDate) {
      results = results.filter(r => r.timestamp >= filter.startDate);
    }
    if (filter.endDate) {
      results = results.filter(r => r.timestamp <= filter.endDate);
    }
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(r => 
        filter.tags.some(tag => r.tags.includes(tag))
      );
    }
    if (filter.keywords) {
      const kw = filter.keywords.toLowerCase();
      results = results.filter(r => 
        r.content.toLowerCase().includes(kw) ||
        r.tags.some(t => t.toLowerCase().includes(kw))
      );
    }
    if (filter.importance) {
      results = results.filter(r => r.metadata.importance >= filter.importance);
    }
    if (filter.source) {
      results = results.filter(r => r.source === filter.source);
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  delete(recordId) {
    const record = this.records.get(recordId);
    if (!record) return false;

    this.records.delete(recordId);

    const userRecords = this.userIndex.get(record.userId);
    if (userRecords) {
      userRecords.delete(recordId);
    }

    this.saveUserRecords(record.userId);
    return true;
  }

  deleteByUser(userId) {
    const recordIds = this.userIndex.get(userId);
    if (!recordIds) return 0;

    const count = recordIds.size;
    for (const id of recordIds) {
      this.records.delete(id);
    }
    this.userIndex.delete(userId);

    const filePath = path.join(this.basePath, `${userId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return count;
  }

  export(userId, format = 'json') {
    const records = this.query(userId);
    
    if (format === 'csv') {
      const headers = ['id', 'type', 'content', 'source', 'timestamp', 'tags', 'importance'];
      const rows = records.map(r => [
        r.id,
        r.type,
        `"${r.content.replace(/"/g, '""')}"`,
        r.source,
        new Date(r.timestamp).toISOString(),
        r.tags.join(';'),
        r.metadata.importance
      ]);
      return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    return JSON.stringify(records.map(r => r.toJSON()), null, 2);
  }

  getStats(userId) {
    const records = this.query(userId);
    const stats = {
      total: records.length,
      byType: {},
      bySource: {},
      byImportance: {},
      tags: {}
    };

    for (const record of records) {
      stats.byType[record.type] = (stats.byType[record.type] || 0) + 1;
      stats.bySource[record.source] = (stats.bySource[record.source] || 0) + 1;
      stats.byImportance[record.metadata.importance] = 
        (stats.byImportance[record.metadata.importance] || 0) + 1;
      
      for (const tag of record.tags) {
        stats.tags[tag] = (stats.tags[tag] || 0) + 1;
      }
    }

    return stats;
  }
}

class RecordCommandParser {
  static parse(text) {
    const trimmed = text.trim();

    if (trimmed.startsWith('系统记录对话')) {
      return {
        type: RecordType.CONVERSATION,
        content: trimmed.replace('系统记录对话', '').trim()
      };
    }

    if (trimmed.startsWith('系统记录任务')) {
      return {
        type: RecordType.TASK,
        content: trimmed.replace('系统记录任务', '').trim()
      };
    }

    if (trimmed.startsWith('系统记录事件')) {
      return {
        type: RecordType.EVENT,
        content: trimmed.replace('系统记录事件', '').trim()
      };
    }

    if (trimmed.startsWith('系统记录')) {
      return {
        type: RecordType.NOTE,
        content: trimmed.replace('系统记录', '').trim()
      };
    }

    if (trimmed === '系统查询记录') {
      return {
        type: 'query',
        content: ''
      };
    }

    if (trimmed.startsWith('系统查询记录')) {
      return {
        type: 'query',
        content: trimmed.replace('系统查询记录', '').trim()
      };
    }

    return null;
  }

  static extractTags(content) {
    const tags = [];
    const tagPattern = /#(\S+)/g;
    let match;
    while ((match = tagPattern.exec(content)) !== null) {
      tags.push(match[1]);
    }
    return tags;
  }

  static determineImportance(content) {
    const criticalWords = ['紧急', '重要', '关键', '紧急'];
    const highWords = ['优先', '尽快', '注意'];

    for (const word of criticalWords) {
      if (content.includes(word)) {
        return ImportanceLevel.CRITICAL;
      }
    }

    for (const word of highWords) {
      if (content.includes(word)) {
        return ImportanceLevel.HIGH;
      }
    }

    return ImportanceLevel.NORMAL;
  }
}

module.exports = {
  UserRecord,
  UserRecordStore,
  RecordCommandParser,
  RecordType,
  RecordSource,
  ImportanceLevel
};
