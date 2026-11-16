'use strict';

class WindowQueue {
  constructor({ store }) {
    this.store = store;
    this.items = [];
    this.running = false;
    this.closed = false;
  }

  enqueue(operation, metadata = {}) {
    if (this.closed) {
      const task = this.store.create(metadata);
      this.store.update(task.taskId, { status: 'cancelled', error: { name: 'Error', message: 'Queue is shut down' } });
      return { taskId: task.taskId, done: Promise.reject(new Error('Queue is shut down')) };
    }
    const task = this.store.create(metadata);
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    this.items.push({ taskId: task.taskId, operation, resolveDone, rejectDone });
    this.pump();
    return { taskId: task.taskId, done };
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.items.length) {
      const item = this.items.shift();
      if (this.store.get(item.taskId)?.status === 'cancelled') {
        item.rejectDone(new Error('Task cancelled'));
        continue;
      }
      this.store.update(item.taskId, { status: 'running', startedAt: new Date().toISOString() });
      try {
        const result = await item.operation();
        this.store.update(item.taskId, { status: 'succeeded', result, finishedAt: new Date().toISOString() });
        item.resolveDone(result);
      } catch (error) {
        this.store.update(item.taskId, { status: 'failed', error, finishedAt: new Date().toISOString() });
        item.rejectDone(error);
      }
    }
    this.running = false;
  }

  shutdown() {
    this.closed = true;
    for (const item of this.items.splice(0)) {
      this.store.update(item.taskId, { status: 'cancelled', error: { name: 'Error', message: 'Task cancelled' }, finishedAt: new Date().toISOString() });
      item.rejectDone(new Error('Task cancelled'));
    }
  }
}

module.exports = { WindowQueue };
