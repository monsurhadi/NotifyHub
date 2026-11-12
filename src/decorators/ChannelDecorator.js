'use strict';
const { NotificationChannel } = require('../channels/NotificationChannel');

/** Base Decorator: wraps another channel and exposes the same interface. */
class ChannelDecorator extends NotificationChannel {
  constructor(inner) { super(inner.name); this.inner = inner; }
  send(message) { return this.inner.send(message); }
}
module.exports = { ChannelDecorator };
