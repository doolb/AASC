const lower = (value) => String(value || '').toLowerCase();

const matchesPattern = (model, pattern) => {
  const normalizedModel = lower(model);
  const normalizedPattern = lower(pattern);
  if (!normalizedPattern.includes('*')) {
    return normalizedModel === normalizedPattern;
  }
  const parts = normalizedPattern.split('*');
  if (parts.length !== 2) {
    return false;
  }
  return normalizedModel.startsWith(parts[0]) && normalizedModel.endsWith(parts[1]);
};

const createChat2ApiModelMapper = ({ dataStore } = {}) => {
  if (!dataStore || typeof dataStore.readCollection !== 'function') {
    throw new Error('Chat2API 模型映射器需要可读数据存储');
  }

  const resolveModel = async (requestedModel, provider) => {
    const providerMappings = provider && provider.modelMappings ? provider.modelMappings : {};
    const providerKey = Object.keys(providerMappings).find((key) => lower(key) === lower(requestedModel));
    if (providerKey) {
      return {
        requestedModel,
        actualModel: providerMappings[providerKey],
        preferredProviderId: undefined,
        preferredAccountId: undefined,
      };
    }

    const mappings = await dataStore.readCollection('modelMappings', []);
    if (!Array.isArray(mappings)) {
      throw new Error('Chat2API 模型映射数据必须是数组');
    }
    const mapping = mappings.find((item) => {
      const providerMatches = !item.preferredProviderId || !provider || item.preferredProviderId === provider.id;
      return providerMatches && matchesPattern(requestedModel, item.model);
    });
    return {
      requestedModel,
      actualModel: mapping ? mapping.actualModel : requestedModel,
      preferredProviderId: mapping && mapping.preferredProviderId,
      preferredAccountId: mapping && mapping.preferredAccountId,
    };
  };

  return { resolveModel, matchesPattern };
};

module.exports = { createChat2ApiModelMapper };
