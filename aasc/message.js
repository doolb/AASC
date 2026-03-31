const { v4: uuidv4 } = require('crypto');

const MessageType = {
  COMMAND: 'command',
  EVENT: 'event',
  QUERY: 'query',
  RESPONSE: 'response',
  BROADCAST: 'broadcast'
};

const Priority = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3
};

const MessageTopic = {
  MEDIA_CONTROL: 'media.control',
  MEDIA_STATUS: 'media.status',
  DISPLAY_CONTROL: 'display.control',
  DISPLAY_STATUS: 'display.status',
  CHAT: 'chat',
  REMINDER: 'reminder',
  SYSTEM: 'system',
  VOICE: 'voice',
  USER_RECORD: 'user.record',
  ACTOR_LIFECYCLE: 'actor.lifecycle'
};

class ActorAddress {
  constructor(ip, role, name) {
    this.ip = ip;
    this.role = role;
    this.name = name;
  }

  toString() {
    return `${this.ip}/${this.role}/${this.name}`;
  }

  static fromString(str) {
    const parts = str.split('/');
    if (parts.length !== 3) {
      throw new Error(`Invalid actor address: ${str}`);
    }
    return new ActorAddress(parts[0], parts[1], parts[2]);
  }

  equals(other) {
    return this.ip === other.ip && 
           this.role === other.role && 
           this.name === other.name;
  }

  toJSON() {
    return {
      ip: this.ip,
      role: this.role,
      name: this.name
    };
  }

  static fromJSON(json) {
    return new ActorAddress(json.ip, json.role, json.name);
  }
}

class Message {
  constructor(options = {}) {
    this.id = options.id || this.generateId();
    this.version = options.version || '1.0';
    this.type = options.type || MessageType.COMMAND;
    this.priority = options.priority !== undefined ? options.priority : Priority.NORMAL;
    this.timestamp = options.timestamp || Date.now();
    this.source = options.source instanceof ActorAddress 
      ? options.source 
      : ActorAddress.fromJSON(options.source);
    this.target = options.target 
      ? (options.target instanceof ActorAddress 
        ? options.target 
        : ActorAddress.fromJSON(options.target))
      : null;
    this.topic = options.topic || null;
    this.payload = options.payload || {};
    this.ttl = options.ttl || 60000;
    this.requiresAck = options.requiresAck || false;
    this.correlationId = options.correlationId || null;
  }

  generateId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  isExpired() {
    return Date.now() > this.timestamp + this.ttl;
  }

  isBroadcast() {
    return this.type === MessageType.BROADCAST || !this.target;
  }

  createResponse(payload) {
    return new Message({
      type: MessageType.RESPONSE,
      source: this.target,
      target: this.source,
      topic: this.topic,
      payload: payload,
      correlationId: this.id
    });
  }

  toJSON() {
    return {
      id: this.id,
      version: this.version,
      type: this.type,
      priority: this.priority,
      timestamp: this.timestamp,
      source: this.source.toJSON(),
      target: this.target ? this.target.toJSON() : null,
      topic: this.topic,
      payload: this.payload,
      ttl: this.ttl,
      requiresAck: this.requiresAck,
      correlationId: this.correlationId
    };
  }

  static fromJSON(json) {
    return new Message({
      id: json.id,
      version: json.version,
      type: json.type,
      priority: json.priority,
      timestamp: json.timestamp,
      source: json.source,
      target: json.target,
      topic: json.topic,
      payload: json.payload,
      ttl: json.ttl,
      requiresAck: json.requiresAck,
      correlationId: json.correlationId
    });
  }
}

module.exports = {
  Message,
  ActorAddress,
  MessageType,
  Priority,
  MessageTopic
};
