'use strict';

// 发行种子与运行时共享同一套公开规则；这里只保存模型名称，不保存账号或登录资料。
const DEFAULT_MODEL_MAPPINGS = Object.freeze([
  ...['flash', 'pro'].flatMap(mode => ['think', 'search', 'think-search'].map(feature => Object.freeze({
    model: `deepseek-v4-${mode}-${feature}`, actualModel: `deepseek-v4-${mode}`, providerId: 'deepseek'
  }))),
  Object.freeze({ model: 'Qwen3.6-Flash', actualModel: 'Qwen3.7', providerId: 'qwen' }),
  ...['doubao', 'doubao-think', 'doubao-expert'].map(model => Object.freeze({ model, actualModel: model, providerId: 'doubaochat' }))
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

module.exports = { DEFAULT_MODEL_MAPPINGS, matchesModelPattern, effectiveModelMappings };
