const { Message, MessageType } = require('./message');

class RoutingRule {
  constructor(options = {}) {
    this.topic = options.topic || null;
    this.type = options.type || null;
    this.source = options.source || null;
    this.capability = options.capability || null;
    this.handler = options.handler || null;
    this.priority = options.priority || 0;
    this.condition = options.condition || null;
  }

  matches(message) {
    if (this.topic && message.topic !== this.topic) {
      return false;
    }
    
    if (this.type && message.type !== this.type) {
      return false;
    }
    
    if (this.source) {
      if (this.source.ip && message.source.ip !== this.source.ip) {
        return false;
      }
      if (this.source.role && message.source.role !== this.source.role) {
        return false;
      }
      if (this.source.name && message.source.name !== this.source.name) {
        return false;
      }
    }
    
    if (this.capability) {
      return false;
    }
    
    if (this.condition && !this.condition(message)) {
      return false;
    }
    
    return true;
  }
}

class MessageRouter {
  constructor() {
    this.rules = [];
    this.defaultHandler = null;
  }

  addRule(rule) {
    if (!(rule instanceof RoutingRule)) {
      rule = new RoutingRule(rule);
    }
    
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
    
    return this;
  }

  removeRule(index) {
    if (index >= 0 && index < this.rules.length) {
      this.rules.splice(index, 1);
    }
    return this;
  }

  setDefaultHandler(handler) {
    this.defaultHandler = handler;
    return this;
  }

  route(message, actors) {
    const matchedRules = this.rules.filter(rule => rule.matches(message));
    
    if (matchedRules.length === 0) {
      return this.defaultHandler ? [this.defaultHandler] : [];
    }
    
    const handlers = [];
    for (const rule of matchedRules) {
      if (rule.handler) {
        const actor = this.findActor(actors, rule.handler);
        if (actor) {
          handlers.push(actor);
        }
      }
    }
    
    return handlers;
  }

  findActor(actors, handlerPattern) {
    if (typeof handlerPattern === 'function') {
      return actors.find(handlerPattern);
    }
    
    if (typeof handlerPattern === 'string') {
      return actors.find(a => a.address.toString() === handlerPattern);
    }
    
    if (typeof handlerPattern === 'object') {
      return actors.find(a => {
        if (handlerPattern.ip && a.address.ip !== handlerPattern.ip) return false;
        if (handlerPattern.role && a.address.role !== handlerPattern.role) return false;
        if (handlerPattern.name && a.address.name !== handlerPattern.name) return false;
        return true;
      });
    }
    
    return null;
  }

  getRules() {
    return this.rules.map((rule, index) => ({
      index,
      topic: rule.topic,
      type: rule.type,
      handler: rule.handler,
      priority: rule.priority
    }));
  }

  clearRules() {
    this.rules = [];
    return this;
  }
}

class MessageFilter {
  constructor(options = {}) {
    this.topics = options.topics || null;
    this.types = options.types || null;
    this.sources = options.sources || null;
    this.excludeTopics = options.excludeTopics || null;
    this.excludeSources = options.excludeSources || null;
    this.custom = options.custom || null;
  }

  test(message) {
    if (this.topics && !this.topics.includes(message.topic)) {
      return false;
    }
    
    if (this.excludeTopics && this.excludeTopics.includes(message.topic)) {
      return false;
    }
    
    if (this.types && !this.types.includes(message.type)) {
      return false;
    }
    
    if (this.sources && !this.matchSource(message.source, this.sources)) {
      return false;
    }
    
    if (this.excludeSources && this.matchSource(message.source, this.excludeSources)) {
      return false;
    }
    
    if (this.custom && !this.custom(message)) {
      return false;
    }
    
    return true;
  }

  matchSource(source, patterns) {
    return patterns.some(pattern => {
      if (pattern.ip && source.ip !== pattern.ip) return false;
      if (pattern.role && source.role !== pattern.role) return false;
      if (pattern.name && source.name !== pattern.name) return false;
      return true;
    });
  }

  and(otherFilter) {
    const self = this;
    return new MessageFilter({
      custom: (message) => self.test(message) && otherFilter.test(message)
    });
  }

  or(otherFilter) {
    const self = this;
    return new MessageFilter({
      custom: (message) => self.test(message) || otherFilter.test(message)
    });
  }

  not() {
    const self = this;
    return new MessageFilter({
      custom: (message) => !self.test(message)
    });
  }
}

class FilterBuilder {
  constructor() {
    this.options = {};
  }

  withTopics(topics) {
    this.options.topics = Array.isArray(topics) ? topics : [topics];
    return this;
  }

  withTypes(types) {
    this.options.types = Array.isArray(types) ? types : [types];
    return this;
  }

  withSources(sources) {
    this.options.sources = Array.isArray(sources) ? sources : [sources];
    return this;
  }

  excludeTopics(topics) {
    this.options.excludeTopics = Array.isArray(topics) ? topics : [topics];
    return this;
  }

  excludeSources(sources) {
    this.options.excludeSources = Array.isArray(sources) ? sources : [sources];
    return this;
  }

  withCustom(fn) {
    this.options.custom = fn;
    return this;
  }

  build() {
    return new MessageFilter(this.options);
  }
}

module.exports = {
  RoutingRule,
  MessageRouter,
  MessageFilter,
  FilterBuilder
};
