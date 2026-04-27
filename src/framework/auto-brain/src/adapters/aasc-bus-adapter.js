'use strict';

class AASCBusAdapter {
  constructor(options) {
    this.bus = options.bus;
    this.runtimeId = options.runtimeId || 'default';
    this.runtimeMetadata = options.runtimeMetadata || {};

    if (typeof this.bus.registerRuntime === 'function') {
      this.bus.registerRuntime(this.runtimeId, this.runtimeMetadata);
    }
  }

  buildTopic(channel) {
    if (typeof this.bus.buildRuntimeTopic === 'function') {
      return this.bus.buildRuntimeTopic(this.runtimeId, channel);
    }
    return `autobrain.${this.runtimeId}.${channel}`;
  }

  subscribe(channel, handler, subscriberId = 'auto-brain') {
    if (typeof this.bus.subscribeRuntime === 'function') {
      this.bus.subscribeRuntime(this.runtimeId, channel, handler, subscriberId);
      return;
    }
    if (typeof this.bus.subscribeHandler === 'function') {
      this.bus.subscribeHandler(this.buildTopic(channel), `${this.runtimeId}:${subscriberId}`, handler);
      return;
    }
    throw new Error('bus does not support runtime subscribe');
  }

  publish(channel, payload, options = {}) {
    if (typeof this.bus.publishRuntime === 'function') {
      this.bus.publishRuntime(this.runtimeId, channel, payload, options);
      return;
    }
    this.bus.publish({ topic: this.buildTopic(channel), payload });
  }

  close() {
    if (typeof this.bus.unregisterRuntime === 'function') {
      this.bus.unregisterRuntime(this.runtimeId);
    }
  }
}

module.exports = {
  AASCBusAdapter
};
