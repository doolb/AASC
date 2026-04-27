class IRenderer {
  constructor() {
    if (this.constructor === IRenderer) {
      throw new Error('IRenderer 是抽象接口，不能直接实例化');
    }
    this.eventHandlers = new Map();
  }

  async init(container) {
    throw new Error('子类必须实现 init 方法');
  }

  destroy() {
    throw new Error('子类必须实现 destroy 方法');
  }

  setData(data) {
    throw new Error('子类必须实现 setData 方法');
  }

  addBuilding(building) {
    throw new Error('子类必须实现 addBuilding 方法');
  }

  removeBuilding(id) {
    throw new Error('子类必须实现 removeBuilding 方法');
  }

  updateBuildingStatus(id, status) {
    throw new Error('子类必须实现 updateBuildingStatus 方法');
  }

  addActor(actor) {
    throw new Error('子类必须实现 addActor 方法');
  }

  removeActor(id) {
    throw new Error('子类必须实现 removeActor 方法');
  }

  updateActorStatus(id, status) {
    throw new Error('子类必须实现 updateActorStatus 方法');
  }

  zoomIn() {
    throw new Error('子类必须实现 zoomIn 方法');
  }

  zoomOut() {
    throw new Error('子类必须实现 zoomOut 方法');
  }

  resetView() {
    throw new Error('子类必须实现 resetView 方法');
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
          console.error(`[IRenderer] 事件处理错误: ${event}`, e);
        }
      });
    }
  }

  render() {
    throw new Error('子类必须实现 render 方法');
  }

  resize(width, height) {
    throw new Error('子类必须实现 resize 方法');
  }
}

const RendererEvents = {
  BUILDING_CLICK: 'building:click',
  ACTOR_CLICK: 'actor:click',
  BUILDING_HOVER: 'building:hover',
  ACTOR_HOVER: 'actor:hover',
  VIEW_CHANGE: 'view:change',
  READY: 'ready',
  BUILDING_DRAG_END: 'building:dragend'
};

export {
  IRenderer,
  RendererEvents
};
