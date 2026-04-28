const { Message, MessageType } = require('../message')
const { getBus } = require('../message-bus')

class ClientChannel {
  constructor(options = {}) {
    this.bus = options.bus || getBus()
    this.clientId = options.clientId || null
    this.handlerMap = new Map()
    this.pendingHandlers = new Map()
  }

  connect(clientId) {
    this.clientId = clientId
    for (const [topic, handler] of this.pendingHandlers) {
      this._subscribe(topic, handler)
    }
    this.pendingHandlers.clear()
  }

  send(topic, payload) {
    this.bus.publish(new Message({
      type: MessageType.EVENT,
      topic,
      payload: { clientId: this.clientId, data: payload }
    }))
  }

  on(topic, handler) {
    this.handlerMap.set(topic, handler)
    if (!this.clientId) {
      this.pendingHandlers.set(topic, handler)
      return
    }
    this._subscribe(topic, handler)
  }

  _subscribe(topic, handler) {
    const wrapped = (msg) => {
      const payload = msg.payload
      if (payload.targetClientId && payload.targetClientId !== this.clientId) {
        return
      }
      handler(payload.data)
    }
    const subId = `client:${this.clientId}:${topic}`
    this.bus.subscribeHandler(topic, subId, wrapped)
    this.bus.subscribeHandler(`${topic}:${this.clientId}`, subId, wrapped)
  }

  off(topic) {
    if (this.clientId) {
      const subId = `client:${this.clientId}:${topic}`
      this.bus.unsubscribeHandler(topic, subId)
      this.bus.unsubscribeHandler(`${topic}:${this.clientId}`, subId)
    }
    this.handlerMap.delete(topic)
    this.pendingHandlers.delete(topic)
  }

  disconnect() {
    for (const topic of this.handlerMap.keys()) {
      this.off(topic)
    }
    this.clientId = null
  }
}

module.exports = { ClientChannel }
