const { Message, ActorAddress, MessageType, Priority, MessageTopic } = require('./message');

class MessageBus {
  constructor(options = {}) {
    this.localDeviceId = options.localDeviceId || 'local';
    this.actors = new Map();
    this.subscriptions = new Map();
    this.runtimeRegistry = new Map();
    this.runtimeDeviceIndex = new Map();
    this.deviceTransports = new Map();
    this.messageQueue = [];
    this.isProcessing = false;
    this.handlers = new Map();
    this.stats = {
      totalMessages: 0,
      messagesByType: {},
      messagesByTopic: {},
      messagesByRuntime: {},
      runtimeMessagesByDevice: {}
    };
  }

  registerRuntime(runtimeId, metadata = {}) {
    if (!runtimeId || typeof runtimeId !== 'string') {
      console.warn('[MessageBus] Invalid runtimeId for registerRuntime');
      return false;
    }
    if (this.runtimeRegistry.has(runtimeId)) {
      console.warn(`[MessageBus] Runtime already registered: ${runtimeId}`);
      return false;
    }
    const deviceId = metadata.deviceId || this.localDeviceId;
    this.runtimeRegistry.set(runtimeId, {
      runtimeId,
      metadata: {
        ...metadata,
        deviceId
      },
      status: 'ready',
      registeredAt: Date.now(),
      lastHeartbeat: Date.now()
    });
    this.runtimeDeviceIndex.set(runtimeId, deviceId);
    return true;
  }

  unregisterRuntime(runtimeId) {
    if (!this.runtimeRegistry.has(runtimeId)) {
      return false;
    }

    this.runtimeRegistry.delete(runtimeId);
    this.runtimeDeviceIndex.delete(runtimeId);
    const runtimePrefix = `autobrain.${runtimeId}.`;
    this.subscriptions.forEach((handlers, topic) => {
      if (!topic.startsWith(runtimePrefix)) {
        return;
      }
      this.subscriptions.set(topic, handlers.filter(h => !h.actor.startsWith(`runtime:${runtimeId}:`)));
    });
    return true;
  }

  listRuntimes() {
    return Array.from(this.runtimeRegistry.values());
  }

  registerDeviceTransport(deviceId, transport) {
    if (!deviceId || !transport) {
      return false;
    }
    this.deviceTransports.set(deviceId, transport);
    return true;
  }

  unregisterDeviceTransport(deviceId) {
    return this.deviceTransports.delete(deviceId);
  }

  listDeviceTransports() {
    return Array.from(this.deviceTransports.keys());
  }

  buildRuntimeTopic(runtimeId, channel) {
    if (!runtimeId || !channel) {
      throw new Error('runtimeId and channel are required');
    }
    return `autobrain.${runtimeId}.${channel}`;
  }

  subscribeRuntime(runtimeId, channel, handler, subscriberId = 'anonymous') {
    const topic = this.buildRuntimeTopic(runtimeId, channel);
    const normalizedSubscriberId = this.normalizeSubscriberId(runtimeId, subscriberId);
    this.subscribeHandler(topic, normalizedSubscriberId, handler);
  }

  unsubscribeRuntime(runtimeId, channel, subscriberId = 'anonymous') {
    const topic = this.buildRuntimeTopic(runtimeId, channel);
    const normalizedSubscriberId = this.normalizeSubscriberId(runtimeId, subscriberId);
    this.unsubscribeHandler(topic, normalizedSubscriberId);
  }

  publishRuntime(runtimeId, channel, payload, options = {}) {
    const envelope = {
      runtimeId,
      channel,
      data: payload,
      sourceDeviceId: this.localDeviceId,
      targetRuntimeId: options.targetRuntimeId || null,
      targetDeviceId: options.targetDeviceId || null,
      timestamp: Date.now()
    };

    if (Array.isArray(options.broadcastDevices) && options.broadcastDevices.length > 0) {
      return this.publishRuntimeToDevices(envelope, options.broadcastDevices, options);
    }

    if (envelope.targetRuntimeId) {
      const runtimeDeviceId = this.runtimeDeviceIndex.get(envelope.targetRuntimeId);
      if (runtimeDeviceId && runtimeDeviceId !== this.localDeviceId) {
        return this.forwardRuntimeEnvelope(runtimeDeviceId, envelope);
      }
    }

    if (envelope.targetDeviceId && envelope.targetDeviceId !== this.localDeviceId) {
      return this.forwardRuntimeEnvelope(envelope.targetDeviceId, envelope);
    }

    return this.publishRuntimeEnvelope(envelope, options);
  }

  publishRuntimeToDevices(envelope, broadcastDevices, options = {}) {
    const tasks = broadcastDevices.map(deviceId => {
      const nextEnvelope = {
        ...envelope,
        targetDeviceId: deviceId
      };
      if (deviceId === this.localDeviceId) {
        return this.publishRuntimeEnvelope(nextEnvelope, options);
      }
      return this.forwardRuntimeEnvelope(deviceId, nextEnvelope);
    });
    return Promise.all(tasks);
  }

