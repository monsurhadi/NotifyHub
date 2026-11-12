'use strict';
const { newId } = require('../util/crypto');

/**
 * Stand-in for a real e-mail / SMS provider (free tiers have sending caps, see SRS 2.4).
 * It "sends" by writing to the outbox table, idempotently by notification id,
 * and can simulate failures so the retry logic can be demonstrated:
 *
 *   e-mail local part   fail@...    always fails
 *                       flaky@...   fails on attempts 1 and 2, then succeeds
 *                       timeout@... always times out
 *                       empty@...   provider answers without a message id (treated as a failure)
 *   SMS numbers         +15550000001 always fails   +15550000002 flaky
 */
class SimulatedProvider {
  constructor(outboxRepo) { this.outbox = outboxRepo; }

  behaviourFor(channel, recipient) {
    const key = channel === 'email' ? recipient.split('@')[0].toLowerCase() : recipient;
    if (key === 'fail' || key === '+15550000001') return 'fail';
    if (key === 'flaky' || key === '+15550000002') return 'flaky';
    if (key === 'timeout') return 'timeout';
    if (key === 'empty') return 'empty';
    return 'ok';
  }

  async deliver(message) {
    const behaviour = this.behaviourFor(message.channel, message.recipient);
    if (behaviour === 'fail') throw new Error('Simulated provider failure (HTTP 500)');
    if (behaviour === 'timeout') throw new Error('Simulated provider timeout');
    if (behaviour === 'flaky' && message.attempt <= 2) throw new Error(`Simulated transient provider failure (attempt ${message.attempt})`);
    if (behaviour === 'empty') return { providerMessageId: null, confirmed: false };

    await this.outbox.insertOnce({
      id: newId(), idemKey: message.notificationId, tenantId: message.tenantId, channel: message.channel,
      recipient: message.recipient, subject: message.subject, body: message.body, createdAt: new Date().toISOString(),
    });
    return { providerMessageId: `sim_${message.notificationId}`, confirmed: true };
  }
}
module.exports = { SimulatedProvider };
