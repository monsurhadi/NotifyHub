'use strict';
const { NotificationChannel } = require('./NotificationChannel');
const { PermanentDeliveryError } = require('../domain/errors');
const { providerFetch } = require('./providerHttp');

/** Sends text through Telegram's Bot API. `recipient` is a chat id, never a phone number. */
class TelegramChannel extends NotificationChannel {
  constructor({ config }) { super('telegram'); this.config = config; }

  async send(message) {
    const { botToken } = this.config.telegram;
    if (!botToken) throw new PermanentDeliveryError('Telegram Bot API is not configured');
    const data = await providerFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: message.recipient, text: message.body }),
    }, 'Telegram Bot API');
    const id = data?.result?.message_id;
    if (id === undefined || id === null) throw new Error('Telegram Bot API returned no message id');
    return { providerMessageId: String(id), confirmed: false };
  }
}
module.exports = { TelegramChannel };