  publishRuntimeEnvelope(envelope, options = {}) {
    const topic = this.buildRuntimeTopic(envelope.runtimeId, envelope.channel);
    this.updateRuntimeDeviceStats(envelope.runtimeId, this.localDeviceId);
    return this.publish({
      type: options.type || MessageType.EVENT,
      topic,
      payload: {
        runtimeId: envelope.runtimeId,
        channel: envelope.channel,
        data: envelope.data,
        sourceDeviceId: envelope.sourceDeviceId,
        targetDeviceId: envelope.targetDeviceId,
        targetRuntimeId: envelope.targetRuntimeId,
        timestamp: envelope.timestamp
      },
      priority: options.priority,
      ttl: options.ttl,
      source: options.source,
      target: options.target
    });
  }

  async forwardRuntimeEnvelope(targetDeviceId, envelope) {
    const transport = this.deviceTransports.get(targetDeviceId);
    this.updateRuntimeDeviceStats(envelope.runtimeId, targetDeviceId);
    if (!transport) {
      console.warn(`[MessageBus] Missing device transport: ${targetDeviceId}`);
      return null;
    }

    if (typeof transport === 'function') {
      return transport(envelope);
    }

    if (typeof transport.publishRuntimeMessage === 'function') {
      return transport.publishRuntimeMessage(envelope);
    }

    console.warn(`[MessageBus] Invalid device transport: ${targetDeviceId}`);
    return null;
  }

  receiveRemoteRuntimeMessage(envelope) {
    if (!envelope || !envelope.runtimeId || !envelope.channel) {
      return null;
    }

    if (envelope.targetRuntimeId && envelope.targetRuntimeId !== envelope.runtimeId) {
      return null;
    }

    if (envelope.targetDeviceId && envelope.targetDeviceId !== this.localDeviceId) {
      return null;
    }

    return this.publishRuntimeEnvelope({
      runtimeId: envelope.runtimeId,
      channel: envelope.channel,
      data: envelope.data,
      sourceDeviceId: envelope.sourceDeviceId || 'remote',
      targetDeviceId: this.localDeviceId,
      targetRuntimeId: envelope.targetRuntimeId || null,
      timestamp: envelope.timestamp || Date.now()
    });
  }

  normalizeSubscriberId(runtimeId, subscriberId) {
    return `runtime:${runtimeId}:${subscriberId}`;
  }

