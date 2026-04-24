const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');

class DisplayRenderActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'display-render-handler',
      capabilities: [
        {
          id: 'display-render',
          name: '画面渲染控制',
          category: CapabilityCategory.SPECIAL,
          level: CapabilityLevel.L3,
          securityLevel: 0,
          description: '显示端画面渲染控制能力，包括裁剪、旋转、缩放等'
        },
        {
          id: 'display-crop',
          name: '画面裁剪',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '媒体画面裁剪能力'
        },
        {
          id: 'display-rotation',
          name: '画面旋转',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '媒体画面旋转能力'
        },
        {
          id: 'display-scale',
          name: '画面缩放',
          category: CapabilityCategory.BASIC,
          level: CapabilityLevel.L2,
          securityLevel: 0,
          description: '媒体画面缩放能力'
        }
      ],
      subscriptions: [MessageTopic.DISPLAY_CONTROL, MessageTopic.DISPLAY_STATUS],
      ...options
    });

    this.displayClients = options.displayClients || null;
    this.sendToDisplay = options.sendToDisplay || null;
    this.displayStates = new Map();
  }

  setClients(clients, sendFunc) {
    this.displayClients = clients;
    this.sendToDisplay = sendFunc;
  }

  async onInit() {
    this.registerHandler(MessageTopic.DISPLAY_CONTROL, this.handleDisplayControl.bind(this));
    this.registerHandler('display.crop', this.handleCrop.bind(this));
    this.registerHandler('display.rotation', this.handleRotation.bind(this));
    this.registerHandler('display.scale', this.handleScale.bind(this));
    this.registerHandler('display.fit', this.handleFit.bind(this));
    this.registerHandler('display.reset', this.handleReset.bind(this));
    this.registerHandler('display.status', this.handleStatus.bind(this));
    this.registerHandler('display.list', this.handleList.bind(this));
  }

  async handleDisplayControl(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'crop':
        return this.handleCrop(message);
      case 'rotation':
        return this.handleRotation(message);
      case 'scale':
        return this.handleScale(message);
      case 'fit':
        return this.handleFit(message);
      case 'reset':
        return this.handleReset(message);
      case 'status':
        return this.handleStatus(message);
      case 'list':
        return this.handleList(message);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  async handleCrop(message) {
    const { displayId, crop } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { 
        type: 'control', 
        action: 'crop', 
        crop 
      });
      
      this._updateDisplayState(displayId, { crop });
      
      return { success: true, displayId, crop };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleRotation(message) {
    const { displayId, rotation } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { 
        type: 'control', 
        action: 'rotation', 
        rotation 
      });
      
      this._updateDisplayState(displayId, { rotation });
      
      return { success: true, displayId, rotation };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleScale(message) {
    const { displayId, scale } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { 
        type: 'control', 
        action: 'scale', 
        scale 
      });
      
      this._updateDisplayState(displayId, { scale });
      
      return { success: true, displayId, scale };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleFit(message) {
    const { displayId, fitMode } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { 
        type: 'control', 
        action: 'fit', 
        fitMode 
      });
      
      this._updateDisplayState(displayId, { fitMode });
      
      return { success: true, displayId, fitMode };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleReset(message) {
    const { displayId } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { 
        type: 'control', 
        action: 'reset'
      });
      
      this._resetDisplayState(displayId);
      
      return { success: true, displayId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleStatus(message) {
    const { displayId } = message.payload.data || message.payload;
    
    if (displayId) {
      const state = this.displayStates.get(displayId);
      return { success: true, data: state || {} };
    }
    
    const allStates = {};
    this.displayStates.forEach((state, id) => {
      allStates[id] = state;
    });
    
    return { success: true, data: allStates };
  }

  async handleList(message) {
    if (!this.displayClients) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      const displays = [];
      this.displayClients.forEach((display, id) => {
        displays.push({
          id,
          name: display.name || id,
          ip: display.ip || '',
          state: this.displayStates.get(id) || {}
        });
      });
      
      return { success: true, data: displays };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _updateDisplayState(displayId, updates) {
    const currentState = this.displayStates.get(displayId) || {};
    this.displayStates.set(displayId, { ...currentState, ...updates });
  }

  _resetDisplayState(displayId) {
    this.displayStates.set(displayId, {
      crop: null,
      rotation: 0,
      scale: 1,
      fitMode: 'contain'
    });
  }

  updateFromDisplay(displayId, state) {
    this._updateDisplayState(displayId, state);
  }
}

module.exports = DisplayRenderActor;
