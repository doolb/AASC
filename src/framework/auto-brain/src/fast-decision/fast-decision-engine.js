'use strict';

const { createExecutionAction } = require('../contracts/execution-action');

class FastDecisionEngine {
  constructor(options) {
    this.ruleTable = options.ruleTable;
  }

  evaluate(signalEvent, strategyProfile) {
    const matchedRule = this.ruleTable.findFirstMatch(signalEvent, strategyProfile);
    if (!matchedRule) {
      return createExecutionAction({ actionType: 'noop', params: { reason: 'no_rule_match' } });
    }
    return createExecutionAction(matchedRule.buildAction(signalEvent, strategyProfile));
  }
}

module.exports = {
  FastDecisionEngine
};
