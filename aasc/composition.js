const fs = require('fs');
const path = require('path');
const { PipelineExecutor, PipelineBuilder, PipelineStep } = require('./pipeline');

const TriggerType = {
  COMMAND: 'command',
  EVENT: 'event',
  SCHEDULE: 'schedule',
  MANUAL: 'manual',
  CAPABILITY: 'capability'
};

const CompositionStatus = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  DEPRECATED: 'deprecated'
};

class Trigger {
  constructor(options = {}) {
    this.type = options.type || TriggerType.MANUAL;
    this.pattern = options.pattern || null;
    this.topic = options.topic || null;
    this.schedule = options.schedule || null;
    this.condition = options.condition || null;
    this.capabilityId = options.capabilityId || null;
  }

  matches(input) {
    switch (this.type) {
      case TriggerType.COMMAND:
        return this.matchCommand(input);
      case TriggerType.EVENT:
        return this.matchEvent(input);
      case TriggerType.SCHEDULE:
        return this.matchSchedule(input);
      case TriggerType.CAPABILITY:
        return this.matchCapability(input);
      default:
        return true;
    }
  }

  matchCommand(input) {
    if (!this.pattern) return false;
    const text = typeof input === 'string' ? input : input.text || '';
    const regex = new RegExp(this.pattern, 'i');
    const match = text.match(regex);
    if (match) {
      return { matched: true, match };
    }
    return { matched: false };
  }

  matchEvent(input) {
    if (!this.topic) return false;
    const eventTopic = typeof input === 'string' ? input : input.topic;
    if (eventTopic === this.topic) {
      return { matched: true, event: input };
    }
    return { matched: false };
  }

  matchSchedule(input) {
    if (!this.schedule) return false;
    return { matched: true, schedule: this.schedule };
  }

  matchCapability(input) {
    if (!this.capabilityId) return false;
    const capId = typeof input === 'string' ? input : input.capabilityId;
    if (capId === this.capabilityId) {
      return { matched: true, capabilityId: capId };
    }
    return { matched: false };
  }

  extractParams(input, matchResult) {
    const params = {};

    if (this.type === TriggerType.COMMAND && matchResult.match) {
      const match = matchResult.match;
      for (let i = 1; i < match.length; i++) {
        params[`match[${i - 1}]`] = match[i];
      }
      params.fullMatch = match[0];
    }

    if (this.type === TriggerType.EVENT && matchResult.event) {
      Object.assign(params, matchResult.event);
    }

    return params;
  }

  toJSON() {
    return {
      type: this.type,
      pattern: this.pattern,
      topic: this.topic,
      schedule: this.schedule,
      condition: this.condition,
      capabilityId: this.capabilityId
    };
  }

  static fromJSON(json) {
    return new Trigger(json);
  }
}

class CapabilityComposition {
  constructor(options = {}) {
    this.id = options.id || this.generateId();
    this.name = options.name || '';
    this.description = options.description || '';
    this.trigger = options.trigger instanceof Trigger 
      ? options.trigger 
      : new Trigger(options.trigger || {});
    this.pipeline = (options.pipeline || []).map(step => 
      step instanceof PipelineStep ? step : new PipelineStep(step)
    );
    this.fallbackPipeline = options.fallbackPipeline || null;
    this.status = options.status || CompositionStatus.ENABLED;
    this.priority = options.priority || 0;
    this.timeout = options.timeout || 60000;
    this.metadata = options.metadata || {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: '1.0.0',
      author: 'system'
    };
  }

