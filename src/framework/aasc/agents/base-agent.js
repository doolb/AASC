class BaseAgent {
    constructor(options = {}) {
        this.name = options.name || 'base-agent';
        this.description = options.description || '';
        this.capabilities = options.capabilities || [];
        this.dependencies = options.dependencies || [];
        
        this._initialized = false;
        this._config = options.config || {};
    }

    get config() {
        return this._config;
    }

    set config(value) {
        this._config = { ...this._config, ...value };
    }

    async init() {
        if (this._initialized) {
            return this;
        }

        await this.onInit();
        this._initialized = true;
        
        return this;
    }

    async onInit() {
    }

    async destroy() {
        await this.onDestroy();
        this._initialized = false;
    }

    async onDestroy() {
    }

    async execute(action, params, context) {
        if (!this._initialized) {
            await this.init();
        }

        const handler = this[action];
        if (typeof handler !== 'function') {
            throw new Error(`Agent ${this.name} 不支持操作: ${action}`);
        }

        return await handler.call(this, params, context);
    }

    hasCapability(capabilityId) {
        return this.capabilities.some(cap => 
            cap.id === capabilityId || cap === capabilityId
        );
    }

    getInfo() {
        return {
            name: this.name,
            description: this.description,
            capabilities: this.capabilities,
            dependencies: this.dependencies,
            initialized: this._initialized
        };
    }
}

class AgentBuilder {
    constructor() {
        this._name = 'anonymous-agent';
        this._description = '';
        this._capabilities = [];
        this._dependencies = [];
        this._config = {};
        this._methods = {};
    }

    withName(name) {
        this._name = name;
        return this;
    }

    withDescription(description) {
        this._description = description;
        return this;
    }

    withCapabilities(capabilities) {
        this._capabilities = capabilities;
        return this;
    }

    withDependencies(dependencies) {
        this._dependencies = dependencies;
        return this;
    }

    withConfig(config) {
        this._config = config;
        return this;
    }

    withMethod(name, handler) {
        this._methods[name] = handler;
        return this;
    }

    build() {
        const self = this;
        
        const AgentClass = class extends BaseAgent {
            constructor(options = {}) {
                super({
                    name: self._name,
                    description: self._description,
                    capabilities: self._capabilities,
                    dependencies: self._dependencies,
                    config: { ...self._config, ...options.config },
                    ...options
                });

                for (const [methodName, handler] of Object.entries(self._methods)) {
                    this[methodName] = handler.bind(this);
                }
            }
        };

        return new AgentClass();
    }
}

module.exports = { BaseAgent, AgentBuilder };
