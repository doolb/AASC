const { Message, ActorAddress, MessageType, Priority, MessageTopic } = require('./message');

class MessageBus {
  constructor() {
    this.actors = new Map();
    this.subscriptions = new Map();
    this.messageQueue = [];
    this.isProcessing = false;
    this.handlers = new Map();
    this.stats = {
      totalMessages: 0,
      messagesByType: {},
      messagesByTopic: {}
    };
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
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }

    const address = actor.address.toString();
    const handlers = this.subscriptions.get(topic);
    
    if (!handlers.find(h => h.actor === address)) {
      handlers.push({
        actor: address,
        handler: actor.onMessage.bind(actor)
      });
      console.log(`[MessageBus] Subscribed: ${address} -> ${topic}`);
    }
  }

  unsubscribe(topic, actor) {
    if (!this.subscriptions.has(topic)) {
      return;
    }

    const address = actor.address.toString();
    const handlers = this.subscriptions.get(topic);
    const index = handlers.findIndex(h => h.actor === address);
    
    if (index !== -1) {
      handlers.splice(index, 1);
      console.log(`[MessageBus] Unsubscribed: ${address} -> ${topic}`);
    }
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
    }
  }

  getStats() {
    return {
      ...this.stats,
      actorCount: this.actors.size,
      topicCount: this.subscriptions.size
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
