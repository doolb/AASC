'use strict';

const { createStrategyDraft } = require('../contracts/strategy-draft');

class PlanningAdapter {
  constructor(options) {
    this.llmClient = options && options.llmClient;
  }

  buildSummary(tuningSnapshot, monitorMetrics) {
    return {
      tuning: tuningSnapshot,
      metrics: monitorMetrics || {}
    };
  }

  async propose(summary) {
    if (!this.llmClient || typeof this.llmClient.proposeStrategy !== 'function') {
      return createStrategyDraft({
        goal: 'stability',
        constraints: { source: 'fallback' },
        ruleChanges: []
      });
    }

    const rawDraft = await this.llmClient.proposeStrategy(summary);
    return createStrategyDraft(rawDraft);
  }
}

module.exports = {
  PlanningAdapter
};
