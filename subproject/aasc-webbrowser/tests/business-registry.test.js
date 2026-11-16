'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BusinessRegistry } = require('../src/business-registry');
const { WindowManager } = require('../src/window-manager');

class FakeBrowser extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.nextTarget = 1;
    this.nextWindow = 1;
    this.targets = new Map();
    this.commands = [];
  }

  async createCDPSession() {
    return {
      send: async (method, params = {}) => {
        this.commands.push({ method, params });
        if (method === 'Target.createTarget') {
          const targetId = `target-${this.nextTarget++}`;
          const windowId = params.newWindow ? `window-${this.nextWindow++}` : params.windowId;
          this.targets.set(targetId, { targetId, windowId });
          return { targetId };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: this.targets.get(params.targetId).windowId };
        return {};
      },
      detach: async () => {}
    };
  }
}

test('lazily creates one native window per business and one tab per sub-business', async () => {
  const browser = new FakeBrowser();
  const browserInstance = { id: 'main', browser: browser, browserType: 'chromium', ensure: async () => browser };
  const registry = new BusinessRegistry({
    businesses: { first: { browser: 'main' }, second: { browser: 'main' } },
    browsers: { require: id => id === 'main' ? browserInstance : null }
  });

  const first = await registry.ensureBusiness('first');
  const again = await registry.ensureBusiness('first');
  const tabA = await registry.ensureSubBusiness('first', 'a');
  const tabAgain = await registry.ensureSubBusiness('first', 'a');
  const tabB = await registry.ensureSubBusiness('first', 'b');
  const second = await registry.ensureBusiness('second');

  assert.equal(first, again);
  assert.equal(tabA, tabAgain);
  assert.notEqual(first.windowId, second.windowId);
  assert.notEqual(tabA.targetId, tabB.targetId);
  assert.equal(browser.commands.filter(command => command.method === 'Target.createTarget').length, 4);
});

test('activation is serialized through the business window queue', async () => {
  const browser = new FakeBrowser();
  const browserInstance = { id: 'main', ensure: async () => browser, browser };
  const registry = new BusinessRegistry({ businesses: { first: { browser: 'main' } }, browsers: { require: () => browserInstance } });
  const business = await registry.ensureBusiness('first');
  const tab = await registry.ensureSubBusiness('first', 'a');
  const activation = registry.activateSubBusiness('first', 'a');
  assert.match(activation.taskId, /^task-/);
  await activation.done;
  assert.equal(business.queue.store.get(activation.taskId).status, 'succeeded');
});

test('closes service-created windows and Tabs without closing the external browser', async () => {
  const browser = new FakeBrowser();
  const closeCommands = [];
  const browserInstance = { id: 'main', browser, owned: false, ensure: async () => browser };
  const registry = new BusinessRegistry({
    businesses: { first: { browser: 'main' } },
    browsers: { require: () => browserInstance }
  });
  const business = await registry.ensureBusiness('first');
  const tab = await registry.ensureSubBusiness('first', 'a');
  const originalSend = business.session.send;
  business.session.send = async (method, params) => {
    if (method === 'Target.closeTarget') closeCommands.push(params.targetId);
    return originalSend(method, params);
  };

  await registry.close();

  assert.deepEqual(closeCommands, [tab.targetId, business.initialTargetId]);
  assert.equal(browser.connected, true);
});
test('window manager rejects a target that is not in the requested window', async () => {
  const browser = new FakeBrowser();
  const session = await browser.createCDPSession();
  const manager = new WindowManager({ session });
  const window = await manager.createWindow();
  const target = await manager.createTab(window.windowId, 'about:blank');
  assert.equal(target.windowId, window.windowId);
});
