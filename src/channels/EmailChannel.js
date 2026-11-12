'use strict';
const { NotificationChannel } = require('./NotificationChannel');

/** E-mail through SMTP when SMTP_HOST is configured, otherwise through the simulated provider. */
class EmailChannel extends NotificationChannel {
  constructor({ config, simulatedProvider }) {
    super('email');
    this.config = config;
    this.simulated = simulatedProvider;
    this.transport = null;
  }

  _transport() {
    if (!this.transport) {
      const nodemailer = require('nodemailer');
      const { host, port, user, pass } = this.config.smtp;
      this.transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined });
    }
    return this.transport;
  }

  async send(message) {
    if (!this.config.smtp.host) return this.simulated.deliver(message);
    const info = await this._transport().sendMail({
      from: this.config.smtp.from,
      to: message.recipient,
      subject: message.subject || '(no subject)',
      html: message.body,
      headers: { 'X-NotifyHub-Notification': message.notificationId },
    });
    return { providerMessageId: info.messageId, confirmed: false }; // accepted by SMTP, final delivery unknown
  }
}
module.exports = { EmailChannel };
