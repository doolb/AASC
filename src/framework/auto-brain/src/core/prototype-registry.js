'use strict';

class PrototypeRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(key, handler) {
    if (!key || typeof handler !== 'function') {
      throw new Error('invalid prototype registration');
    }
    this.handlers.set(key, handler);
  }

  get(key) {
    return this.handlers.get(key);
  }

  has(key) {
    return this.handlers.has(key);
  }
}

module.exports = {
  PrototypeRegistry
};
