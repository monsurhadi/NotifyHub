'use strict';
const { NotificationChannel } = require('./NotificationChannel');
const { PermanentDeliveryError } = require('../domain/errors');
const { providerFetch } = require('./providerHttp');

/** Twilio SMS when configured, otherwise a local simulator for development. */
class SmsChannel extends NotificationChannel {
  constructor({ config, simulatedProvider }) { super('sms'); this.config = config; this.simulated = simulatedProvider; }

  async send(message) {
    const sms = this.config.sms;
    if (sms.provider !== 'twilio') return this.simulated.deliver(message);
    if (!sms.accountSid || !sms.authToken || (!sms.from && !sms.messagingServiceSid)) {
      throw new PermanentDeliveryError('Twilio SMS is not configured');
    }
    const form = new URLSearchParams({ To: message.recipient, Body: message.body });
    if (sms.from) form.set('From', sms.from);
    if (sms.messagingServiceSid) form.set('MessagingServiceSid', sms.messagingServiceSid);
    const auth = Buffer.from(`${sms.accountSid}:${sms.authToken}`).toString('base64');
    const data = await providerFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sms.accountSid)}/Messages.json`, {
      method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    }, 'Twilio SMS API');
    if (typeof data?.sid !== 'string' || !data.sid) throw new Error('Twilio SMS API returned no message id');
    return { providerMessageId: data.sid, confirmed: false };
  }
}
module.exports = { SmsChannel };
