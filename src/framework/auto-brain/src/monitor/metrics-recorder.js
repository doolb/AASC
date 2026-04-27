'use strict';

class MetricsRecorder {
  constructor() {
    this.metrics = {
      planning_degraded: 0,
      rollback_event: 0,
      success_total: 0,
      failed_total: 0
    };
    this.logs = [];
  }

  record(signalEvent, action, executionResult, gateResult) {
    if (executionResult.success) {
      this.metrics.success_total += 1;
    } else {
      this.metrics.failed_total += 1;
    }

    if (gateResult && gateResult.passed === false) {
      this.metrics.planning_degraded += 1;
    }

    this.logs.push({
      timestamp: Date.now(),
      traceId: signalEvent.traceId,
      actionType: action.actionType,
      success: executionResult.success
    });
  }

  markRollback() {
    this.metrics.rollback_event += 1;
  }

  snapshot() {
    return {
      metrics: { ...this.metrics },
      logs: this.logs.slice(-100)
    };
  }
}

module.exports = {
  MetricsRecorder
};
