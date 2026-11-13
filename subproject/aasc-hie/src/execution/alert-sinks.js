export class MemoryAlertSink {
  constructor() { this.alerts = []; }
  async emit(alert) { this.alerts.push(alert); }
}

export class CallbackAlertSink {
  constructor(callback) {
    if (typeof callback !== 'function') throw new Error('alert callback is required');
    this.callback = callback;
  }

  async emit(alert) { return this.callback(alert); }
}
