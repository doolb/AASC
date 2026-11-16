'use strict';

const { TaskStore } = require('./task-store');
const { WindowQueue } = require('./window-queue');
const { WindowManager } = require('./window-manager');

class BusinessRegistry {
  constructor({ businesses = {}, browsers, taskStore = new TaskStore(), windowManagerFactory = session => new WindowManager({ session }) } = {}) {
    this.config = businesses;
    this.browsers = browsers;
    this.taskStore = taskStore;
    this.windowManagerFactory = windowManagerFactory;
    this.businesses = new Map();
  }

  requireConfig(id) {
    const config = this.config[id];
    if (!config) throw Object.assign(new Error(`unknown business ${id}`), { code: 'BUSINESS_NOT_FOUND', statusCode: 404 });
    return config;
  }

  get(id) {
    return this.businesses.get(id) || null;
  }

  async ensureBusiness(id) {
    const configured = this.requireConfig(id);
    if (this.businesses.has(id)) return this.businesses.get(id);
    const browserInstance = this.browsers.require(configured.browser);
    const browser = await browserInstance.ensure();
    if (!browser || (typeof browser.createCDPSession !== 'function' && typeof browser.target?.().createCDPSession !== 'function')) throw new Error('browser does not provide a browser-level CDP session');
    const session = await (typeof browser.createCDPSession === 'function'
      ? browser.createCDPSession()
      : browser.target?.().createCDPSession());
    if (!session) throw new Error('browser does not provide a browser-level CDP session');
    const manager = this.windowManagerFactory(session);
    const nativeWindow = await manager.createWindow();
    const business = {
      businessId: id,
      browserId: configured.browser,
      browser: browserInstance,
      session,
      manager,
      windowId: nativeWindow.windowId,
      initialTargetId: nativeWindow.targetId,
      queue: new WindowQueue({ store: this.taskStore }),
      tabs: new Map(),
      state: 'ready',
      createdAt: new Date().toISOString()
    };
    this.businesses.set(id, business);
    if (typeof browser.on === 'function') browser.on('disconnected', () => this.markDisconnected(id));
    return business;
  }

  async ensureSubBusiness(businessId, subBusinessId) {
    const business = await this.ensureBusiness(businessId);
    if (business.tabs.has(subBusinessId)) return business.tabs.get(subBusinessId);
    const created = await business.manager.createTab(business.windowId, 'about:blank');
    const tab = {
      subBusinessId,
      businessId,
      browserId: business.browserId,
      targetId: created.targetId,
      windowId: created.windowId,
      url: 'about:blank',
      title: '',
      state: 'ready',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };
    business.tabs.set(subBusinessId, tab);
    return tab;
  }

  activateSubBusiness(businessId, subBusinessId) {
    const business = this.get(businessId);
    if (!business) return this.ensureSubBusiness(businessId, subBusinessId).then(() => this.activateSubBusiness(businessId, subBusinessId));
    const tab = business.tabs.get(subBusinessId);
    if (!tab) return this.ensureSubBusiness(businessId, subBusinessId).then(() => this.activateSubBusiness(businessId, subBusinessId));
    return business.queue.enqueue(() => business.manager.activate(tab.targetId), { businessId, subBusinessId, operation: 'activate' });
  }

  queueForTarget(targetId) {
    for (const business of this.businesses.values()) {
      if (business.initialTargetId === targetId || [...business.tabs.values()].some(tab => tab.targetId === targetId)) return business.queue;
    }
    return null;
  }
  getBusinessSnapshot(id) {
    const business = this.get(id);
    if (!business) return null;
    return {
      businessId: business.businessId,
      browserId: business.browserId,
      windowId: business.windowId,
      initialTargetId: business.initialTargetId,
      state: business.state,
      tabs: [...business.tabs.values()].map(tab => ({ ...tab }))
    };
  }

  list() {
    return Object.keys(this.config).map(id => this.getBusinessSnapshot(id) || { businessId: id, browserId: this.config[id].browser, state: 'not-created', tabs: [] });
  }

  markDisconnected(id) {
    const business = this.get(id);
    if (!business) return;
    business.state = 'disconnected';
    for (const tab of business.tabs.values()) tab.state = 'disconnected';
    business.queue.shutdown();
  }

  async close() {
    for (const business of this.businesses.values()) {
      business.queue.shutdown();
      for (const tab of business.tabs.values()) await business.manager.closeTarget(tab.targetId).catch(() => {});
      await business.manager.closeTarget(business.initialTargetId).catch(() => {});
      await business.session.detach?.().catch(() => {});
    }
    this.businesses.clear();
  }
}

module.exports = { BusinessRegistry };
