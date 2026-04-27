'use strict';

const { createOutcomeFeedback } = require('../contracts/outcome-feedback');

class BehaviorOrchestrator {
  constructor(options) {
    this.inputNormalizer = options.inputNormalizer;
    this.fastDecisionEngine = options.fastDecisionEngine;
    this.actionDispatcher = options.actionDispatcher;
    this.tuningEngine = options.tuningEngine;
    this.planningAdapter = options.planningAdapter;
    this.policyGate = options.policyGate;
    this.metricsRecorder = options.metricsRecorder;
    this.busAdapter = options.busAdapter;
  }

  async handle(input) {
    const signalEvent = this.inputNormalizer.normalize(input);
    const action = this.fastDecisionEngine.evaluate(signalEvent, this.policyGate.activeStrategyProfile);
    const executionResult = await this.actionDispatcher.commit(action);
    const feedback = createOutcomeFeedback(executionResult);
    const tuningSnapshot = this.tuningEngine.adjust(feedback);

    let gateResult = { passed: false, reason: 'planning_skipped' };
    try {
      const summary = this.planningAdapter.buildSummary(tuningSnapshot, this.metricsRecorder.snapshot().metrics);
      const strategyDraft = await this.planningAdapter.propose(summary);
      gateResult = this.policyGate.review(strategyDraft);
      if (gateResult.passed) {
        const profile = this.policyGate.publish(gateResult.profile);
        this.busAdapter.publish('strategy.updated', profile);
      }
    } catch (error) {
      gateResult = { passed: false, reason: error.message };
    }

    this.metricsRecorder.record(signalEvent, action, executionResult, gateResult);
    this.busAdapter.publish('action.result', {
      traceId: signalEvent.traceId,
      executionResult
    });

    return executionResult;
  }

  bindSignalTopic(channel = 'signal') {
    this.busAdapter.subscribe(channel, async (message) => {
      const payload = message && message.payload ? message.payload : message;
      const actualPayload = payload && payload.data ? payload.data : payload;
      await this.handle(actualPayload);
    }, 'behavior-orchestrator');
  }

  destroy() {
    if (this.busAdapter && typeof this.busAdapter.close === 'function') {
      this.busAdapter.close();
    }
  }
}

module.exports = {
  BehaviorOrchestrator
};
