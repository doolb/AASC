'use strict';

class PolicyValidator {
  validate(strategyDraft) {
    if (!strategyDraft || !Array.isArray(strategyDraft.ruleChanges)) {
      return { passed: false, reason: 'invalid_strategy_draft' };
    }
    if (strategyDraft.confidence < 0) {
      return { passed: false, reason: 'invalid_confidence' };
    }
    return { passed: true, reason: 'ok' };
  }
}

module.exports = {
  PolicyValidator
};
