const fs = require('fs');
const path = require('path');

class CapabilityDefinition {
  constructor(options = {}) {
    this.id = options.id || '';
    this.name = options.name || '';
    this.category = options.category || 'basic';
    this.level = options.level || 1;
    this.securityLevel = options.securityLevel || 0;
    this.description = options.description || '';
    this.inputSchema = options.inputSchema || null;
    this.outputSchema = options.outputSchema || null;
    this.dependencies = options.dependencies || [];
    this.inherits = options.inherits || [];
    this.overrides = options.overrides || {};
    this.extensions = options.extensions || {};
    this.config = options.config || {};
    this.handler = options.handler || null;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      level: this.level,
      securityLevel: this.securityLevel,
      description: this.description,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      dependencies: this.dependencies,
      inherits: this.inherits,
      overrides: this.overrides,
      extensions: this.extensions,
      config: this.config
    };
  }

  static fromJSON(json) {
    return new CapabilityDefinition(json);
  }
}

class ResolvedCapability {
  constructor(definition, inherited = [], mergedConfig = {}) {
    this.definition = definition;
    this.inherited = inherited;
    this.mergedConfig = mergedConfig;
  }

  get id() { return this.definition.id; }
  get name() { return this.definition.name; }
  get category() { return this.definition.category; }
  get level() { return this.definition.level; }
  get securityLevel() { return this.definition.securityLevel; }
  get description() { return this.definition.description; }
  get config() { return this.mergedConfig; }
}

class CapabilityRegistry {
  constructor(options = {}) {
    this.configPath = options.configPath || path.join(__dirname, '../config/capabilities.json');
    this.capabilities = new Map();
    this.resolvedCache = new Map();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.capabilities.clear();
        this.resolvedCache.clear();

        for (const capData of data.capabilities || []) {
          const cap = CapabilityDefinition.fromJSON(capData);
          this.capabilities.set(cap.id, cap);
        }
        console.log(`[CapabilityRegistry] Loaded ${this.capabilities.size} capabilities`);
      }
    } catch (err) {
      console.error('[CapabilityRegistry] Load failed:', err.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        capabilities: Array.from(this.capabilities.values()).map(c => c.toJSON()),
        savedAt: Date.now()
      };
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[CapabilityRegistry] Save failed:', err.message);
    }
  }

  register(definition) {
    if (!(definition instanceof CapabilityDefinition)) {
      definition = CapabilityDefinition.fromJSON(definition);
    }
    this.capabilities.set(definition.id, definition);
    this.resolvedCache.delete(definition.id);
    return definition;
  }

  unregister(capabilityId) {
    this.resolvedCache.delete(capabilityId);
    return this.capabilities.delete(capabilityId);
  }

  get(capabilityId) {
    return this.capabilities.get(capabilityId);
  }

  resolve(capabilityId, visited = new Set()) {
    if (this.resolvedCache.has(capabilityId)) {
      return this.resolvedCache.get(capabilityId);
    }

    if (visited.has(capabilityId)) {
      console.error(`[CapabilityRegistry] Circular inheritance detected: ${capabilityId}`);
      return null;
    }
    visited.add(capabilityId);

    const definition = this.capabilities.get(capabilityId);
    if (!definition) {
      console.warn(`[CapabilityRegistry] Capability not found: ${capabilityId}`);
      return null;
    }

    const inherited = [];
    for (const parentId of definition.inherits) {
      const resolved = this.resolve(parentId, new Set(visited));
      if (resolved) {
        inherited.push(resolved);
      }
    }

    let mergedConfig = {};
    for (const parent of inherited) {
      mergedConfig = { ...mergedConfig, ...parent.mergedConfig };
    }
    mergedConfig = { ...mergedConfig, ...definition.config, ...definition.overrides };
    mergedConfig = { ...mergedConfig, ...definition.extensions };

    const resolved = new ResolvedCapability(definition, inherited, mergedConfig);
    this.resolvedCache.set(capabilityId, resolved);

    return resolved;
  }

  getAll() {
    return Array.from(this.capabilities.values());
  }

  getByCategory(category) {
    return this.getAll().filter(c => c.category === category);
  }

  getByLevel(minLevel, maxLevel = 5) {
    return this.getAll().filter(c => c.level >= minLevel && c.level <= maxLevel);
  }

  getBySecurityLevel(maxSecurityLevel) {
    return this.getAll().filter(c => c.securityLevel <= maxSecurityLevel);
  }

  getDependencies(capabilityId) {
    const resolved = this.resolve(capabilityId);
    if (!resolved) return [];

    const deps = new Set();
    const collectDeps = (cap) => {
      for (const depId of cap.definition.dependencies) {
        if (!deps.has(depId)) {
          deps.add(depId);
          const depCap = this.get(depId);
          if (depCap) {
            collectDeps({ definition: depCap });
          }
        }
      }
      for (const inherited of cap.inherited) {
        collectDeps(inherited);
      }
    };
    collectDeps(resolved);

    return Array.from(deps);
  }

  validate(capabilityId) {
    const errors = [];
    const definition = this.capabilities.get(capabilityId);

    if (!definition) {
      errors.push(`Capability not found: ${capabilityId}`);
      return errors;
    }

    for (const parentId of definition.inherits) {
      if (!this.capabilities.has(parentId)) {
        errors.push(`Parent capability not found: ${parentId}`);
      }
    }

    for (const depId of definition.dependencies) {
      if (!this.capabilities.has(depId)) {
        errors.push(`Dependency not found: ${depId}`);
      }
    }

    if (definition.level < 1 || definition.level > 5) {
      errors.push(`Invalid level: ${definition.level} (must be 1-5)`);
    }

    if (definition.securityLevel < 0 || definition.securityLevel > 5) {
      errors.push(`Invalid security level: ${definition.securityLevel} (must be 0-5)`);
    }

    return errors;
  }

  validateAll() {
    const results = {};
    for (const capId of this.capabilities.keys()) {
      const errors = this.validate(capId);
      if (errors.length > 0) {
        results[capId] = errors;
      }
    }
    return results;
  }

  clearCache() {
    this.resolvedCache.clear();
  }
}

