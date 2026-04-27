'use strict';

const { PrototypeRegistry } = require('./core/prototype-registry');
const { InputNormalizer } = require('./input/input-normalizer');
const { RuleTable } = require('./fast-decision/rule-table');
const { FastDecisionEngine } = require('./fast-decision/fast-decision-engine');
const { ActionDispatcher } = require('./action/action-dispatcher');
const { TuningEngine } = require('./tuning/tuning-engine');
const { PlanningAdapter } = require('./planning/planning-adapter');
const { PolicyValidator } = require('./guard/policy-validator');
const { PolicyGate } = require('./guard/policy-gate');
const { MetricsRecorder } = require('./monitor/metrics-recorder');
const { BehaviorOrchestrator } = require('./orchestration/behavior-orchestrator');
const { AASCBusAdapter } = require('./adapters/aasc-bus-adapter');

function createAutoBrain(options) {
  const runtimeId = options.runtimeId || 'default';
  const ruleTable = new RuleTable();
  const actionDispatcher = new ActionDispatcher();
  const validator = new PolicyValidator();

  const registry = new PrototypeRegistry();
  const busAdapter = new AASCBusAdapter({
    bus: options.bus,
    runtimeId,
    runtimeMetadata: options.runtimeMetadata || {}
  });

  const orchestrator = new BehaviorOrchestrator({
    inputNormalizer: new InputNormalizer(),
    fastDecisionEngine: new FastDecisionEngine({ ruleTable }),
    actionDispatcher,
    tuningEngine: new TuningEngine(),
    planningAdapter: new PlanningAdapter({ llmClient: options.llmClient }),
    policyGate: new PolicyGate({ validator }),
    metricsRecorder: new MetricsRecorder(),
    busAdapter
  });

  return {
    runtimeId,
    registry,
    ruleTable,
    actionDispatcher,
    orchestrator
  };
}

module.exports = {
  createAutoBrain
};
