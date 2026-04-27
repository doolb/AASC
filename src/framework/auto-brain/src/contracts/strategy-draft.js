'use strict';

function createStrategyDraft(input) {
  const now = Date.now();
  return {
    draftId: input && input.draftId ? input.draftId : `draft_${now}`,
    goal: (input && input.goal) || 'stability',
    constraints: (input && input.constraints) || {},
    ruleChanges: (input && input.ruleChanges) || [],
    confidence: typeof (input && input.confidence) === 'number' ? input.confidence : 0,
    createdAt: now
  };
}

module.exports = {
  createStrategyDraft
};
