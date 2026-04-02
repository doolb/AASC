const { IRenderer, RendererEvents } = require('./i-renderer');
const BuildingSprite = require('../sprites/building-sprite');
const ActorSprite = require('../sprites/actor-sprite');

class RendererPixi extends IRenderer {
  constructor(options = {}) {
    super();
    this.options = {
      backgroundColor: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      ...options
    };
    
    this.app = null;
    this.stage = null;
    this.buildingLayer = null;
    this.actorLayer = null;
    this.connectionLayer = null;
    
    this.buildingSprites = new Map();
    this.actorSprites = new Map();
    
    this.data = null;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.panStart = { x: 0, y: 0 };
  }

  async init(container) {
    const PIXI = await import('pixi.js');
    this.PIXI = PIXI;
    
    this.app = new PIXI.Application({
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: this.options.backgroundColor,
      antialias: this.options.antialias,
      resolution: this.options.resolution,
      autoDensity: true
    });
    
    container.appendChild(this.app.view);
    
    this.stage = this.app.stage;
    this.stage.sortableChildren = true;
    
    this.connectionLayer = new PIXI.Container();
    this.connectionLayer.zIndex = 0;
    this.stage.addChild(this.connectionLayer);
    
    this.buildingLayer = new PIXI.Container();
    this.buildingLayer.zIndex = 1;
    this.stage.addChild(this.buildingLayer);
    
    this.actorLayer = new PIXI.Container();
    this.actorLayer.zIndex = 2;
    this.stage.addChild(this.actorLayer);
    
    this.setupInteraction();
    
    this.emit(RendererEvents.READY);
    
    return this;
  }

  setupInteraction() {
    if (!this.app || !this.stage) return;
    
    this.app.view.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
    
    this.stage.eventMode = 'static';
    this.stage.hitArea = this.app.screen;
    
    this.stage.on('pointerdown', (e) => {
      if (e.target === this.stage) {
        this.isDragging = true;
        this.dragStart = { x: e.global.x, y: e.global.y };
        this.panStart = { ...this.pan };
        this.app.view.style.cursor = 'grabbing';
      }
    });
    
    this.stage.on('pointermove', (e) => {
      if (this.isDragging) {
        const dx = e.global.x - this.dragStart.x;
        const dy = e.global.y - this.dragStart.y;
        this.pan.x = this.panStart.x + dx;
        this.pan.y = this.panStart.y + dy;
        this.updateTransform();
      }
    });
    
    this.stage.on('pointerup', () => {
      this.isDragging = false;
      this.app.view.style.cursor = 'default';
    });
    
    this.stage.on('pointerupoutside', () => {
      this.isDragging = false;
      this.app.view.style.cursor = 'default';
    });
  }

  handleWheel(e) {
    e.preventDefault();
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.5, Math.min(3, this.zoom * delta));
    
    this.zoom = newZoom;
    this.updateTransform();
    
