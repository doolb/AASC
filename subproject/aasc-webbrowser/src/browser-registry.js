'use strict';

const path = require('node:path');
const { BrowserInstance } = require('./browser-instance');

class BrowserRegistry {
  constructor({ browsers = {}, instanceFactory = options => new BrowserInstance(options) } = {}) {
    this.config = browsers;
    this.instances = new Map();
    this.instanceFactory = instanceFactory;
    for (const [id, config] of Object.entries(browsers)) {
      this.instances.set(id, this.instanceFactory({ id, ...config }));
    }
  }

  validate() {
    const profiles = new Map();
    for (const [id, config] of Object.entries(this.config)) {
      if (!config.profile) continue;
      const profile = path.resolve(config.profile);
      if (profiles.has(profile)) throw new Error(`profile ${profile} is used by multiple browsers`);
      profiles.set(profile, id);
    }
    return true;
  }

  get(id) {
    return this.instances.get(id) || null;
  }

  require(id) {
    const instance = this.get(id);
    if (!instance) throw Object.assign(new Error(`unknown browser ${id}`), { code: 'BROWSER_NOT_FOUND', statusCode: 404 });
    return instance;
  }

  async ensure(id) {
    const instance = this.require(id);
    await instance.ensure();
    return instance;
  }

  list() {
    return [...this.instances.values()].map(instance => instance.status());
  }

  status(id) {
    return this.require(id).status();
  }

  async close() {
    await Promise.all([...this.instances.values()].map(instance => instance.close()));
  }
}

module.exports = { BrowserRegistry };
