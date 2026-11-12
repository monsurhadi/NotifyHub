'use strict';

/**
 * Strategy interface. Every delivery channel implements `send(message)`.
 *
 * message = { notificationId, tenantId, channel, recipient, subject, body, attempt, webhookSecret }
 * send() resolves to { providerMessageId, confirmed }  - `confirmed` means delivery is certain (status "delivered"),
 * otherwise the provider only accepted the message (status "sent").
 * send() throws when delivery failed.
 */
class NotificationChannel {
  constructor(name) { this.name = name; }
  // eslint-disable-next-line no-unused-vars
  async send(message) { throw new Error(`${this.constructor.name}.send() is not implemented`); }
}
module.exports = { NotificationChannel };
