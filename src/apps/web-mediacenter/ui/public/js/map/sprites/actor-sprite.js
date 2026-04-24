import { StatusColors, LevelSizeMap, ActorStatus } from '../core/constants.js';

class ActorSprite {
  constructor(data, options = {}) {
    this.data = data;
    this.container = null;
    this.body = null;
    this.statusRing = null;
    this.accessoryContainer = null;
    this.labelText = null;
    
    this.options = {
      showLabel: true,
      showAccessories: true,
      ...options
    };
    
    this.isHighlighted = false;
    this.eventHandlers = new Map();
  }

  get actorId() {
    return this.data.id;
  }

  create(PIXI) {
    this.PIXI = PIXI;
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    
    this.createStatusRing();
    this.createBody();
    
    if (this.options.showAccessories) {
      this.createAccessories();
    }
    
    if (this.options.showLabel) {
      this.createLabel();
    }
    
    this.updatePosition();
    this.setupInteraction();
    
    return this.container;
  }

  createStatusRing() {
    this.statusRing = new this.PIXI.Graphics();
    this.container.addChild(this.statusRing);
    this.drawStatusRing();
  }

  drawStatusRing() {
    if (!this.statusRing) return;
    
    const size = this.data.visual.size;
    const radius = size / 2 + 4;
    
    this.statusRing.clear();
    
    let color = StatusColors[this.data.status] || StatusColors.offline;
    
    this.statusRing.lineStyle(2, color, 0.8);
    this.statusRing.drawCircle(0, 0, radius);
    
    if (this.data.status === ActorStatus.READY) {
      this.statusRing.beginFill(color, 0.1);
      this.statusRing.drawCircle(0, 0, radius + 3);
      this.statusRing.endFill();
    }
    
    if (this.isHighlighted) {
      this.statusRing.lineStyle(2, 0xffffff, 0.8);
      this.statusRing.drawCircle(0, 0, radius + 6);
    }
  }

  createBody() {
    this.body = new this.PIXI.Graphics();
    this.container.addChild(this.body);
    this.drawBody();
  }

  drawBody() {
    if (!this.body) return;
    
    const size = this.data.visual.size;
    const radius = size / 2;
    const color = StatusColors[this.data.status] || StatusColors.offline;
    
    this.body.clear();
    
    this.body.beginFill(color, 0.8);
    this.body.drawCircle(0, 0, radius);
    this.body.endFill();
    
    this.body.beginFill(0xffffff, 0.3);
    this.body.drawCircle(-radius * 0.3, -radius * 0.3, radius * 0.3);
    this.body.endFill();
    
    const levelText = new this.PIXI.Text(this.data.maxLevel.toString(), {
      fontFamily: 'Arial',
      fontSize: Math.max(10, size / 3),
      fill: 0xffffff,
      fontWeight: 'bold',
      align: 'center'
    });
    levelText.anchor.set(0.5);
    
    this.body.addChild(levelText);
  }

  createAccessories() {
    this.accessoryContainer = new this.PIXI.Container();
    this.container.addChild(this.accessoryContainer);
    
    const accessories = this.data.visual.accessories || [];
    const size = this.data.visual.size;
    
    accessories.forEach((icon, index) => {
      const text = new this.PIXI.Text(icon, {
        fontFamily: 'Arial',
        fontSize: 12,
        fill: 0xffffff
      });
      
      text.anchor.set(0.5);
      text.x = -size / 2 - 8 - index * 16;
      text.y = -size / 2 - 8;
      
      this.accessoryContainer.addChild(text);
    });
  }

  createLabel() {
    this.labelText = new this.PIXI.Text(this.data.name, {
      fontFamily: 'Arial',
      fontSize: 10,
      fill: 0xcccccc,
      align: 'center'
    });
    
    this.labelText.anchor.set(0.5);
    this.labelText.y = this.data.visual.size / 2 + 12;
    
    this.container.addChild(this.labelText);
  }

  updatePosition() {
    if (this.container && this.data.localPosition) {
      this.container.x = this.data.localPosition.x;
      this.container.y = this.data.localPosition.y;
    }
  }

  update(data) {
    if (data) {
      this.data = data;
    }
    
    this.drawStatusRing();
    this.drawBody();
    this.updatePosition();
    
    if (this.labelText && data && data.name) {
      this.labelText.text = data.name;
    }
  }

  updateStatus(status) {
    this.data.status = status;
    this.drawStatusRing();
    this.drawBody();
  }

  highlight(enabled = true) {
    this.isHighlighted = enabled;
    this.drawStatusRing();
  }

  setupInteraction() {
    if (!this.container) return;
    
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    
    this.container.on('pointerover', () => {
      this.highlight(true);
      this.emit('hover', this.data);
    });
    
    this.container.on('pointerout', () => {
      this.highlight(false);
    });
    
    this.container.on('pointerdown', () => {
      this.emit('click', this.data);
    });
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
  }

  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).delete(handler);
    }
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (e) {
          console.error(`[ActorSprite] 事件处理错误: ${event}`, e);
        }
      });
    }
  }

  destroy() {
    if (this.container) {
      this.container.destroy({ children: true });
    }
    this.container = null;
    this.body = null;
    this.statusRing = null;
    this.accessoryContainer = null;
    this.labelText = null;
    this.eventHandlers.clear();
  }
}

export default ActorSprite;
