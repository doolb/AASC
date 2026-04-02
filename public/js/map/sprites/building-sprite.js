const { BuildingColors, BuildingIcons, StatusColors, BuildingStatus } = require('../core/constants');

class BuildingSprite {
  constructor(data, options = {}) {
    this.data = data;
    this.container = null;
    this.background = null;
    this.iconText = null;
    this.labelText = null;
    this.statusIndicator = null;
    this.actorContainer = null;
    this.actorSprites = new Map();
    
    this.options = {
      cornerRadius: 12,
      borderWidth: 2,
      padding: 10,
      ...options
    };
    
    this.isHighlighted = false;
    this.eventHandlers = new Map();
  }

  create(PIXI) {
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    
    this.createBackground(PIXI);
    this.createIcon(PIXI);
    this.createLabel(PIXI);
    this.createStatusIndicator(PIXI);
    this.createActorContainer(PIXI);
    
    this.updatePosition();
    this.setupInteraction();
    
    return this.container;
  }

  createBackground(PIXI) {
    this.background = new PIXI.Graphics();
    this.container.addChild(this.background);
    this.drawBackground();
  }

  drawBackground() {
    if (!this.background) return;
    
    const { width, height } = this.data.size;
    const r = this.options.cornerRadius;
    const color = BuildingColors[this.data.type] || 0x3498db;
    
    this.background.clear();
    
    if (this.data.status === BuildingStatus.OFFLINE) {
      this.background.beginFill(0x2c2c3e, 0.6);
    } else {
      this.background.beginFill(color, 0.3);
    }
    
    this.background.drawRoundedRect(-width / 2, -height / 2, width, height, r);
    this.background.endFill();
    
    this.background.lineStyle(this.options.borderWidth, color, this.data.status === BuildingStatus.OFFLINE ? 0.3 : 0.8);
    this.background.drawRoundedRect(-width / 2, -height / 2, width, height, r);
    
    if (this.isHighlighted) {
      this.background.lineStyle(3, 0xffffff, 0.8);
      this.background.drawRoundedRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8, r + 2);
    }
  }

  createIcon(PIXI) {
    const icon = BuildingIcons[this.data.type] || '📦';
    
    this.iconText = new PIXI.Text(icon, {
      fontFamily: 'Arial',
      fontSize: 28,
      fill: 0xffffff,
      align: 'center'
    });
    
    this.iconText.anchor.set(0.5);
    this.iconText.x = 0;
    this.iconText.y = -this.data.size.height / 4;
    
    this.container.addChild(this.iconText);
  }

  createLabel(PIXI) {
    this.labelText = new PIXI.Text(this.data.name, {
      fontFamily: 'Arial',
      fontSize: 12,
      fill: 0xffffff,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: this.data.size.width - 10
    });
    
    this.labelText.anchor.set(0.5);
    this.labelText.x = 0;
    this.labelText.y = this.data.size.height / 4;
    
    this.container.addChild(this.labelText);
  }

  createStatusIndicator(PIXI) {
    this.statusIndicator = new PIXI.Graphics();
    this.container.addChild(this.statusIndicator);
    this.drawStatusIndicator();
  }

  drawStatusIndicator() {
    if (!this.statusIndicator) return;
    
    const x = this.data.size.width / 2 - 12;
    const y = -this.data.size.height / 2 + 12;
    const radius = 6;
    
    this.statusIndicator.clear();
    
    let color = StatusColors.ready;
    switch (this.data.status) {
      case BuildingStatus.ONLINE:
        color = StatusColors.ready;
        break;
      case BuildingStatus.BUSY:
        color = StatusColors.busy;
        break;
      case BuildingStatus.OFFLINE:
        color = StatusColors.offline;
        break;
    }
    
    this.statusIndicator.beginFill(color);
    this.statusIndicator.drawCircle(x, y, radius);
    this.statusIndicator.endFill();
    
    if (this.data.status === BuildingStatus.ONLINE) {
      this.statusIndicator.beginFill(color, 0.3);
      this.statusIndicator.drawCircle(x, y, radius + 4);
      this.statusIndicator.endFill();
    }
  }

  createActorContainer(PIXI) {
    this.actorContainer = new PIXI.Container();
    this.actorContainer.y = this.data.size.height / 2 + 20;
    this.container.addChild(this.actorContainer);
  }

  updatePosition() {
    if (this.container) {
      this.container.x = this.data.position.x;
      this.container.y = this.data.position.y;
    }
  }

  update(data) {
    if (data) {
      this.data = data;
    }
    
    this.drawBackground();
    this.drawStatusIndicator();
    this.updatePosition();
    
    if (this.labelText && data && data.name) {
      this.labelText.text = data.name;
    }
  }

  updateStatus(status) {
    this.data.status = status;
    this.drawBackground();
    this.drawStatusIndicator();
  }

  addActorSprite(actorSprite) {
    if (!this.actorContainer) return;
    
    this.actorContainer.addChild(actorSprite);
    this.actorSprites.set(actorSprite.actorId, actorSprite);
  }

  removeActorSprite(actorId) {
    const sprite = this.actorSprites.get(actorId);
    if (sprite && this.actorContainer) {
      this.actorContainer.removeChild(sprite);
      this.actorSprites.delete(actorId);
    }
  }

  highlight(enabled = true) {
    this.isHighlighted = enabled;
    this.drawBackground();
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
          console.error(`[BuildingSprite] 事件处理错误: ${event}`, e);
        }
      });
    }
  }

  destroy() {
    if (this.container) {
      this.container.destroy({ children: true });
    }
    this.container = null;
    this.background = null;
    this.iconText = null;
    this.labelText = null;
    this.statusIndicator = null;
    this.actorContainer = null;
    this.actorSprites.clear();
    this.eventHandlers.clear();
  }
}

module.exports = BuildingSprite;
