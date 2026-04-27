const { CapabilityRegistry } = require('./capability');
const { getBus } = require('./message-bus');

const PipelineStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

const StepErrorStrategy = {
  FAIL: 'fail',
  SKIP: 'skip',
  RETRY: 'retry',
  FALLBACK: 'fallback'
};

class PipelineContext {
  constructor(initialData = {}) {
    this.data = { ...initialData };
    this.results = {};
    this.errors = [];
    this.metadata = {
      startTime: null,
      endTime: null,
      currentStep: null
    };
  }

  set(key, value) {
    const keys = key.split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
  }

  get(key) {
    const keys = key.split('.');
    let value = this.data;
    for (const k of keys) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[k];
    }
    return value;
  }

  setStepResult(stepId, result) {
    this.results[stepId] = result;
  }

  getStepResult(stepId) {
    return this.results[stepId];
  }

  addError(stepId, error) {
    this.errors.push({
      stepId,
      error: error.message || error,
      timestamp: Date.now()
    });
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  getLastError() {
    return this.errors[this.errors.length - 1];
  }

  toJSON() {
    return {
      data: this.data,
      results: this.results,
      errors: this.errors,
      metadata: this.metadata
    };
  }
}

class PipelineStep {
  constructor(options = {}) {
    this.id = options.id || `step_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.capabilityId = options.capabilityId || '';
    this.inputMapping = options.inputMapping || {};
    this.outputMapping = options.outputMapping || {};
    this.onError = options.onError || StepErrorStrategy.FAIL;
    this.retryCount = options.retryCount || 0;
    this.retryDelay = options.retryDelay || 1000;
    this.timeout = options.timeout || 30000;
    this.condition = options.condition || null;
    this.parallel = options.parallel || false;
    this.fallback = options.fallback || null;
  }

  resolveInput(context) {
    const input = {};

    if (this.inputMapping.static) {
      Object.assign(input, this.inputMapping.static);
    }

    if (this.inputMapping.fromContext) {
      for (const mapping of this.inputMapping.fromContext) {
        const value = this.resolveContextPath(mapping, context);
        const targetKey = this.extractTargetKey(mapping);
        input[targetKey] = value;
      }
    }

    if (this.inputMapping.transform) {
      const transformed = this.applyTransform(input, this.inputMapping.transform, context);
      Object.assign(input, transformed);
    }

    return input;
  }

  resolveContextPath(path, context) {
    const match = path.match(/^([^\[]+)(?:\[(\d+)\])?(?:\.(.+))?$/);
    if (!match) {
      return context.get(path);
    }

    const [, baseKey, index, subPath] = match;
    let value = context.get(baseKey);

    if (index !== undefined && Array.isArray(value)) {
      value = value[parseInt(index)];
    }

    if (subPath && value !== null && value !== undefined) {
      const subKeys = subPath.split('.');
      for (const key of subKeys) {
        value = value?.[key];
      }
    }

    return value;
  }

  extractTargetKey(path) {
    const parts = path.split('.');
    return parts[parts.length - 1].replace(/\[\d+\]/g, '');
  }

  applyTransform(input, transformName, context) {
    switch (transformName) {
      case 'formatReminder':
        return { formatted: `提醒：${input.content || input}` };
      case 'formatTime':
        return { formatted: `现在是${input.formatted || input}` };
      case 'formatWeather':
        return { formatted: `天气：${input.text || input}` };
      default:
        return input;
    }
  }

  applyOutputMapping(result, context) {
    if (!this.outputMapping || !result) {
      return;
    }

    if (this.outputMapping.toContext) {
      context.set(this.outputMapping.toContext, result);
    }

    if (this.outputMapping.toContextFields) {
      for (const [field, contextPath] of Object.entries(this.outputMapping.toContextFields)) {
        const value = result[field];
        if (value !== undefined) {
          context.set(contextPath, value);
        }
      }
    }
  }

  shouldExecute(context) {
    if (!this.condition) {
      return true;
    }

    if (typeof this.condition === 'function') {
      return this.condition(context);
    }

    if (typeof this.condition === 'string') {
      const value = context.get(this.condition);
      return !!value;
    }

    return true;
  }

  toJSON() {
    return {
      id: this.id,
      capabilityId: this.capabilityId,
      inputMapping: this.inputMapping,
      outputMapping: this.outputMapping,
      onError: this.onError,
      retryCount: this.retryCount,
      timeout: this.timeout,
      condition: this.condition
    };
  }
}

class PipelineExecutor {
  constructor(options = {}) {
    this.capabilityRegistry = options.capabilityRegistry || new CapabilityRegistry();
    this.messageBus = options.messageBus || getBus();
    this.actorRegistry = options.actorRegistry || null;
    this.transformers = new Map();
    this.stepExecutors = new Map();
  }

  registerTransformer(name, fn) {
    this.transformers.set(name, fn);
  }

  registerStepExecutor(capabilityId, executor) {
    this.stepExecutors.set(capabilityId, executor);
  }

  async execute(composition, initialContext = {}) {
    const context = new PipelineContext(initialContext);
    context.metadata.startTime = Date.now();

    const result = {
      compositionId: composition.id,
      status: PipelineStatus.RUNNING,
      steps: [],
      context: context.toJSON(),
      startTime: context.metadata.startTime
    };

    try {
      const steps = this.resolveSteps(composition);
      
      for (const step of steps) {
        context.metadata.currentStep = step.id;

        if (!step.shouldExecute(context)) {
          result.steps.push({
            stepId: step.id,
            status: 'skipped',
            reason: 'condition_not_met'
          });
          continue;
        }

        const stepResult = await this.executeStep(step, context);
        result.steps.push(stepResult);

        if (stepResult.status === 'failed') {
          if (step.onError === StepErrorStrategy.FAIL) {
            result.status = PipelineStatus.FAILED;
            result.error = stepResult.error;
            break;
          } else if (step.onError === StepErrorStrategy.FALLBACK && step.fallback) {
            const fallbackResult = await this.executeFallback(step.fallback, context);
            result.steps.push(fallbackResult);
          }
        }
      }

      if (result.status === PipelineStatus.RUNNING) {
        result.status = PipelineStatus.COMPLETED;
      }
    } catch (error) {
      result.status = PipelineStatus.FAILED;
      result.error = error.message;
    }

    context.metadata.endTime = Date.now();
    result.endTime = context.metadata.endTime;
    result.duration = result.endTime - result.startTime;
    result.context = context.toJSON();

    return result;
  }

  resolveSteps(composition) {
    const steps = [];

    if (composition.pipeline) {
      for (const stepDef of composition.pipeline) {
        steps.push(new PipelineStep(stepDef));
      }
    }

    return steps;
  }

  async executeStep(step, context) {
    const stepResult = {
      stepId: step.id,
      capabilityId: step.capabilityId,
      status: 'running',
      startTime: Date.now()
    };

    let lastError = null;
    const maxRetries = step.retryCount + 1;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const input = step.resolveInput(context);
        const output = await this.executeCapability(step.capabilityId, input, step.timeout);
        
        step.applyOutputMapping(output, context);
        context.setStepResult(step.id, output);

        stepResult.status = 'success';
        stepResult.output = output;
        stepResult.attempts = attempt + 1;
        return stepResult;
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries - 1) {
          await this.delay(step.retryDelay);
        }
      }
    }

    stepResult.status = 'failed';
    stepResult.error = lastError?.message || 'Unknown error';
    stepResult.attempts = maxRetries;
    context.addError(step.id, lastError);

    return stepResult;
  }

  async executeCapability(capabilityId, input, timeout = 30000) {
    const customExecutor = this.stepExecutors.get(capabilityId);
    if (customExecutor) {
      return customExecutor(input);
    }

    const capability = this.capabilityRegistry.resolve(capabilityId);
    if (!capability) {
      throw new Error(`Capability not found: ${capabilityId}`);
    }

    const actors = this.findActorsWithCapability(capabilityId);
    if (actors.length === 0) {
      throw new Error(`No actor available for capability: ${capabilityId}`);
    }

    const actor = actors[0];
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Capability execution timeout: ${capabilityId}`));
      }, timeout);

      this.messageBus.send(actor.address, {
        type: 'command',
        topic: `capability.${capabilityId}`,
        payload: input
      }).then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      }).catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  findActorsWithCapability(capabilityId) {
    if (!this.actorRegistry) {
      return this.messageBus.getActorsByCapability(capabilityId);
    }
    return this.actorRegistry.getByCapability(capabilityId);
  }

  async executeFallback(fallbackDef, context) {
    const fallbackStep = new PipelineStep(fallbackDef);
    return this.executeStep(fallbackStep, context);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async executeParallel(steps, context) {
    const promises = steps.map(step => this.executeStep(step, context));
    return Promise.all(promises);
  }
}

class PipelineBuilder {
  constructor() {
    this.steps = [];
    this.currentId = 1;
  }

  step(capabilityId, options = {}) {
    this.steps.push(new PipelineStep({
      id: `step_${this.currentId++}`,
      capabilityId,
      ...options
    }));
    return this;
  }

  withInput(mapping) {
    if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].inputMapping = mapping;
    }
    return this;
  }

  withOutput(mapping) {
    if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].outputMapping = mapping;
    }
    return this;
  }

  onError(strategy) {
    if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].onError = strategy;
    }
    return this;
  }

  withRetry(count, delay = 1000) {
    if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].retryCount = count;
      this.steps[this.steps.length - 1].retryDelay = delay;
    }
    return this;
  }

  withCondition(condition) {
    if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].condition = condition;
    }
    return this;
  }

  build() {
    return this.steps;
  }
}

module.exports = {
  PipelineStatus,
  StepErrorStrategy,
  PipelineContext,
  PipelineStep,
  PipelineExecutor,
  PipelineBuilder
};
