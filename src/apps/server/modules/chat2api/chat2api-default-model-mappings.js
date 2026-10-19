'use strict';

// 三档只定义保存到 LLM 配置的模型名；请求别名和实际目标由下方 Chat2API 映射处理。
const PROVIDER_TIERS = Object.freeze({
  qwen: Object.freeze({ label: 'Qwen', defaultTier: 'flash', models: Object.freeze({
    mini: 'Qwen3.6-Flash', flash: 'Qwen3.7', pro: 'Qwen3.7-Max'
  }) }),
  doubaochat: Object.freeze({ label: '豆包', defaultTier: 'mini', models: Object.freeze({
    mini: 'doubao', flash: 'doubao-think', pro: 'doubao-expert'
  }) })
});

function tierRequestModel(providerId, tier) {
  const profileModel = PROVIDER_TIERS[providerId]?.models[tier];
  if (!profileModel) return null;
  // Qwen 轻量的公开配置名已有历史兼容规则，请求采用内部别名以保持原目标。
  return providerId === 'qwen' ? `aasc-qwen-${tier}` : profileModel;
}

// 发行种子与运行时共享同一套公开规则；这里只保存模型名称，不保存账号或登录资料。
const DEFAULT_MODEL_MAPPINGS = Object.freeze([
  ...['flash', 'pro'].flatMap(mode => ['think', 'search', 'think-search'].map(feature => Object.freeze({
    model: `deepseek-v4-${mode}-${feature}`, actualModel: `deepseek-v4-${mode}`, providerId: 'deepseek'
  }))),
  Object.freeze({ model: 'Qwen3.6-Flash', actualModel: 'Qwen3.7', providerId: 'qwen' }),
  // Chat2API 独立决定请求别名的目标；Qwen 的专用别名避开旧兼容映射。
  Object.freeze({ model: tierRequestModel('qwen', 'mini'), actualModel: 'Qwen3.6-Flash', providerId: 'qwen' }),
  Object.freeze({ model: tierRequestModel('qwen', 'flash'), actualModel: 'Qwen3.7', providerId: 'qwen' }),
  Object.freeze({ model: tierRequestModel('qwen', 'pro'), actualModel: 'Qwen3.7-Max', providerId: 'qwen' }),
  Object.freeze({ model: tierRequestModel('doubaochat', 'mini'), actualModel: 'doubao', providerId: 'doubaochat' }),
  Object.freeze({ model: tierRequestModel('doubaochat', 'flash'), actualModel: 'doubao', providerId: 'doubaochat' }),
  Object.freeze({ model: tierRequestModel('doubaochat', 'pro'), actualModel: 'doubao-expert', providerId: 'doubaochat' })
]);

function matchesModelPattern(model, pattern) {
  const input = String(model || '').toLowerCase();
  const value = String(pattern || '').toLowerCase();
  if (!value.includes('*')) return input === value;
  const parts = value.split('*');
  return parts.length === 2 && input.startsWith(parts[0]) && input.endsWith(parts[1]);
}

function effectiveModelMappings(custom) {
  return [...custom, ...DEFAULT_MODEL_MAPPINGS.filter(rule => !custom.some(item => matchesModelPattern(rule.model, item.model)))
    .map(rule => ({ ...rule, builtinDefault: true }))];
}

module.exports = { PROVIDER_TIERS, tierRequestModel, DEFAULT_MODEL_MAPPINGS, matchesModelPattern, effectiveModelMappings };
