const { MapData, BuildingData, ActorData } = require('./core/map-data');
const DataAdapter = require('./core/data-adapter');
const RendererPixi = require('./renderer/renderer-pixi');
const { RendererEvents } = require('./renderer/i-renderer');

class MapPanel {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('map-container');
    this.renderer = null;
    this.dataAdapter = new DataAdapter({
      canvasSize: { width: 800, height: 600 }
    });
    this.mapData = new MapData();
    
    this.detailPanel = null;
    this.wsClient = null;
    this.apiBase = options.apiBase || '';
    
    this.eventHandlers = new Map();
  }

  async init() {
    if (!this.container) {
      console.error('[MapPanel] 找不到容器元素');
      return;
    }
    
    this.createToolbar();
    this.createDetailPanel();
    
    this.renderer = new RendererPixi();
    await this.renderer.init(this.container);
    
    this.setupRendererEvents();
    
    this.dataAdapter.setCanvasSize(
      this.container.clientWidth,
      this.container.clientHeight
    );
    
    await this.loadData();
    
    this.connectWebSocket();
    
    this.setupResizeObserver();
    
    console.log('[MapPanel] 初始化完成');
  }

  createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'map-toolbar';
    toolbar.innerHTML = `
      <button class="map-toolbar-btn" id="mapZoomIn" title="放大">➕</button>
      <button class="map-toolbar-btn" id="mapZoomOut" title="缩小">➖</button>
      <button class="map-toolbar-btn" id="mapReset" title="重置视图">🔄</button>
      <button class="map-toolbar-btn" id="mapRefresh" title="刷新数据">🔃</button>
    `;
    
    this.container.parentElement.insertBefore(toolbar, this.container);
    
    document.getElementById('mapZoomIn').addEventListener('click', () => {
      if (this.renderer) this.renderer.zoomIn();
    });
    
    document.getElementById('mapZoomOut').addEventListener('click', () => {
      if (this.renderer) this.renderer.zoomOut();
    });
    
    document.getElementById('mapReset').addEventListener('click', () => {
      if (this.renderer) this.renderer.resetView();
    });
    
    document.getElementById('mapRefresh').addEventListener('click', () => {
      this.loadData();
    });
  }

  createDetailPanel() {
    this.detailPanel = document.createElement('div');
    this.detailPanel.className = 'map-detail-panel';
    this.detailPanel.style.display = 'none';
    this.container.parentElement.appendChild(this.detailPanel);
  }

  setupRendererEvents() {
    if (!this.renderer) return;
    
    this.renderer.on(RendererEvents.BUILDING_CLICK, (data) => {
      this.showBuildingDetail(data);
    });
    
    this.renderer.on(RendererEvents.ACTOR_CLICK, (data) => {
      this.showActorDetail(data);
    });
    
    this.renderer.on(RendererEvents.BUILDING_HOVER, (data) => {
      this.showTooltip(data, 'building');
    });
    
    this.renderer.on(RendererEvents.ACTOR_HOVER, (data) => {
      this.showTooltip(data, 'actor');
    });
  }

  async loadData() {
    try {
      const response = await fetch(`${this.apiBase}/api/map-data`);
      const result = await response.json();
      
      if (result.status === 'success') {
        this.mapData = this.dataAdapter.adaptActorRegistry(result.data);
        this.renderer.setData(this.mapData);
      }
    } catch (error) {
      console.error('[MapPanel] 加载数据失败:', error);
      this.loadDemoData();
    }
  }

  loadDemoData() {
    const demoData = {
      actors: [
        {
          address: { ip: '192.168.1.100', role: 'server', name: 'main' },
          status: 'ready',
          capabilities: [
            { id: 'chat', name: 'AI对话', category: 'professional', level: 4 },
            { id: 'media-control', name: '媒体控制', category: 'special', level: 3 }
          ],
          lastHeartbeat: Date.now()
        },
        {
          address: { ip: '192.168.1.101', role: 'display', name: 'living-room' },
          status: 'ready',
          capabilities: [
            { id: 'display', name: '显示', category: 'basic', level: 2 }
          ],
          lastHeartbeat: Date.now()
        },
        {
          address: { ip: '192.168.1.102', role: 'display', name: 'bedroom' },
          status: 'busy',
          capabilities: [
            { id: 'display', name: '显示', category: 'basic', level: 2 },
            { id: 'voice-synthesis', name: '语音合成', category: 'professional', level: 3 }
          ],
          lastHeartbeat: Date.now()
        },
        {
          address: { ip: '192.168.1.103', role: 'control', name: 'mobile' },
          status: 'ready',
          capabilities: [
            { id: 'control', name: '控制', category: 'basic', level: 1 }
          ],
          lastHeartbeat: Date.now()
        }
      ]
    };
    
    this.mapData = this.dataAdapter.adaptActorRegistry(demoData);
    this.renderer.setData(this.mapData);
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
      this.wsClient = new WebSocket(wsUrl);
      
      this.wsClient.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch (e) {
          console.error('[MapPanel] 解析WebSocket消息失败:', e);
        }
      };
      
      this.wsClient.onclose = () => {
        console.log('[MapPanel] WebSocket连接关闭，5秒后重连');
        setTimeout(() => this.connectWebSocket(), 5000);
      };
      
      this.wsClient.onerror = (error) => {
        console.error('[MapPanel] WebSocket错误:', error);
      };
    } catch (error) {
      console.error('[MapPanel] WebSocket连接失败:', error);
    }
  }

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'actor:status':
        this.handleActorStatusUpdate(data.data);
        break;
      case 'actor:register':
        this.handleActorRegister(data.data);
        break;
      case 'actor:unregister':
        this.handleActorUnregister(data.data);
        break;
      case 'displayList':
        this.handleDisplayListUpdate(data);
        break;
    }
  }

  handleActorStatusUpdate(data) {
    if (data && data.id) {
      this.mapData.updateActorStatus(data.id, data.status);
      this.renderer.updateActorStatus(data.id, data.status);
    }
  }

  handleActorRegister(data) {
    if (data) {
      const actor = this.dataAdapter.adaptActor(data, this.dataAdapter.getBuildingId(data.address));
      this.mapData.addActor(actor);
      this.renderer.addActor(actor);
    }
  }

  handleActorUnregister(data) {
    if (data && data.id) {
      this.mapData.removeActor(data.id);
      this.renderer.removeActor(data.id);
    }
  }

  handleDisplayListUpdate(data) {
    // 处理显示端列表更新
  }

  showBuildingDetail(data) {
    this.detailPanel.innerHTML = `
      <div class="detail-header">
        <span class="detail-icon">${this.getBuildingIcon(data.type)}</span>
        <span class="detail-title">${data.name}</span>
        <button class="detail-close" onclick="this.parentElement.parentElement.style.display='none'">✕</button>
      </div>
      <div class="detail-content">
        <div class="detail-row">
          <span class="detail-label">类型:</span>
          <span class="detail-value">${this.getBuildingTypeName(data.type)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">状态:</span>
          <span class="detail-value status-${data.status}">${this.getStatusName(data.status)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">IP:</span>
          <span class="detail-value">${data.metadata?.ip || '-'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">执行者:</span>
          <span class="detail-value">${data.actors?.length || 0} 个</span>
        </div>
      </div>
    `;
    this.detailPanel.style.display = 'block';
  }

  showActorDetail(data) {
    const capabilitiesHtml = (data.capabilities || []).map(cap => `
      <div class="capability-item">
        <span class="capability-level">L${cap.level}</span>
        <span class="capability-name">${cap.name}</span>
        <span class="capability-category">${this.getCategoryName(cap.category)}</span>
      </div>
    `).join('');
    
    this.detailPanel.innerHTML = `
      <div class="detail-header">
        <span class="detail-icon">👤</span>
        <span class="detail-title">${data.name}</span>
        <button class="detail-close" onclick="this.parentElement.parentElement.style.display='none'">✕</button>
      </div>
      <div class="detail-content">
        <div class="detail-row">
          <span class="detail-label">状态:</span>
          <span class="detail-value status-${data.status}">${this.getStatusName(data.status)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">等级:</span>
          <span class="detail-value">L${data.maxLevel}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">地址:</span>
          <span class="detail-value">${data.address?.ip || '-'} / ${data.address?.role || '-'}</span>
        </div>
        <div class="detail-section">
          <div class="detail-section-title">能力列表</div>
          <div class="capability-list">
            ${capabilitiesHtml || '<div class="empty">暂无能力</div>'}
          </div>
        </div>
      </div>
    `;
    this.detailPanel.style.display = 'block';
  }

  showTooltip(data, type) {
    // 可以实现悬浮提示
  }

  getBuildingIcon(type) {
    const icons = {
      server: '🖥️',
      display: '📺',
      control: '📱'
    };
    return icons[type] || '📦';
  }

  getBuildingTypeName(type) {
    const names = {
      server: '服务器',
      display: '显示端',
      control: '控制端'
    };
    return names[type] || '未知';
  }

  getStatusName(status) {
    const names = {
      online: '在线',
      offline: '离线',
      busy: '忙碌',
      ready: '就绪',
      initializing: '初始化',
      degraded: '降级'
    };
    return names[status] || status;
  }

  getCategoryName(category) {
    const names = {
      basic: '基础',
      professional: '专业',
      special: '特殊'
    };
    return names[category] || category;
  }

  setupResizeObserver() {
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => {
        if (this.renderer && this.container) {
          this.renderer.resize(
            this.container.clientWidth,
            this.container.clientHeight
          );
          this.dataAdapter.setCanvasSize(
            this.container.clientWidth,
            this.container.clientHeight
          );
        }
      });
      observer.observe(this.container);
    }
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
          console.error(`[MapPanel] 事件处理错误: ${event}`, e);
        }
      });
    }
  }

  destroy() {
    if (this.renderer) {
      this.renderer.destroy();
    }
    
    if (this.wsClient) {
      this.wsClient.close();
    }
    
    this.eventHandlers.clear();
  }
}

module.exports = MapPanel;

window.MapPanel = MapPanel;
