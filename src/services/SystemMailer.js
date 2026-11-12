'use strict';
const { escapeHtml } = require('../domain/templateEngine');

/** Platform account mail uses the same e-mail provider without exposing credentials in storage. */
class SystemMailer {
  constructor({ channelFactory, logger }) { this.factory = channelFactory; this.logger = logger; }

  async _send({ id, notificationId, recipient, subject, body, event }) {
    const result = await this.factory.create('email').send({
      notificationId: notificationId || `${event}_${id}`, tenantId: id, channel: 'email', recipient, attempt: 1, subject, body,
    });
    this.logger.info('account email sent', { event, accountId: id, providerMessageId: result.providerMessageId });
  }

  async sendVerification({ tenant, url, notificationId }) {
    await this._send({ id: tenant.id, notificationId, recipient: tenant.email, event: 'verify', subject: 'Verify your NotifyHub email',
      body: `<p>Hi ${escapeHtml(tenant.name)},</p><p>Confirm your email address to activate your NotifyHub workspace.</p><p><a href="${escapeHtml(url)}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this workspace, you can ignore this message.</p>` });
  }

  async sendWelcome(tenant) {
    await this._send({ id: tenant.id, recipient: tenant.email, event: 'welcome', subject: 'Welcome to NotifyHub - your workspace is ready',
      body: `<p>Hi ${escapeHtml(tenant.name)},</p><p>Your email is verified and your NotifyHub workspace is ready. Sign in to create an API key and send your first notification.</p>` });
  }

  async sendPasswordReset({ tenantId, email, name, url, notificationId }) {
    const safeName = name ? escapeHtml(name) : 'there';
    await this._send({ id: tenantId, notificationId, recipient: email, event: 'password-reset', subject: 'Reset your NotifyHub password',
      body: `<p>Hi ${safeName},</p><p>A password reset was requested for your NotifyHub account.</p><p><a href="${escapeHtml(url)}">Choose a new password</a></p><p>This link expires in 60 minutes. If you did not request this, no action is needed.</p>` });
  }
}
module.exports = { SystemMailer };
