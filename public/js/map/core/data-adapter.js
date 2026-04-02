import { BuildingData, ActorData, MapData } from './map-data.js';
import { BuildingType, BuildingSize, LevelSizeMap, StatusColors, ActorStatus } from './constants.js';

class DataAdapter {
  constructor(options = {}) {
    this.buildingPositions = new Map();
    this.canvasSize = options.canvasSize || { width: 800, height: 600 };
    this.centerOffset = options.centerOffset || { x: 0, y: 0 };
  }

  setCanvasSize(width, height) {
    this.canvasSize = { width, height };
    this.buildingPositions.clear();
  }

  adaptActorRegistry(registryData) {
    const mapData = new MapData();
    
    if (!registryData || !registryData.actors) {
      return mapData;
    }

    const buildingMap = new Map();
    
    for (const actorData of registryData.actors) {
      const buildingId = this.getBuildingId(actorData.address);
      
      if (!buildingMap.has(buildingId)) {
        const building = this.createBuildingFromActor(actorData);
        buildingMap.set(buildingId, building);
      }
      
      const actor = this.adaptActor(actorData, buildingId);
      buildingMap.get(buildingId).actors.push(actor);
      mapData.addActor(actor);
    }

    const buildings = Array.from(buildingMap.values());
    this.calculateBuildingPositions(buildings);
    
    for (const building of buildings) {
      this.assignActorPositions(building);
      mapData.addBuilding(building);
    }

    return mapData;
  }

  adaptActor(actorData, buildingId) {
    const actor = new ActorData({
      id: this.getActorId(actorData.address),
      name: actorData.address.name || actorData.name || 'Unknown',
      address: {
        ip: actorData.address.ip || '',
        role: actorData.address.role || 'server',
        name: actorData.address.name || ''
      },
      status: actorData.status || ActorStatus.OFFLINE,
      capabilities: this.adaptCapabilities(actorData.capabilities),
      buildingId: buildingId,
      metadata: actorData.metadata || {}
    });
    
    actor.calculateVisual();
    return actor;
  }

  adaptCapabilities(capabilities) {
    if (!capabilities || !Array.isArray(capabilities)) {
      return [];
    }
    
    return capabilities.map(cap => ({
      id: cap.id || '',
      name: cap.name || cap.id || '',
      category: cap.category || 'basic',
      level: cap.level || 1
    }));
  }

  getBuildingId(address) {
    if (!address) return 'unknown';
    return `${address.role || 'server'}-${address.ip || 'unknown'}`;
  }

  getActorId(address) {
    if (!address) return 'unknown';
    return `${address.ip || 'unknown'}-${address.role || 'server'}-${address.name || 'unknown'}`;
  }

  createBuildingFromActor(actorData) {
    const address = actorData.address;
    const type = this.getBuildingType(address.role);
    
    return new BuildingData({
      id: this.getBuildingId(address),
      type: type,
      name: this.getBuildingName(address, type),
      status: this.getBuildingStatus(actorData.status),
      size: { ...BuildingSize[type] },
      metadata: {
        ip: address.ip || '',
        lastHeartbeat: actorData.lastHeartbeat || 0,
        resources: actorData.metadata?.resources || {}
      },
      actors: []
    });
  }

  getBuildingType(role) {
    switch (role) {
      case 'display':
        return BuildingType.DISPLAY;
      case 'control':
        return BuildingType.CONTROL;
      default:
        return BuildingType.SERVER;
    }
  }

  getBuildingName(address, type) {
    const typeNames = {
      server: '服务器',
      display: '显示端',
      control: '控制端'
    };
    return `${typeNames[type] || '设备'} ${address.name || address.ip || 'Unknown'}`;
  }

  getBuildingStatus(actorStatus) {
    switch (actorStatus) {
      case ActorStatus.READY:
        return 'online';
      case ActorStatus.BUSY:
        return 'busy';
      case ActorStatus.OFFLINE:
        return 'offline';
      default:
        return 'online';
    }
  }

  calculateBuildingPositions(buildings) {
    const centerX = this.canvasSize.width / 2 + this.centerOffset.x;
    const centerY = this.canvasSize.height / 2 + this.centerOffset.y;
    
    const servers = buildings.filter(b => b.type === BuildingType.SERVER);
    const displays = buildings.filter(b => b.type === BuildingType.DISPLAY);
    const controls = buildings.filter(b => b.type === BuildingType.CONTROL);
    
    servers.forEach((building, index) => {
      const total = servers.length;
      if (total === 1) {
        building.position = { x: centerX, y: centerY };
      } else {
        const spacing = 180;
        const startX = centerX - (total - 1) * spacing / 2;
        building.position = { x: startX + index * spacing, y: centerY };
      }
    });
    
    displays.forEach((building, index) => {
      const total = displays.length;
      const radius = 200;
      const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
      building.position = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      };
    });
    
    controls.forEach((building, index) => {
      const total = controls.length;
      const radius = 320;
      const angle = (index / total) * Math.PI * 2;
      building.position = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      };
    });
  }

  assignActorPositions(building) {
    const actors = building.actors;
    if (actors.length === 0) return;
    
    const padding = 10;
    const startX = -building.size.width / 2 + padding;
    const startY = building.size.height / 2 + padding + 5;
    
    actors.forEach((actor, index) => {
      const spacing = actor.visual.size + 8;
      const row = Math.floor(index / 4);
      const col = index % 4;
      
      actor.localPosition = {
        x: startX + col * spacing + actor.visual.size / 2,
        y: startY + row * spacing + actor.visual.size / 2
      };
    });
  }

  adaptDisplayClients(displayClients, serverIP) {
    const buildings = [];
    
    if (serverIP) {
      buildings.push(new BuildingData({
        id: `server-${serverIP}`,
        type: BuildingType.SERVER,
        name: `服务器 ${serverIP}`,
        status: 'online',
        position: { x: this.canvasSize.width / 2, y: this.canvasSize.height / 2 },
        size: BuildingSize.server,
        metadata: { ip: serverIP },
        actors: []
      }));
    }
    
    displayClients.forEach((state, displayId) => {
      const building = new BuildingData({
        id: `display-${displayId}`,
        type: BuildingType.DISPLAY,
        name: `显示端 ${displayId}`,
        status: 'online',
        size: BuildingSize.display,
        metadata: {
          browserInfo: state.browserInfo
        },
        actors: []
      });
      buildings.push(building);
    });
    
    this.calculateBuildingPositions(buildings);
    
    const mapData = new MapData();
    buildings.forEach(b => mapData.addBuilding(b));
    
    return mapData;
  }
}

export default DataAdapter;
