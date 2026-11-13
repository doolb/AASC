/** Browser input contract; the browser driver is injected by the host. */
export class BrowserExecutor {
  constructor(options = {}) { this.driver = options.driver; }

  async execute(command) {
    if (!this.driver) return { executed: false, reason: 'browser-driver-not-configured' };
    if (command.action === 'tap') await this.driver.click(command.selector ?? command.point);
    else if (command.action === 'type') await this.driver.type(command.selector, command.text ?? '');
    else if (command.action === 'key') await this.driver.key(command.key);
    else throw new Error(`unsupported browser action: ${command.action}`);
    return { executed: true, reason: 'executed', action: command.action };
  }
}
