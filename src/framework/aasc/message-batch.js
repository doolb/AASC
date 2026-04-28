class MessageBatch {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 200
    this.maxCount = options.maxCount || 50
    this.flushOnEmpty = options.flushOnEmpty !== false
    this.queue = new Map()
    this.timer = null
    this.onFlush = null
  }

  push(key, item, mergeFn) {
    if (this.queue.has(key) && mergeFn) {
      this.queue.set(key, mergeFn(this.queue.get(key), item))
    } else {
      this.queue.set(key, item)
    }
    if (this.queue.size >= this.maxCount) {
      this.flush()
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.windowMs)
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.queue.size === 0) return
    const items = Array.from(this.queue.values())
    this.queue.clear()
    if (this.onFlush) {
      this.onFlush(items)
    }
  }

  destroy() {
    this.flush()
  }
}

module.exports = { MessageBatch }