  generateId() {
    return `comp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  shouldTrigger(input) {
    return this.trigger.matches(input);
  }

  getCapabilityIds() {
    return this.pipeline.map(step => step.capabilityId);
  }

  getMaxCapabilityLevel(capabilityRegistry) {
    const levels = this.pipeline.map(step => {
      const cap = capabilityRegistry.resolve(step.capabilityId);
      return cap ? cap.level : 0;
    });
    return Math.max(...levels, 0);
  }

  getDependencies(capabilityRegistry) {
    const deps = new Set();
    for (const step of this.pipeline) {
      const capDeps = capabilityRegistry.getDependencies(step.capabilityId);
      capDeps.forEach(d => deps.add(d));
    }
    return Array.from(deps);
  }

  validate(capabilityRegistry) {
    const errors = [];

    if (!this.id) {
      errors.push('Composition ID is required');
    }

    if (!this.name) {
      errors.push('Composition name is required');
    }

    if (this.pipeline.length === 0) {
      errors.push('Pipeline must have at least one step');
    }

    for (const step of this.pipeline) {
      if (!step.capabilityId) {
        errors.push(`Step ${step.id} missing capabilityId`);
      } else if (capabilityRegistry) {
        const cap = capabilityRegistry.resolve(step.capabilityId);
        if (!cap) {
          errors.push(`Step ${step.id} references unknown capability: ${step.capabilityId}`);
        }
      }
    }

    return errors;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      trigger: this.trigger.toJSON(),
      pipeline: this.pipeline.map(s => s.toJSON()),
      fallbackPipeline: this.fallbackPipeline,
      status: this.status,
      priority: this.priority,
      timeout: this.timeout,
      metadata: this.metadata
    };
  }

  static fromJSON(json) {
    return new CapabilityComposition(json);
  }
}

class CompositionRegistry {
  constructor(options = {}) {
    this.configPath = options.configPath || path.join(__dirname, '../config/compositions.json');
    this.compositions = new Map();
    this.triggerIndex = new Map();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.compositions.clear();
        this.triggerIndex.clear();

        for (const compData of data.compositions || []) {
          const comp = CapabilityComposition.fromJSON(compData);
          this.register(comp);
        }
        console.log(`[CompositionRegistry] Loaded ${this.compositions.size} compositions`);
      }
    } catch (err) {
      console.error('[CompositionRegistry] Load failed:', err.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = {
        compositions: Array.from(this.compositions.values()).map(c => c.toJSON()),
        savedAt: Date.now()
      };
      fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[CompositionRegistry] Save failed:', err.message);
    }
  }

  register(composition) {
    if (!(composition instanceof CapabilityComposition)) {
      composition = CapabilityComposition.fromJSON(composition);
    }

    this.compositions.set(composition.id, composition);

    const triggerType = composition.trigger.type;
    if (!this.triggerIndex.has(triggerType)) {
      this.triggerIndex.set(triggerType, new Set());
    }
    this.triggerIndex.get(triggerType).add(composition.id);

    return composition;
  }

  unregister(compositionId) {
    const composition = this.compositions.get(compositionId);
    if (composition) {
      const triggerType = composition.trigger.type;
      const triggerSet = this.triggerIndex.get(triggerType);
      if (triggerSet) {
        triggerSet.delete(compositionId);
      }
      this.compositions.delete(compositionId);
      return true;
    }
    return false;
  }

  get(compositionId) {
    return this.compositions.get(compositionId);
  }

  getByTriggerType(triggerType) {
    const ids = this.triggerIndex.get(triggerType);
    if (!ids) return [];
    return Array.from(ids).map(id => this.compositions.get(id)).filter(Boolean);
  }

  findMatchingCompositions(input, triggerType = null) {
    const candidates = triggerType 
      ? this.getByTriggerType(triggerType)
      : Array.from(this.compositions.values());

    const matches = [];
    for (const comp of candidates) {
      if (comp.status !== CompositionStatus.ENABLED) {
        continue;
      }
      const matchResult = comp.shouldTrigger(input);
      if (matchResult.matched) {
        matches.push({ composition: comp, matchResult });
      }
    }

    matches.sort((a, b) => b.composition.priority - a.composition.priority);
    return matches;
  }

  getEnabled() {
    return Array.from(this.compositions.values())
      .filter(c => c.status === CompositionStatus.ENABLED);
  }

  getAll() {
    return Array.from(this.compositions.values());
  }

  validateAll(capabilityRegistry) {
    const results = {};
    for (const comp of this.compositions.values()) {
      const errors = comp.validate(capabilityRegistry);
      if (errors.length > 0) {
        results[comp.id] = errors;
      }
    }
    return results;
  }
}

class CompositionExecutor {
  constructor(options = {}) {
    this.compositionRegistry = options.compositionRegistry || new CompositionRegistry();
    this.pipelineExecutor = options.pipelineExecutor || new PipelineExecutor(options);
    this.capabilityRegistry = options.capabilityRegistry;
  }

  async execute(compositionId, context = {}) {
    const composition = this.compositionRegistry.get(compositionId);
    if (!composition) {
      throw new Error(`Composition not found: ${compositionId}`);
    }

    return this.pipelineExecutor.execute(composition, context);
  }

  async executeByTrigger(input, triggerType = null) {
    const matches = this.compositionRegistry.findMatchingCompositions(input, triggerType);
    
    if (matches.length === 0) {
      return null;
    }

    const { composition, matchResult } = matches[0];
    const params = composition.trigger.extractParams(input, matchResult);
    const context = { ...params, input };

    return this.pipelineExecutor.execute(composition, context);
  }

  async executeAllMatches(input, triggerType = null) {
    const matches = this.compositionRegistry.findMatchingCompositions(input, triggerType);
    const results = [];

    for (const { composition, matchResult } of matches) {
      const params = composition.trigger.extractParams(input, matchResult);
      const context = { ...params, input };
      const result = await this.pipelineExecutor.execute(composition, context);
      results.push({ composition, result });
    }

    return results;
  }
}

class CompositionBuilder {
  constructor() {
    this.definition = {
      pipeline: []
    };
  }

  withId(id) {
    this.definition.id = id;
    return this;
  }

  withName(name) {
    this.definition.name = name;
    return this;
  }

  withDescription(desc) {
    this.definition.description = desc;
    return this;
  }

  withTrigger(trigger) {
    this.definition.trigger = trigger instanceof Trigger ? trigger : new Trigger(trigger);
    return this;
  }

  commandTrigger(pattern) {
    this.definition.trigger = new Trigger({
      type: TriggerType.COMMAND,
      pattern
    });
    return this;
  }

  eventTrigger(topic) {
    this.definition.trigger = new Trigger({
      type: TriggerType.EVENT,
      topic
    });
    return this;
  }

  scheduleTrigger(schedule) {
    this.definition.trigger = new Trigger({
      type: TriggerType.SCHEDULE,
      schedule
    });
    return this;
  }

  addStep(capabilityId, options = {}) {
    this.definition.pipeline.push({
      capabilityId,
      ...options
    });
    return this;
  }

  withPipeline(steps) {
    this.definition.pipeline = steps;
    return this;
  }

  withFallback(pipeline) {
    this.definition.fallbackPipeline = pipeline;
    return this;
  }

  withPriority(priority) {
    this.definition.priority = priority;
    return this;
  }

  withTimeout(timeout) {
    this.definition.timeout = timeout;
    return this;
  }

  withMetadata(metadata) {
    this.definition.metadata = metadata;
    return this;
  }

  build() {
    return new CapabilityComposition(this.definition);
  }
}

const defaultCompositions = [
  {
    id: 'time-announce',
    name: '报时功能',
    description: '播报当前时间',
    trigger: {
      type: TriggerType.COMMAND,
      pattern: '^(报时|现在几点|几点了)$'
    },
    pipeline: [
      {
        capabilityId: 'time-parser',
        inputMapping: { static: { expression: '现在' } },
        outputMapping: { toContext: 'parsedTime' }
      },
      {
        capabilityId: 'voice-broadcast',
        inputMapping: { fromContext: ['parsedTime.formatted'] },
        outputMapping: { toContext: 'broadcastResult' }
      },
      {
        capabilityId: 'display-text',
        inputMapping: { fromContext: ['parsedTime.formatted'] },
        onError: 'skip'
      }
    ],
    status: CompositionStatus.ENABLED,
    priority: 10
  },
  {
    id: 'weather-announce',
    name: '天气播报',
    description: '获取并播报天气信息',
    trigger: {
      type: TriggerType.COMMAND,
      pattern: '^(天气|今天天气|查询天气)$'
    },
    pipeline: [
      {
        capabilityId: 'weather-fetch',
        inputMapping: { static: { location: 'auto' } },
        outputMapping: { toContext: 'weatherData' }
      },
      {
        capabilityId: 'voice-broadcast',
        inputMapping: { fromContext: ['weatherData.text'] }
      },
      {
        capabilityId: 'display-text',
        inputMapping: { fromContext: ['weatherData.text'] },
        onError: 'skip'
      }
    ],
    status: CompositionStatus.ENABLED,
    priority: 10
  },
  {
    id: 'play-media',
    name: '播放媒体',
    description: '搜索并播放媒体文件',
    trigger: {
      type: TriggerType.COMMAND,
      pattern: '^播放(.+)$'
    },
    pipeline: [
      {
        capabilityId: 'media-search',
        inputMapping: { fromContext: ['match[0]'] },
        outputMapping: { toContext: 'searchResults' }
      },
      {
        capabilityId: 'media-play',
        inputMapping: { fromContext: ['searchResults[0]'] }
      }
    ],
    status: CompositionStatus.ENABLED,
    priority: 20
  },
  {
    id: 'reminder-announce',
    name: '提醒播报',
    description: '触发提醒时播报内容',
    trigger: {
      type: TriggerType.EVENT,
      topic: 'reminder.triggered'
    },
    pipeline: [
      {
        capabilityId: 'reminder-get',
        inputMapping: { fromContext: ['event.reminderId'] },
        outputMapping: { toContext: 'reminderData' }
      },
      {
        capabilityId: 'voice-broadcast',
        inputMapping: { 
          fromContext: ['reminderData.content'],
          transform: 'formatReminder'
        }
      }
    ],
    status: CompositionStatus.ENABLED,
    priority: 30
  }
];

function initDefaultCompositions(registry) {
  for (const compData of defaultCompositions) {
    if (!registry.get(compData.id)) {
      registry.register(new CapabilityComposition(compData));
    }
  }
  registry.save();
}

module.exports = {
  TriggerType,
  CompositionStatus,
  Trigger,
  CapabilityComposition,
  CompositionRegistry,
  CompositionExecutor,
  CompositionBuilder,
  PipelineStep,
  defaultCompositions,
  initDefaultCompositions
};
