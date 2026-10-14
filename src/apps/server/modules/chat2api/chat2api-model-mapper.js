const lower = (value) => String(value || '').toLowerCase();
const {validateMappingExtension}=require('./chat2api-system-controls');
const {canonicalProviderId}=require('./chat2api-model-capabilities');
const {DEFAULT_MODEL_MAPPINGS}=require('./chat2api-default-model-mappings');

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
    const mappings = await dataStore.readCollection('modelMappings', []);
    if (!Array.isArray(mappings)) {
      throw new Error('Chat2API 模型映射数据必须是数组');
    }
    const matches = (item) => {
      const mappedProviderId = item.preferredProviderId || item.providerId;
      const providerMatches = !mappedProviderId || !provider || mappedProviderId === provider.id;
      return (providerMatches || (provider && canonicalProviderId(mappedProviderId)===canonicalProviderId(provider.id))) && matchesPattern(requestedModel, item.model);
    };
    const custom = mappings.find(matches);
    const providerMappings = provider && provider.modelMappings ? provider.modelMappings : {};
    const providerKey = Object.keys(providerMappings).find((key) => lower(key) === lower(requestedModel));
    if (!custom && providerKey) return { requestedModel, actualModel: providerMappings[providerKey], preferredProviderId: undefined, preferredAccountId: undefined };
    const mapping = custom || DEFAULT_MODEL_MAPPINGS.find(matches);
    const preferredProviderId = mapping && (mapping.preferredProviderId || mapping.providerId);
    if(mapping)validateMappingExtension(mapping);
    return {
      requestedModel,
      actualModel: mapping ? mapping.actualModel : requestedModel,
      preferredProviderId: canonicalProviderId(preferredProviderId),
      preferredAccountId: mapping && mapping.preferredAccountId,
      ...(mapping?.application ? {application:mapping.application} : {}),
      ...(mapping?.parameters ? {parameters:{...mapping.parameters}} : {}),
    };
  };

  return { resolveModel, matchesPattern };
};

module.exports = { createChat2ApiModelMapper };
