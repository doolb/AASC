'use strict';

// 三档名称、保存到 LLM 配置的名称和实际请求目标都在这里由开发维护。
const PROVIDER_TIERS = Object.freeze({
  qwen: Object.freeze({ label: 'Qwen', defaultTier: 'flash', models: Object.freeze({
    mini: 'aasc-qwen-mini', flash: 'aasc-qwen-flash', pro: 'aasc-qwen-pro'
  }), actualModels: Object.freeze({
    mini: 'Qwen3.6-Flash', flash: 'Qwen3.7', pro: 'Qwen3.7-Max'
  }), targetModels: Object.freeze({
    mini: 'Qwen3.6-Flash', flash: 'Qwen3.7', pro: 'Qwen3.7-Max'
  }) }),
  doubaochat: Object.freeze({ label: '豆包', defaultTier: 'mini', models: Object.freeze({
    mini: 'doubao', flash: 'doubao-think', pro: 'doubao-expert'
  }), actualModels: Object.freeze({
    mini: 'doubao', flash: 'doubao-think', pro: 'doubao-expert'
  }), targetModels: Object.freeze({
    mini: 'doubao', flash: 'doubao', pro: 'doubao-expert'
  }) })
});

// 发行种子与运行时共享同一套公开规则；这里只保存模型名称，不保存账号或登录资料。
const DEFAULT_MODEL_MAPPINGS = Object.freeze([
  ...['flash', 'pro'].flatMap(mode => ['think', 'search', 'think-search'].map(feature => Object.freeze({
    model: `deepseek-v4-${mode}-${feature}`, actualModel: `deepseek-v4-${mode}`, providerId: 'deepseek'
  }))),
  Object.freeze({ model: 'Qwen3.6-Flash', actualModel: 'Qwen3.7', providerId: 'qwen' }),
  // Qwen 的专用请求别名避开旧兼容映射；豆包普通保留独立名称，实际复用思考 0。
  ...Object.entries(PROVIDER_TIERS).flatMap(([providerId, mapping]) =>
    Object.keys(mapping.models).map(tier => Object.freeze({
      model: mapping.models[tier], actualModel: mapping.targetModels[tier], providerId
    })))
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

module.exports = { PROVIDER_TIERS, DEFAULT_MODEL_MAPPINGS, matchesModelPattern, effectiveModelMappings };
