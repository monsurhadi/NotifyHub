'use strict';

/**
 * Observer pattern. Publishers (NotificationService, DeliveryService) announce events,
 * subscribers (webhook dispatcher, structured logger) react without the publisher knowing about them.
 */
class EventBus {
  constructor(logger) { this.handlers = new Map(); this.logger = logger; }
  subscribe(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }
  async publish(event, data) {
    for (const handler of this.handlers.get(event) || []) {
      try { await handler(data); } catch (err) { this.logger.error('event handler failed', { event, err: err.message }); }
    }
  }
}
module.exports = { EventBus };
