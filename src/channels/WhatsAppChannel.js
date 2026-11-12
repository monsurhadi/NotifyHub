'use strict';
const { NotificationChannel } = require('./NotificationChannel');
const { PermanentDeliveryError } = require('../domain/errors');
const { providerFetch } = require('./providerHttp');

/** Sends plain text through Meta's WhatsApp Cloud API. Provider acceptance is reported as `sent`. */
class WhatsAppChannel extends NotificationChannel {
  constructor({ config }) { super('whatsapp'); this.config = config; }

  async send(message) {
    const { accessToken, phoneNumberId, apiVersion } = this.config.whatsapp;
    if (!accessToken || !phoneNumberId || !/^v\d+\.\d+$/.test(apiVersion)) {
      throw new PermanentDeliveryError('WhatsApp Cloud API is not configured');
    }
    const to = message.recipient.replace(/^\+/, '');
    const data = await providerFetch(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: message.body } }),
    }, 'WhatsApp Cloud API');
    const id = data?.messages?.[0]?.id;
    if (typeof id !== 'string' || !id) throw new Error('WhatsApp Cloud API returned no message id');
    return { providerMessageId: id, confirmed: false };
  }
}
module.exports = { WhatsAppChannel };