    this.emit(RendererEvents.VIEW_CHANGE, {
      zoom: this.zoom,
      pan: this.pan
    });
  }

  updateTransform() {
    if (!this.buildingLayer) return;
    
    this.buildingLayer.scale.set(this.zoom);
    this.buildingLayer.position.set(this.pan.x, this.pan.y);
    
    this.actorLayer.scale.set(this.zoom);
    this.actorLayer.position.set(this.pan.x, this.pan.y);
    
    this.connectionLayer.scale.set(this.zoom);
    this.connectionLayer.position.set(this.pan.x, this.pan.y);
  }

  setData(data) {
    this.data = data;
    this.clearAll();
    
    if (data.buildings) {
      data.buildings.forEach(building => this.addBuilding(building));
    }
    
    if (data.actors) {
      data.actors.forEach(actor => this.addActor(actor));
    }
    
    if (data.connections) {
      data.connections.forEach(conn => this.addConnection(conn));
    }
  }

  addBuilding(building) {
    if (this.buildingSprites.has(building.id)) {
      this.removeBuilding(building.id);
    }
    
    const sprite = new BuildingSprite(building);
    const container = sprite.create(this.PIXI);
    
    sprite.on('click', (data) => {
      this.emit(RendererEvents.BUILDING_CLICK, data);
    });
    
    sprite.on('hover', (data) => {
      this.emit(RendererEvents.BUILDING_HOVER, data);
    });
    
    this.buildingLayer.addChild(container);
    this.buildingSprites.set(building.id, sprite);
    
    if (building.actors) {
      building.actors.forEach(actor => {
        this.addActor(actor);
      });
    }
  }

  removeBuilding(id) {
    const sprite = this.buildingSprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.buildingSprites.delete(id);
    }
  }

  updateBuildingStatus(id, status) {
    const sprite = this.buildingSprites.get(id);
    if (sprite) {
      sprite.updateStatus(status);
    }
  }

  addActor(actor) {
    if (this.actorSprites.has(actor.id)) {
      this.removeActor(actor.id);
    }
    
    const sprite = new ActorSprite(actor);
    const container = sprite.create(this.PIXI);
    
    sprite.on('click', (data) => {
      this.emit(RendererEvents.ACTOR_CLICK, data);
    });
    
    sprite.on('hover', (data) => {
      this.emit(RendererEvents.ACTOR_HOVER, data);
    });
    
    const buildingSprite = this.buildingSprites.get(actor.buildingId);
    if (buildingSprite) {
      buildingSprite.addActorSprite(container);
    } else {
      this.actorLayer.addChild(container);
    }
    
    this.actorSprites.set(actor.id, sprite);
  }

  removeActor(id) {
    const sprite = this.actorSprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.actorSprites.delete(id);
    }
  }

  updateActorStatus(id, status) {
    const sprite = this.actorSprites.get(id);
    if (sprite) {
      sprite.updateStatus(status);
    }
  }

  addConnection(connection) {
    const sourceBuilding = this.buildingSprites.get(connection.sourceId);
    const targetBuilding = this.buildingSprites.get(connection.targetId);
    
    if (!sourceBuilding || !targetBuilding) return;
    
    const graphics = new this.PIXI.Graphics();
    
    const source = sourceBuilding.data.position;
    const target = targetBuilding.data.position;
    
    const color = connection.type === 'active' ? 0x2ecc71 : 0x95a5a6;
    const alpha = connection.type === 'active' ? 0.6 : 0.3;
    
    graphics.lineStyle(2, color, alpha);
    graphics.moveTo(source.x, source.y);
    graphics.lineTo(target.x, target.y);
    
    if (connection.type === 'active') {
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      
      graphics.beginFill(color, 0.8);
      graphics.drawCircle(midX, midY, 4);
      graphics.endFill();
    }
    
    this.connectionLayer.addChild(graphics);
  }

  clearAll() {
    this.buildingSprites.forEach(sprite => sprite.destroy());
    this.buildingSprites.clear();
    
    this.actorSprites.forEach(sprite => sprite.destroy());
    this.actorSprites.clear();
    
    this.connectionLayer.removeChildren();
  }

  zoomIn() {
    this.zoom = Math.min(3, this.zoom * 1.2);
    this.updateTransform();
    this.emit(RendererEvents.VIEW_CHANGE, { zoom: this.zoom, pan: this.pan });
  }

  zoomOut() {
    this.zoom = Math.max(0.5, this.zoom / 1.2);
    this.updateTransform();
    this.emit(RendererEvents.VIEW_CHANGE, { zoom: this.zoom, pan: this.pan });
  }

  resetView() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.updateTransform();
    this.emit(RendererEvents.VIEW_CHANGE, { zoom: this.zoom, pan: this.pan });
  }

  resize(width, height) {
    if (this.app) {
      this.app.renderer.resize(width, height);
    }
  }

  render() {
    // PixiJS 自动渲染
  }

  destroy() {
    this.clearAll();
    
    if (this.app) {
      this.app.destroy(true);
    }
    
    this.app = null;
    this.stage = null;
    this.buildingLayer = null;
    this.actorLayer = null;
    this.connectionLayer = null;
    this.data = null;
  }
}

module.exports = RendererPixi;