  subscribeHandler(topic, actorId, handler) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
    const handlers = this.subscriptions.get(topic);
    if (!handlers.find(h => h.actor === actorId)) {
      handlers.push({ actor: actorId, handler });
      console.log(`[MessageBus] Subscribed: ${actorId} -> ${topic}`);
    }
  }

  unsubscribeHandler(topic, actorId) {
    if (!this.subscriptions.has(topic)) {
      return;
    }
    const handlers = this.subscriptions.get(topic);
    const index = handlers.findIndex(h => h.actor === actorId);
    if (index !== -1) {
      handlers.splice(index, 1);
      console.log(`[MessageBus] Unsubscribed: ${actorId} -> ${topic}`);
    }
  }

  register(actor) {
    const address = actor.address.toString();
    if (this.actors.has(address)) {
      console.warn(`[MessageBus] Actor already registered: ${address}`);
      return false;
    }

    this.actors.set(address, {
      address: actor.address,
      capabilities: actor.capabilities || [],
      status: 'ready',
      registeredAt: Date.now(),
      lastHeartbeat: Date.now()
    });

    if (actor.subscriptions) {
      actor.subscriptions.forEach(topic => {
        this.subscribe(topic, actor);
      });
    }

    this.emit(MessageTopic.ACTOR_LIFECYCLE, {
      event: 'registered',
      actor: actor.address.toJSON()
    });

    console.log(`[MessageBus] Actor registered: ${address}`);
    return true;
  }

  unregister(actorAddress) {
    const address = actorAddress.toString();
    if (!this.actors.has(address)) {
      console.warn(`[MessageBus] Actor not found: ${address}`);
      return false;
    }

    this.actors.delete(address);

    this.subscriptions.forEach((handlers, topic) => {
      this.subscriptions.set(topic, handlers.filter(h => h.actor !== address));
    });

    this.emit(MessageTopic.ACTOR_LIFECYCLE, {
      event: 'unregistered',
      actor: actorAddress.toJSON()
    });

    console.log(`[MessageBus] Actor unregistered: ${address}`);
    return true;
  }

  subscribe(topic, actor) {
    const address = actor.address.toString();
    this.subscribeHandler(topic, address, actor.onMessage.bind(actor));
  }

  unsubscribe(topic, actor) {
    const address = actor.address.toString();
    this.unsubscribeHandler(topic, address);
  }

  async publish(message) {
    if (!(message instanceof Message)) {
      message = new Message(message);
    }

    this.updateStats(message);

    if (message.isExpired()) {
      console.warn(`[MessageBus] Message expired: ${message.id}`);
      return;
    }

    if (message.isBroadcast()) {
      await this.broadcast(message);
    } else {
      await this.send(message.target, message);
    }
  }

  async send(target, message) {
    if (!(message instanceof Message)) {
      message = new Message(message);
    }

    const targetAddress = target.toString();
    const actorInfo = this.actors.get(targetAddress);

    if (!actorInfo) {
      console.warn(`[MessageBus] Target actor not found: ${targetAddress}`);
      return null;
    }

    this.updateStats(message);

    const actor = this.getActorInstance(targetAddress);
    if (actor && actor.onMessage) {
      try {
        return await actor.onMessage(message);
      } catch (error) {
        console.error(`[MessageBus] Error sending to ${targetAddress}:`, error);
        return null;
      }
    }

    return null;
  }

  async broadcast(message) {
    if (!(message instanceof Message)) {
      message = new Message(message);
    }

    const topic = message.topic;
    const results = [];

    if (topic && this.subscriptions.has(topic)) {
      const handlers = this.subscriptions.get(topic);
      for (const { actor, handler } of handlers) {
        try {
          const result = await handler(message);
          if (result !== undefined) {
            results.push({ actor, result });
          }
        } catch (error) {
          console.error(`[MessageBus] Error in broadcast to ${actor}:`, error);
        }
      }
    }

    return results;
  }

  emit(topic, payload) {
    const message = new Message({
      type: MessageType.EVENT,
      topic: topic,
      payload: payload
    });
    return this.broadcast(message);
  }

  getActorInstance(address) {
    return this.actorInstances ? this.actorInstances.get(address) : null;
  }

  setActorInstance(address, instance) {
    if (!this.actorInstances) {
      this.actorInstances = new Map();
    }
    this.actorInstances.set(address, instance);
  }

  getActors() {
    return Array.from(this.actors.values());
  }

  getActor(address) {
    return this.actors.get(address.toString());
  }

  getActorsByRole(role) {
    return this.getActors().filter(a => a.address.role === role);
  }

  getActorsByCapability(capabilityId) {
    return this.getActors().filter(a => 
      a.capabilities.some(c => c.id === capabilityId)
    );
  }

  updateHeartbeat(actorAddress) {
    const actor = this.actors.get(actorAddress.toString());
    if (actor) {
      actor.lastHeartbeat = Date.now();
      actor.status = 'ready';
    }
  }

  checkHealth(timeout = 30000) {
    const now = Date.now();
    const unhealthy = [];

    this.actors.forEach((actor, address) => {
      if (now - actor.lastHeartbeat > timeout) {
        actor.status = 'degraded';
        unhealthy.push(address);
      }
    });

    return unhealthy;
  }

  updateStats(message) {
    this.stats.totalMessages++;
    
    if (!this.stats.messagesByType[message.type]) {
      this.stats.messagesByType[message.type] = 0;
    }
    this.stats.messagesByType[message.type]++;

    if (message.topic) {
      if (!this.stats.messagesByTopic[message.topic]) {
        this.stats.messagesByTopic[message.topic] = 0;
      }
      this.stats.messagesByTopic[message.topic]++;

      const runtimeId = this.extractRuntimeId(message.topic);
      if (runtimeId) {
        if (!this.stats.messagesByRuntime[runtimeId]) {
          this.stats.messagesByRuntime[runtimeId] = 0;
        }
        this.stats.messagesByRuntime[runtimeId]++;
      }
    }
  }

  extractRuntimeId(topic) {
    if (!topic || !topic.startsWith('autobrain.')) {
      return null;
    }
    const parts = topic.split('.');
    if (parts.length < 3) {
      return null;
    }
    return parts[1] || null;
  }

  updateRuntimeDeviceStats(runtimeId, deviceId) {
    if (!runtimeId || !deviceId) {
      return;
    }
    if (!this.stats.runtimeMessagesByDevice[runtimeId]) {
      this.stats.runtimeMessagesByDevice[runtimeId] = {};
    }
    if (!this.stats.runtimeMessagesByDevice[runtimeId][deviceId]) {
      this.stats.runtimeMessagesByDevice[runtimeId][deviceId] = 0;
    }
    this.stats.runtimeMessagesByDevice[runtimeId][deviceId] += 1;
  }

  getStats() {
    return {
      ...this.stats,
      actorCount: this.actors.size,
      topicCount: this.subscriptions.size,
      runtimeCount: this.runtimeRegistry.size,
      deviceTransportCount: this.deviceTransports.size,
      localDeviceId: this.localDeviceId
    };
  }
}

const globalBus = new MessageBus();

function getBus() {
  return globalBus;
}

module.exports = {
  MessageBus,
  getBus,
  Message,
  ActorAddress,
  MessageType,
  Priority,
  MessageTopic
};
