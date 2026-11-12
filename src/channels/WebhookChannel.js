'use strict';
const { NotificationChannel } = require('./NotificationChannel');
const { hmacHex } = require('../util/crypto');
const { fetchPublicTarget } = require('../domain/validators');

/** Delivers the rendered notification as a signed HTTP POST to the recipient URL. */
class WebhookChannel extends NotificationChannel {
  constructor({ config }) { super('webhook'); this.config = config; }

  async send(message) {
    const body = JSON.stringify({
      notification_id: message.notificationId, subject: message.subject, body: message.body, created_at: new Date().toISOString(),
    });
    const headers = { 'content-type': 'application/json', 'user-agent': 'NotifyHub/1.0', 'x-notifyhub-notification': message.notificationId };
    if (message.webhookSecret) headers['x-notifyhub-signature'] = `sha256=${hmacHex(message.webhookSecret, body)}`;
    const res = await fetchPublicTarget(message.recipient, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.config.webhookTimeoutMs) }, this.config.allowPrivateWebhookTargets);
    if (res.status < 200 || res.status >= 300) throw new Error(`Webhook endpoint answered HTTP ${res.status}`);
    return { providerMessageId: `http_${res.status}`, confirmed: true };
  }
}
module.exports = { WebhookChannel };
