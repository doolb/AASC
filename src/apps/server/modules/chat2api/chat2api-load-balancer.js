const createChat2ApiLoadBalancer = ({ providerRegistry, dataStore, failureThreshold = 3, recoveryMs = 60_000 } = {}) => {
  if (!providerRegistry || typeof providerRegistry.listProviders !== 'function' || typeof providerRegistry.getEffectiveModels !== 'function') {
    throw new Error('Chat2API 负载均衡器需要 Provider 注册表');
  }
  if (!dataStore || typeof dataStore.listAccounts !== 'function') {
    throw new Error('Chat2API 负载均衡器需要账号数据存储');
  }

  const roundRobinIndexes = new Map();
  const failures = new Map();

  const isFailed = (accountId) => {
    const failure = failures.get(accountId);
    if (!failure) {
      return false;
    }
    if (Date.now() - failure.lastFailTime > recoveryMs) {
      failures.delete(accountId);
      return false;
    }
    return failure.count >= failureThreshold;
  };

  const supportsModel = (provider, requestedModel) => providerRegistry
    .getEffectiveModels(provider)
    .some((model) => model.displayName.toLowerCase() === requestedModel.toLowerCase()
      || (model.displayName.endsWith('*') && requestedModel.toLowerCase().startsWith(model.displayName.slice(0, -1).toLowerCase())));

  const availableCandidates = async (model, preferredProviderId, excludeFailed) => {
    const accounts = await dataStore.listAccounts();
    const providers = await providerRegistry.listProviders();
    const candidates = [];
    for (const provider of providers) {
      const providerMatches = !preferredProviderId || provider.id === preferredProviderId;
      const modelMatches = Boolean(preferredProviderId) || supportsModel(provider, model);
      if (provider.enabled === false || !providerMatches || !modelMatches) {
        continue;
      }
      for (const account of accounts) {
        if (account.providerId !== provider.id || account.enabled === false || (account.status && account.status !== 'active')) {
          continue;
        }
        if (account.dailyLimit && (account.todayUsed || 0) >= account.dailyLimit) {
          continue;
        }
        if (excludeFailed && isFailed(account.accountId)) {
          continue;
        }
        const effective = providerRegistry.getEffectiveModels(provider).find((item) => item.displayName.toLowerCase() === model.toLowerCase());
        candidates.push({ provider, account, actualModel: effective ? effective.actualModelId : model });
      }
    }
    return candidates;
  };

  const selectRoundRobin = (candidates, model) => {
    const key = `${model}:${candidates.map((candidate) => candidate.provider.id).join(',')}`;
    const index = roundRobinIndexes.get(key) || 0;
    const selected = candidates[index % candidates.length];
    roundRobinIndexes.set(key, (index + 1) % candidates.length);
    return selected;
  };

  const selectAccount = async (model, strategy = 'round-robin', preferredProviderId, preferredAccountId) => {
    const candidates = await availableCandidates(model, preferredProviderId, strategy === 'failover');
    if (candidates.length === 0) {
      return null;
    }
    const preferred = preferredAccountId && candidates.find((candidate) => candidate.account.accountId === preferredAccountId && !isFailed(candidate.account.accountId));
    if (preferred) {
      return preferred;
    }
    if (strategy === 'fill-first') {
      return candidates.reduce((best, candidate) => {
        const bestUsed = best.account.todayUsed || 0;
        const candidateUsed = candidate.account.todayUsed || 0;
        if (candidateUsed !== bestUsed) {
          return candidateUsed < bestUsed ? candidate : best;
        }
        return (candidate.account.lastUsed || 0) < (best.account.lastUsed || 0) ? candidate : best;
      });
    }
    if (strategy === 'failover') {
      const healthy = candidates.filter((candidate) => !isFailed(candidate.account.accountId));
      if (healthy.length > 0) {
        return selectRoundRobin(healthy, model);
      }
      return [...candidates].sort((left, right) => (failures.get(left.account.accountId)?.count || 0) - (failures.get(right.account.accountId)?.count || 0))[0];
    }
    return selectRoundRobin(candidates, model);
  };

  const markAccountFailed = (accountId) => {
    const current = failures.get(accountId) || { count: 0, lastFailTime: 0 };
    failures.set(accountId, { count: current.count + 1, lastFailTime: Date.now() });
  };

  const clearAccountFailure = (accountId) => failures.delete(accountId);

  return { selectAccount, markAccountFailed, clearAccountFailure, isFailed };
};

module.exports = { createChat2ApiLoadBalancer };
