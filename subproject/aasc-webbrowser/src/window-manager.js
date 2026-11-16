'use strict';

class WindowManager {
  constructor({ session }) {
    this.session = session;
  }

  async createWindow(url = 'about:blank') {
    const { targetId } = await this.session.send('Target.createTarget', { url, newWindow: true });
    const { windowId } = await this.session.send('Browser.getWindowForTarget', { targetId });
    if (!windowId) throw new Error('browser did not create a native window');
    return { targetId, windowId };
  }

  async createTab(windowId, url = 'about:blank') {
    const { targetId } = await this.session.send('Target.createTarget', { url, windowId });
    const relationship = await this.session.send('Browser.getWindowForTarget', { targetId });
    if (relationship.windowId !== windowId) throw new Error('browser did not keep Tab in the business window');
    return { targetId, windowId };
  }

  async activate(targetId) {
    return this.session.send('Target.activateTarget', { targetId });
  }

  async closeTarget(targetId) {
    return this.session.send('Target.closeTarget', { targetId });
  }
}

module.exports = { WindowManager };
