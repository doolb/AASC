const { Actor, CapabilityCategory } = require('../actor');
const { MessageTopic } = require('../message');
const { CapabilityLevel } = require('../registry');

class MediaControlActor extends Actor {
  constructor(options = {}) {
    super({
      ip: options.ip || '127.0.0.1',
      role: 'server',
      name: options.name || 'media-control-handler',
      capabilities: [
        {
          id: 'media-control',
          name: '媒体控制',
          category: CapabilityCategory.SPECIAL,
          level: CapabilityLevel.L3,
          securityLevel: 0,
          description: '媒体播放控制能力'
        }
      ],
      subscriptions: [MessageTopic.MEDIA_CONTROL, MessageTopic.MEDIA_STATUS],
      ...options
    });

    this.displayClients = options.displayClients || null;
    this.sendToDisplay = options.sendToDisplay || null;
  }

  setClients(clients, sendFunc) {
    this.displayClients = clients;
    this.sendToDisplay = sendFunc;
  }

  async onInit() {
    this.registerHandler(MessageTopic.MEDIA_CONTROL, this.handleMediaControl.bind(this));
    this.registerHandler('media.play', this.handlePlay.bind(this));
    this.registerHandler('media.stop', this.handleStop.bind(this));
    this.registerHandler('media.volume', this.handleVolume.bind(this));
    this.registerHandler('media.crop', this.handleCrop.bind(this));
    this.registerHandler('media.rotation', this.handleRotation.bind(this));
  }

  async handleMediaControl(message) {
    const { action, data } = message.payload || {};
    
    switch (action) {
      case 'play':
        return this.handlePlay(message);
      case 'stop':
        return this.handleStop(message);
      case 'volume':
        return this.handleVolume(message);
      case 'crop':
        return this.handleCrop(message);
      case 'rotation':
        return this.handleRotation(message);
      default:
        return { error: `Unknown action: ${action}` };
    }
  }

  async handlePlay(message) {
    const { displayId, media } = message.payload.data || message.payload;
    
    if (!this.displayClients || !this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      const display = this.displayClients.get(displayId);
      if (!display) {
        return { success: false, error: `Display not found: ${displayId}` };
      }

      this.sendToDisplay(displayId, {
        type: media.type || 'url',
        ...media
      });

      return { success: true, displayId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleStop(message) {
    const { displayId } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { type: 'control', action: 'stop' });
      return { success: true, displayId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleVolume(message) {
    const { displayId, volume } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { type: 'control', action: 'volume', volume });
      return { success: true, displayId, volume };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async handleCrop(message) {
    const { displayId, crop } = message.payload.data || message.payload;
    
    if (!this.sendToDisplay) {
      return { success: false, error: 'Display clients not configured' };
    }

    try {
      this.sendToDisplay(displayId, { type: 'control', action: 'crop', crop });
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
      this.sendToDisplay(displayId, { type: 'control', action: 'rotation', rotation });
      return { success: true, displayId, rotation };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = MediaControlActor;
