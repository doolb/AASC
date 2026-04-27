'use strict';

function createExecutionAction(params) {
  const now = Date.now();
  const actionType = params && params.actionType ? params.actionType : 'noop';
  return {
    actionId: params && params.actionId ? params.actionId : `act_${now}`,
    actionType,
    target: (params && params.target) || 'local',
    params: (params && params.params) || {},
    timeoutMs: (params && params.timeoutMs) || 1000,
    idempotencyKey: (params && params.idempotencyKey) || `${actionType}_${now}`
  };
}

module.exports = {
  createExecutionAction
};
