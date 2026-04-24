'use strict';

class ActionDispatcher {
  constructor() {
    this.idempotencySet = new Set();
    this.handlers = new Map();
  }

  registerHandler(actionType, handler) {
    if (!actionType || typeof handler !== 'function') {
      throw new Error('invalid action handler');
    }
    this.handlers.set(actionType, handler);
  }

  async commit(action) {
    const start = Date.now();
    if (this.idempotencySet.has(action.idempotencyKey)) {
      return {
        actionId: action.actionId,
        success: true,
        latencyMs: Date.now() - start,
        reason: 'idempotent_skip',
        reward: 0
      };
    }

    this.idempotencySet.add(action.idempotencyKey);
    const handler = this.handlers.get(action.actionType);
    if (!handler) {
      return {
        actionId: action.actionId,
        success: false,
        latencyMs: Date.now() - start,
        reason: 'missing_action_handler',
        reward: -1
      };
    }

    try {
      const result = await Promise.resolve(handler(action));
      return {
        actionId: action.actionId,
        success: true,
        latencyMs: Date.now() - start,
        reason: 'ok',
        reward: 1,
        output: result
      };
    } catch (error) {
      return {
        actionId: action.actionId,
        success: false,
        latencyMs: Date.now() - start,
        reason: error.message,
        reward: -1
      };
    }
  }
}

module.exports = {
  ActionDispatcher
};
