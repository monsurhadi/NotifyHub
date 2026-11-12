'use strict';
const { NotificationChannel } = require('./NotificationChannel');
const { newId } = require('../util/crypto');

/** Stores the message so the tenant's app can fetch it (GET /v1/inbox/:userRef). */
class InAppChannel extends NotificationChannel {
  constructor({ inAppRepo }) { super('in-app'); this.repo = inAppRepo; }
  async send(message) {
    await this.repo.add({
      id: newId(), tenantId: message.tenantId, userRef: message.recipient, subject: message.subject,
      body: message.body, notificationId: message.notificationId, createdAt: new Date().toISOString(),
    });
    return { providerMessageId: `inapp_${message.notificationId}`, confirmed: true };
  }
}
module.exports = { InAppChannel };
