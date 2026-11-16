'use strict';

const crypto = require('node:crypto');

function bounded(value, maxBytes) {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value, (_, item) => item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : item);
  if (Buffer.byteLength(serialized) <= maxBytes) return JSON.parse(serialized);
  if (value instanceof Error || value?.message) {
    return { name: value.name || 'Error', message: String(value.message).slice(0, Math.max(1, maxBytes - 40)) };
  }
  return JSON.parse(serialized.slice(0, Math.max(2, maxBytes - 1)) + '}');
}

class TaskStore {
  constructor({ maxValueBytes = 64 * 1024, id = () => `task-${crypto.randomUUID()}`, now = () => new Date().toISOString() } = {}) {
    this.maxValueBytes = maxValueBytes;
    this.id = id;
    this.now = now;
    this.tasks = new Map();
  }

  create(metadata = {}) {
    const task = {
      taskId: this.id(),
      status: 'queued',
      createdAt: this.now(),
      updatedAt: this.now(),
      ...metadata
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  update(taskId, changes) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    Object.assign(task, changes, { updatedAt: this.now() });
    if (Object.hasOwn(changes, 'result')) task.result = bounded(changes.result, this.maxValueBytes);
    if (Object.hasOwn(changes, 'error')) task.error = bounded(changes.error, this.maxValueBytes);
    return task;
  }

  get(taskId) {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }

  list() {
    return [...this.tasks.values()].map(task => structuredClone(task));
  }
}

module.exports = { TaskStore, bounded };
