'use strict';

function createOutcomeFeedback(result) {
  return {
    actionId: result.actionId,
    success: !!result.success,
    latencyMs: result.latencyMs || 0,
    reward: typeof result.reward === 'number' ? result.reward : (result.success ? 1 : 0),
    reason: result.reason || 'none',
    timestamp: Date.now()
  };
}

module.exports = {
  createOutcomeFeedback
};
