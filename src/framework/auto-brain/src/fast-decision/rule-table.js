'use strict';

class RuleTable {
  constructor() {
    this.rules = [];
  }

  addRule(rule) {
    if (!rule || typeof rule.match !== 'function' || typeof rule.buildAction !== 'function') {
      throw new Error('invalid rule');
    }
    const priority = typeof rule.priority === 'number' ? rule.priority : 0;
    this.rules.push({ ...rule, priority });
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  findFirstMatch(signalEvent, strategyProfile) {
    for (const rule of this.rules) {
      if (rule.match(signalEvent, strategyProfile)) {
        return rule;
      }
    }
    return null;
  }
}

module.exports = {
  RuleTable
};
