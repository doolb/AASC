const crypto = require('crypto')
const { Message, MessageType } = require('../message')
const { getBus } = require('../message-bus')

class ServerChannel {
  constructor(options = {}) {
    this.bus = options.bus || getBus()
    this.handlerMap = new Map()
  }

  on(topic, handler) {
    this.handlerMap.set(topic, handler)
    this.bus.subscribeHandler(topic, `server:${topic}`, handler)
  }

  push(clientIds, topic, payload) {
    for (const clientId of clientIds) {
      this.bus.publish(new Message({
        type: MessageType.EVENT,
        topic: `${topic}:${clientId}`,
        payload: { data: payload, targetClientId: clientId }
      }))
    }
  }

  broadcast(topic, payload) {
    this.bus.publish(new Message({
      type: MessageType.BROADCAST,
      topic,
      payload: { data: payload }
    }))
  }

  assignClientId() {
    return crypto.randomUUID()
  }

  off(topic) {
    this.bus.unsubscribeHandler(topic, `server:${topic}`)
    this.handlerMap.delete(topic)
  }
}

module.exports = { ServerChannel }
