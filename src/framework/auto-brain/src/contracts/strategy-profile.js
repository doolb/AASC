'use strict';

function createStrategyProfile(input) {
  const now = Date.now();
  return {
    profileId: input && input.profileId ? input.profileId : 'default',
    version: input && input.version ? input.version : `v${now}`,
    rules: (input && input.rules) || [],
    limits: (input && input.limits) || {},
    publishedAt: now,
    rollbackFrom: (input && input.rollbackFrom) || null
  };
}

module.exports = {
  createStrategyProfile
};
