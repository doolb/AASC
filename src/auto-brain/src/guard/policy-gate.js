'use strict';

const { createStrategyProfile } = require('../contracts/strategy-profile');

class PolicyGate {
  constructor(options) {
    this.validator = options.validator;
    this.activeStrategyProfile = createStrategyProfile({ profileId: 'default', version: 'v1' });
    this.previousStrategyProfile = null;
  }

  review(strategyDraft) {
    const validation = this.validator.validate(strategyDraft);
    if (!validation.passed) {
      return { passed: false, reason: validation.reason };
    }

    const nextProfile = createStrategyProfile({
      profileId: this.activeStrategyProfile.profileId,
      version: `v${Date.now()}`,
      rules: strategyDraft.ruleChanges,
      rollbackFrom: this.activeStrategyProfile.version
    });

    return {
      passed: true,
      profile: nextProfile
    };
  }

  publish(profile) {
    this.previousStrategyProfile = this.activeStrategyProfile;
    this.activeStrategyProfile = profile;
    return this.activeStrategyProfile;
  }

  rollback() {
    if (!this.previousStrategyProfile) {
      return this.activeStrategyProfile;
    }
    this.activeStrategyProfile = this.previousStrategyProfile;
    this.previousStrategyProfile = null;
    return this.activeStrategyProfile;
  }
}

module.exports = {
  PolicyGate
};
