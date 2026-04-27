'use strict';

function createSignalEvent(input) {
  const now = Date.now();
  const source = input && input.source ? input.source : 'unknown';
  const signalType = input && input.signalType ? input.signalType : 'unknown';
  return {
    id: input && input.id ? input.id : `sig_${now}`,
    source,
    signalType,
    payload: (input && input.payload) || {},
    riskLevel: (input && input.riskLevel) || 'low',
    timestamp: input && input.timestamp ? input.timestamp : now,
    traceId: input && input.traceId ? input.traceId : `trace_${now}`
  };
}

module.exports = {
  createSignalEvent
};
