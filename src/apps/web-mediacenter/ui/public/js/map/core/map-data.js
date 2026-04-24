import { ActorStatus, LevelSizeMap, StatusColors, CapabilityCategory, AccessoryIcons } from './constants.js';

class BuildingData {
  constructor(options = {}) {
    this.id = options.id || '';
    this.type = options.type || 'server';
    this.name = options.name || '';
    this.status = options.status || 'offline';
    this.position = options.position || { x: 0, y: 0 };
    this.size = options.size || { width: 100, height: 80 };
    this.metadata = options.metadata || {
      ip: '',
      lastHeartbeat: 0,
      resources: {}
    };
    this.actors = options.actors || [];
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      status: this.status,
      position: this.position,
      size: this.size,
      metadata: this.metadata,
      actors: this.actors.map(a => a.toJSON ? a.toJSON() : a)
    };
  }

  static fromJSON(json) {
    return new BuildingData({
      ...json,
      actors: json.actors ? json.actors.map(a => ActorData.fromJSON(a)) : []
    });
  }
}

class ActorData {
  constructor(options = {}) {
    this.id = options.id || '';
    this.name = options.name || '';
    this.address = options.address || { ip: '', role: '', name: '' };
    this.status = options.status || ActorStatus.OFFLINE;
    this.capabilities = options.capabilities || [];
    this.maxLevel = options.maxLevel || 1;
    this.visual = options.visual || {
      size: LevelSizeMap[1],
      color: '#95a5a6',
      accessories: []
    };
    this.buildingId = options.buildingId || '';
    this.localPosition = options.localPosition || { x: 0, y: 0 };
  }

  calculateVisual() {
    const maxLevel = this.capabilities.length > 0
      ? Math.max(...this.capabilities.map(c => c.level || 1))
      : 1;
    this.maxLevel = maxLevel;
    this.visual.size = LevelSizeMap[maxLevel] || LevelSizeMap[1];
    
    const statusColor = StatusColors[this.status];
    this.visual.color = statusColor ? `#${statusColor.toString(16).padStart(6, '0')}` : '#95a5a6';
    
    this.visual.accessories = [];
    const categories = new Set(this.capabilities.map(c => c.category));
    if (categories.has(CapabilityCategory.BASIC)) {
      this.visual.accessories.push(AccessoryIcons.basic);
    }
    if (categories.has(CapabilityCategory.PROFESSIONAL)) {
      this.visual.accessories.push(AccessoryIcons.professional);
    }
    if (categories.has(CapabilityCategory.SPECIAL)) {
      this.visual.accessories.push(AccessoryIcons.special);
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      address: this.address,
      status: this.status,
      capabilities: this.capabilities,
      maxLevel: this.maxLevel,
      visual: this.visual,
      buildingId: this.buildingId,
      localPosition: this.localPosition
    };
  }

  static fromJSON(json) {
    const actor = new ActorData(json);
    actor.calculateVisual();
    return actor;
  }
}

class ConnectionData {
  constructor(options = {}) {
    this.id = options.id || '';
    this.sourceId = options.sourceId || '';
    this.targetId = options.targetId || '';
    this.type = options.type || 'inactive';
    this.messageCount = options.messageCount || 0;
  }

  toJSON() {
    return {
      id: this.id,
      sourceId: this.sourceId,
      targetId: this.targetId,
      type: this.type,
      messageCount: this.messageCount
    };
  }

  static fromJSON(json) {
    return new ConnectionData(json);
  }
}

class MapData {
  constructor(options = {}) {
    this.buildings = options.buildings || [];
    this.actors = options.actors || [];
    this.connections = options.connections || [];
    this.metadata = options.metadata || {
      updatedAt: Date.now()
    };
  }

  addBuilding(building) {
    if (!(building instanceof BuildingData)) {
      building = BuildingData.fromJSON(building);
    }
    const existing = this.buildings.findIndex(b => b.id === building.id);
    if (existing >= 0) {
      this.buildings[existing] = building;
    } else {
      this.buildings.push(building);
    }
    this.metadata.updatedAt = Date.now();
  }

  removeBuilding(id) {
    const index = this.buildings.findIndex(b => b.id === id);
    if (index >= 0) {
      this.buildings.splice(index, 1);
      this.actors = this.actors.filter(a => a.buildingId !== id);
      this.metadata.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  getBuilding(id) {
    return this.buildings.find(b => b.id === id);
  }

  addActor(actor) {
    if (!(actor instanceof ActorData)) {
      actor = ActorData.fromJSON(actor);
    }
    const existing = this.actors.findIndex(a => a.id === actor.id);
    if (existing >= 0) {
      this.actors[existing] = actor;
    } else {
      this.actors.push(actor);
    }
    
    const building = this.getBuilding(actor.buildingId);
    if (building) {
      const actorInBuilding = building.actors.find(a => a.id === actor.id);
      if (!actorInBuilding) {
        building.actors.push(actor);
      }
    }
    
    this.metadata.updatedAt = Date.now();
  }

  removeActor(id) {
    const index = this.actors.findIndex(a => a.id === id);
    if (index >= 0) {
      const actor = this.actors[index];
      const building = this.getBuilding(actor.buildingId);
      if (building) {
        building.actors = building.actors.filter(a => a.id !== id);
      }
      this.actors.splice(index, 1);
      this.metadata.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  getActor(id) {
    return this.actors.find(a => a.id === id);
  }

  updateActorStatus(id, status) {
    const actor = this.getActor(id);
    if (actor) {
      actor.status = status;
      actor.calculateVisual();
      this.metadata.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  updateBuildingStatus(id, status) {
    const building = this.getBuilding(id);
    if (building) {
      building.status = status;
      this.metadata.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  addConnection(connection) {
    if (!(connection instanceof ConnectionData)) {
      connection = ConnectionData.fromJSON(connection);
    }
    const existing = this.connections.findIndex(c => c.id === connection.id);
    if (existing >= 0) {
      this.connections[existing] = connection;
    } else {
      this.connections.push(connection);
    }
    this.metadata.updatedAt = Date.now();
  }

  toJSON() {
    return {
      buildings: this.buildings.map(b => b.toJSON()),
      actors: this.actors.map(a => a.toJSON()),
      connections: this.connections.map(c => c.toJSON()),
      metadata: this.metadata
    };
  }

  static fromJSON(json) {
    return new MapData({
      buildings: json.buildings ? json.buildings.map(b => BuildingData.fromJSON(b)) : [],
      actors: json.actors ? json.actors.map(a => ActorData.fromJSON(a)) : [],
      connections: json.connections ? json.connections.map(c => ConnectionData.fromJSON(c)) : [],
      metadata: json.metadata || { updatedAt: Date.now() }
    });
  }
}

export {
  BuildingData,
  ActorData,
  ConnectionData,
  MapData
};
