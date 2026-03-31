const { Message, ActorAddress, MessageType, MessageTopic } = require('./message');

const ActorStatus = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  BUSY: 'busy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline'
};

const CapabilityCategory = {
  BASIC: 'basic',
  PROFESSIONAL: 'professional',
  SPECIAL: 'special'
};

class Actor {
  constructor(options = {}) {
    this.address = new ActorAddress(
      options.ip || '127.0.0.1',
      options.role || 'server',
      options.name || 'unnamed'
    );
    
    this.capabilities = options.capabilities || [];
    this.subscriptions = options.subscriptions || [];
    this.status = ActorStatus.INITIALIZING;
    this.bus = options.bus || null;
    this.filter = options.filter || {};
    this.config = options.config || {};
    this.metadata = {
      version: options.version || '1.0.0',
      platform: options.platform || 'node',
      resources: options.resources || {}
    };
    
    this.handlers = new Map();
    this._heartbeatInterval = null;
  }

  async init() {
    this.status = ActorStatus.INITIALIZING;
    
    try {
      await this.onInit();
      
      if (this.bus) {
        this.bus.register(this);
        this.bus.setActorInstance(this.address.toString(), this);
      }
      
      this.status = ActorStatus.READY;
      this.startHeartbeat();
      
      console.log(`[Actor] Initialized: ${this.address.toString()}`);
      return true;
    } catch (error) {
      this.status = ActorStatus.OFFLINE;
      console.error(`[Actor] Init failed: ${this.address.toString()}`, error);
      return false;
    }
  }

  async onInit() {
  }

  async destroy() {
    this.stopHeartbeat();
    
    if (this.bus) {
      this.bus.unregister(this.address);
    }
    
    await this.onDestroy();
    this.status = ActorStatus.OFFLINE;
    
    console.log(`[Actor] Destroyed: ${this.address.toString()}`);
  }

  async onDestroy() {
  }

  startHeartbeat(interval = 10000) {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
    }
    
    this._heartbeatInterval = setInterval(() => {
      if (this.bus) {
        this.bus.updateHeartbeat(this.address);
      }
    }, interval);
  }

  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  shouldProcess(message) {
    if (this.filter.topics && !this.filter.topics.includes(message.topic)) {
      return false;
    }
    
    if (this.filter.types && !this.filter.types.includes(message.type)) {
      return false;
    }
    
    if (this.filter.sources) {
      const match = this.filter.sources.some(s => 
        message.source.ip === s.ip ||
        message.source.role === s.role ||
        message.source.name === s.name
      );
      if (!match) return false;
    }
    
    if (this.filter.custom) {
      return this.filter.custom(message);
    }
    
    return true;
  }

  async onMessage(message) {
    if (!this.shouldProcess(message)) {
      return;
    }

    if (message.isExpired()) {
      return;
    }

    const handler = this.handlers.get(message.topic) || this.handlers.get('*');
    
    if (handler) {
      try {
        this.status = ActorStatus.BUSY;
        const result = await handler.call(this, message);
        this.status = ActorStatus.READY;
        return result;
      } catch (error) {
        this.status = ActorStatus.DEGRADED;
        console.error(`[Actor] Handler error: ${this.address.toString()}`, error);
        return null;
      }
    }

    return this.handleMessage(message);
  }

  async handleMessage(message) {
    return null;
  }

  registerHandler(topic, handler) {
    this.handlers.set(topic, handler);
  }

  unregisterHandler(topic) {
    this.handlers.delete(topic);
  }

  async send(target, payload, options = {}) {
    if (!this.bus) {
      console.warn(`[Actor] No bus configured: ${this.address.toString()}`);
      return null;
    }

    const message = new Message({
      type: options.type || MessageType.COMMAND,
      topic: options.topic,
      source: this.address,
      target: target,
      payload: payload,
      priority: options.priority,
      requiresAck: options.requiresAck
    });

    return this.bus.send(target, message);
  }

  async publish(topic, payload, options = {}) {
    if (!this.bus) {
      console.warn(`[Actor] No bus configured: ${this.address.toString()}`);
      return;
    }

    const message = new Message({
      type: options.type || MessageType.EVENT,
      topic: topic,
      source: this.address,
      payload: payload,
      priority: options.priority
    });

    return this.bus.publish(message);
  }

  async broadcast(payload, options = {}) {
    if (!this.bus) {
      console.warn(`[Actor] No bus configured: ${this.address.toString()}`);
      return;
    }

    const message = new Message({
      type: MessageType.BROADCAST,
      source: this.address,
      payload: payload,
      topic: options.topic,
      priority: options.priority
    });

    return this.bus.broadcast(message);
  }

  hasCapability(capabilityId) {
    return this.capabilities.some(c => c.id === capabilityId);
  }

  getCapability(capabilityId) {
    return this.capabilities.find(c => c.id === capabilityId);
  }

  getInfo() {
    return {
      address: this.address.toJSON(),
      capabilities: this.capabilities,
      status: this.status,
      metadata: this.metadata
    };
  }
}

class ActorBuilder {
  constructor() {
    this.options = {};
  }

  withAddress(ip, role, name) {
    this.options.ip = ip;
    this.options.role = role;
    this.options.name = name;
    return this;
  }

  withCapabilities(capabilities) {
    this.options.capabilities = capabilities;
    return this;
  }

  withSubscriptions(topics) {
    this.options.subscriptions = topics;
    return this;
  }

  withFilter(filter) {
    this.options.filter = filter;
    return this;
  }

  withBus(bus) {
    this.options.bus = bus;
    return this;
  }

  withConfig(config) {
    this.options.config = config;
    return this;
  }

  build() {
    return new Actor(this.options);
  }
}

module.exports = {
  Actor,
  ActorBuilder,
  ActorStatus,
  CapabilityCategory
};
