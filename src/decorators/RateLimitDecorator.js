'use strict';
const { ChannelDecorator } = require('./ChannelDecorator');
const { RateLimitedError } = require('../domain/errors');

/** FR-10: asks the limiter for a slot; when none is free the delivery is deferred (never dropped). */
class RateLimitDecorator extends ChannelDecorator {
  constructor(inner, limiter) { super(inner); this.limiter = limiter; }
  async send(message) {
    const slot = await this.limiter.tryConsume(message.tenantId, message.channel);
    if (!slot.allowed) throw new RateLimitedError(slot.retryAfterMs);
    return this.inner.send(message);
  }
}
module.exports = { RateLimitDecorator };