class CapabilityBuilder {
  constructor() {
    this.definition = {};
  }

  withId(id) {
    this.definition.id = id;
    return this;
  }

  withName(name) {
    this.definition.name = name;
    return this;
  }

  withCategory(category) {
    this.definition.category = category;
    return this;
  }

  withLevel(level) {
    this.definition.level = level;
    return this;
  }

  withSecurityLevel(level) {
    this.definition.securityLevel = level;
    return this;
  }

  withDescription(desc) {
    this.definition.description = desc;
    return this;
  }

  withInputSchema(schema) {
    this.definition.inputSchema = schema;
    return this;
  }

  withOutputSchema(schema) {
    this.definition.outputSchema = schema;
    return this;
  }

  inherits(parentIds) {
    this.definition.inherits = Array.isArray(parentIds) ? parentIds : [parentIds];
    return this;
  }

  dependsOn(depIds) {
    this.definition.dependencies = Array.isArray(depIds) ? depIds : [depIds];
    return this;
  }

  withConfig(config) {
    this.definition.config = config;
    return this;
  }

  withOverrides(overrides) {
    this.definition.overrides = overrides;
    return this;
  }

  withExtensions(extensions) {
    this.definition.extensions = extensions;
    return this;
  }

  build() {
    return new CapabilityDefinition(this.definition);
  }
}

const defaultCapabilities = [
  {
    id: 'message-handler',
    name: '消息处理',
    category: 'basic',
    level: 1,
    securityLevel: 0,
    description: '基础消息接收和处理能力'
  },
  {
    id: 'event-emitter',
    name: '事件触发',
    category: 'basic',
    level: 1,
    securityLevel: 0,
    description: '事件触发和监听能力'
  },
  {
    id: 'scheduler',
    name: '定时任务',
    category: 'basic',
    level: 2,
    securityLevel: 0,
    description: '定时执行任务能力'
  },
  {
    id: 'state-manager',
    name: '状态管理',
    category: 'basic',
    level: 2,
    securityLevel: 0,
    description: '执行者状态管理能力'
  },
  {
    id: 'llm-base',
    name: '语言模型基础',
    category: 'professional',
    level: 4,
    securityLevel: 1,
    description: 'AI语言模型基础能力',
    config: {
      model: 'default',
      maxTokens: 4096
    }
  },
  {
    id: 'chat',
    name: '聊天能力',
    category: 'professional',
    level: 4,
    securityLevel: 1,
    description: '对话生成能力',
    inherits: ['llm-base'],
    extensions: {
      systemPrompt: '你是一个友好的助手'
    }
  },
  {
    id: 'code-assist',
    name: '代码辅助',
    category: 'professional',
    level: 4,
    securityLevel: 2,
    description: '代码生成和解释能力',
    inherits: ['llm-base'],
    extensions: {
      systemPrompt: '你是一个代码专家'
    }
  },
  {
    id: 'voice-recognition',
    name: '语音识别',
    category: 'professional',
    level: 3,
    securityLevel: 0,
    description: '语音转文字能力'
  },
  {
    id: 'voice-synthesis',
    name: '语音合成',
    category: 'professional',
    level: 3,
    securityLevel: 0,
    description: '文字转语音能力'
  },
  {
    id: 'media-rendering',
    name: '画面渲染',
    category: 'special',
    level: 3,
    securityLevel: 0,
    description: '媒体画面渲染能力'
  },
  {
    id: 'media-library',
    name: '媒体库管理',
    category: 'special',
    level: 3,
    securityLevel: 1,
    description: '多源媒体管理能力'
  },
  {
    id: 'distributed-coordination',
    name: '分布式协调',
    category: 'special',
    level: 5,
    securityLevel: 4,
    description: '跨节点协调能力'
  },
  {
    id: 'security-auth',
    name: '安全认证',
    category: 'special',
    level: 5,
    securityLevel: 5,
    description: '身份认证和授权能力'
  }
];

function initDefaultCapabilities(registry) {
  for (const capData of defaultCapabilities) {
    if (!registry.get(capData.id)) {
      registry.register(new CapabilityDefinition(capData));
    }
  }
  registry.save();
}

module.exports = {
  CapabilityDefinition,
  ResolvedCapability,
  CapabilityRegistry,
  CapabilityBuilder,
  initDefaultCapabilities,
  defaultCapabilities
};
