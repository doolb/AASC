const { ActorAddress } = require('./message');
const { ActorStatus, CapabilityCategory } = require('./actor');

const CapabilityLevel = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
  L5: 5
};

const SecurityLevel = {
  PUBLIC: 0,
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
  TOP_SECRET: 5
};

class Capability {
  constructor(options = {}) {
    this.id = options.id || '';
    this.name = options.name || '';
    this.category = options.category || CapabilityCategory.BASIC;
    this.level = options.level || CapabilityLevel.L1;
    this.securityLevel = options.securityLevel || SecurityLevel.PUBLIC;
    this.description = options.description || '';
    this.inputSchema = options.inputSchema || null;
    this.outputSchema = options.outputSchema || null;
    this.dependencies = options.dependencies || [];
    this.inherits = options.inherits || [];
    this.config = options.config || {};
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
      config: this.config
    };
  }

  static fromJSON(json) {
    return new Capability(json);
  }
}

class ActorRegistration {
  constructor(options = {}) {
    this.address = options.address instanceof ActorAddress 
      ? options.address 
      : ActorAddress.fromJSON(options.address);
    this.capabilities = (options.capabilities || []).map(c => 
      c instanceof Capability ? c : Capability.fromJSON(c)
    );
    this.status = options.status || ActorStatus.INITIALIZING;
    this.registeredAt = options.registeredAt || Date.now();
    this.lastHeartbeat = options.lastHeartbeat || Date.now();
    this.metadata = options.metadata || {
      version: '1.0.0',
      platform: 'node',
      resources: {}
    };
  }

  updateHeartbeat() {
    this.lastHeartbeat = Date.now();
    if (this.status === ActorStatus.DEGRADED) {
      this.status = ActorStatus.READY;
    }
  }

  isHealthy(timeout = 30000) {
    return Date.now() - this.lastHeartbeat < timeout;
  }

  hasCapability(capabilityId) {
    return this.capabilities.some(c => c.id === capabilityId);
  }

  getCapability(capabilityId) {
    return this.capabilities.find(c => c.id === capabilityId);
  }

  getMaxCapabilityLevel() {
    if (this.capabilities.length === 0) return 0;
    return Math.max(...this.capabilities.map(c => c.level));
  }

  toJSON() {
    return {
      address: this.address.toJSON(),
      capabilities: this.capabilities.map(c => c.toJSON()),
      status: this.status,
      registeredAt: this.registeredAt,
      lastHeartbeat: this.lastHeartbeat,
      metadata: this.metadata
    };
  }

  static fromJSON(json) {
    return new ActorRegistration(json);
  }
}

class ActorRegistry {
  constructor() {
    this.actors = new Map();
    this.capabilityIndex = new Map();
    this.roleIndex = new Map();
  }

  register(registration) {
    if (!(registration instanceof ActorRegistration)) {
      registration = new ActorRegistration(registration);
    }

    const addressKey = registration.address.toString();

    if (this.actors.has(addressKey)) {
      console.warn(`[ActorRegistry] Actor already registered: ${addressKey}`);
      return false;
    }

    this.actors.set(addressKey, registration);

    for (const cap of registration.capabilities) {
      if (!this.capabilityIndex.has(cap.id)) {
        this.capabilityIndex.set(cap.id, new Set());
      }
      this.capabilityIndex.get(cap.id).add(addressKey);
    }

    const role = registration.address.role;
    if (!this.roleIndex.has(role)) {
      this.roleIndex.set(role, new Set());
    }
    this.roleIndex.get(role).add(addressKey);

    console.log(`[ActorRegistry] Actor registered: ${addressKey}`);
    return true;
  }

  unregister(address) {
    const addressKey = address.toString();
    const registration = this.actors.get(addressKey);

    if (!registration) {
      console.warn(`[ActorRegistry] Actor not found: ${addressKey}`);
      return false;
    }

    for (const cap of registration.capabilities) {
      const capSet = this.capabilityIndex.get(cap.id);
      if (capSet) {
        capSet.delete(addressKey);
        if (capSet.size === 0) {
          this.capabilityIndex.delete(cap.id);
        }
      }
    }

    const role = registration.address.role;
    const roleSet = this.roleIndex.get(role);
    if (roleSet) {
      roleSet.delete(addressKey);
      if (roleSet.size === 0) {
        this.roleIndex.delete(role);
      }
    }

    this.actors.delete(addressKey);
    console.log(`[ActorRegistry] Actor unregistered: ${addressKey}`);
    return true;
  }

  get(address) {
    return this.actors.get(address.toString());
  }

  getByRole(role) {
    const keys = this.roleIndex.get(role);
    if (!keys) return [];
    return Array.from(keys).map(k => this.actors.get(k)).filter(Boolean);
  }

  getByCapability(capabilityId) {
    const keys = this.capabilityIndex.get(capabilityId);
    if (!keys) return [];
    return Array.from(keys).map(k => this.actors.get(k)).filter(Boolean);
  }

  getByCapabilityLevel(minLevel, maxLevel = CapabilityLevel.L5) {
    const result = [];
    for (const actor of this.actors.values()) {
      const maxCapLevel = actor.getMaxCapabilityLevel();
      if (maxCapLevel >= minLevel && maxCapLevel <= maxLevel) {
        result.push(actor);
      }
    }
    return result;
  }

  getAll() {
    return Array.from(this.actors.values());
  }

  updateHeartbeat(address) {
    const registration = this.actors.get(address.toString());
    if (registration) {
      registration.updateHeartbeat();
      return true;
    }
    return false;
  }

  checkHealth(timeout = 30000) {
    const unhealthy = [];
    const now = Date.now();

    for (const [key, registration] of this.actors) {
      if (now - registration.lastHeartbeat > timeout) {
        registration.status = ActorStatus.DEGRADED;
        unhealthy.push(key);
      }
    }

    return unhealthy;
  }

  cleanup(timeout = 60000) {
    const toRemove = [];
    const now = Date.now();

    for (const [key, registration] of this.actors) {
      if (now - registration.lastHeartbeat > timeout) {
        toRemove.push(registration.address);
      }
    }

    for (const address of toRemove) {
      this.unregister(address);
    }

    return toRemove.length;
  }

  getStats() {
    const stats = {
      totalActors: this.actors.size,
      byRole: {},
      byStatus: {},
      byCapabilityLevel: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      capabilities: this.capabilityIndex.size
    };

    for (const actor of this.actors.values()) {
      const role = actor.address.role;
      stats.byRole[role] = (stats.byRole[role] || 0) + 1;

      stats.byStatus[actor.status] = (stats.byStatus[actor.status] || 0) + 1;

      const maxLevel = actor.getMaxCapabilityLevel();
      if (maxLevel > 0) {
        stats.byCapabilityLevel[maxLevel]++;
      }
    }

    return stats;
  }

  export() {
    return {
      actors: Array.from(this.actors.values()).map(a => a.toJSON()),
      exportedAt: Date.now()
    };
  }

  import(data) {
    if (data.actors) {
      for (const actorData of data.actors) {
        this.register(ActorRegistration.fromJSON(actorData));
      }
    }
  }
}

module.exports = {
  Capability,
  CapabilityLevel,
  SecurityLevel,
  ActorRegistration,
  ActorRegistry
};
