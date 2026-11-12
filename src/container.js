'use strict';
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createDatabase } = require('./db/createDatabase');
const { migrate } = require('./db/migrate');

const { TenantRepository } = require('./repositories/TenantRepository');
const { UserRepository } = require('./repositories/UserRepository');
const { ApiKeyRepository } = require('./repositories/ApiKeyRepository');
const { TemplateRepository } = require('./repositories/TemplateRepository');
const { NotificationRepository } = require('./repositories/NotificationRepository');
const { DeliveryAttemptRepository } = require('./repositories/DeliveryAttemptRepository');
const { WebhookRepository } = require('./repositories/WebhookRepository');
const { UsageRepository } = require('./repositories/UsageRepository');
const { RateLimitRepository } = require('./repositories/RateLimitRepository');
const { InAppRepository } = require('./repositories/InAppRepository');
const { BillingRepository } = require('./repositories/BillingRepository');
const { OutboxRepository } = require('./repositories/OutboxRepository');

const { ChannelFactory } = require('./channels/ChannelFactory');
const { SimulatedProvider } = require('./channels/SimulatedProvider');
const { EmailChannel } = require('./channels/EmailChannel');
const { SmsChannel } = require('./channels/SmsChannel');
const { WhatsAppChannel } = require('./channels/WhatsAppChannel');
const { TelegramChannel } = require('./channels/TelegramChannel');
const { WebhookChannel } = require('./channels/WebhookChannel');
const { InAppChannel } = require('./channels/InAppChannel');

const { DbJobQueue } = require('./queue/JobQueue');
const { Worker } = require('./queue/Worker');
const { EventBus } = require('./services/EventBus');
const { RateLimiter } = require('./services/RateLimiter');
const { SystemMailer } = require('./services/SystemMailer');
const { AuthService } = require('./services/AuthService');
const { ApiKeyService } = require('./services/ApiKeyService');
const { TemplateService } = require('./services/TemplateService');
const { NotificationService } = require('./services/NotificationService');
const { DeliveryService } = require('./services/DeliveryService');
const { WebhookService } = require('./services/WebhookService');
const { BillingService } = require('./services/BillingService');
const { AnalyticsService } = require('./services/AnalyticsService');
const { PlatformService } = require('./services/PlatformService');
const { MockBillingProvider } = require('./billing/MockBillingProvider');
const { StripeBillingProvider } = require('./billing/StripeBillingProvider');

/** Composition root: builds every object once and wires the dependencies together. */
async function createContainer(overrides = {}) {
  const config = loadConfig(overrides);
  if (!['simulated', 'twilio'].includes(config.sms.provider)) throw new Error('SMS_PROVIDER must be "simulated" or "twilio".');
  if (config.sms.provider === 'twilio' && (!config.sms.accountSid || !config.sms.authToken || (!config.sms.from && !config.sms.messagingServiceSid))) {
    throw new Error('Twilio SMS requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.');
  }
  if ((config.whatsapp.accessToken || config.whatsapp.phoneNumberId || config.whatsapp.apiVersion)
    && (!config.whatsapp.accessToken || !config.whatsapp.phoneNumberId || !/^v\d+\.\d+$/.test(config.whatsapp.apiVersion))) {
    throw new Error('WhatsApp requires WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and a WHATSAPP_API_VERSION such as v23.0.');
  }
  if (config.env === 'production' && (config.jwtSecret === 'dev-only-change-me' || config.adminToken === 'dev-admin-token')) {
    throw new Error('Refusing to start in production with the default JWT_SECRET / ADMIN_TOKEN. Set your own values.');
  }
  const logger = createLogger(config);
  const db = createDatabase(config);
  await migrate(db);

  const repos = {
    tenants: new TenantRepository(db), users: new UserRepository(db), apiKeys: new ApiKeyRepository(db),
    templates: new TemplateRepository(db), notifications: new NotificationRepository(db), attempts: new DeliveryAttemptRepository(db),
    webhooks: new WebhookRepository(db), usage: new UsageRepository(db), rateLimits: new RateLimitRepository(db),
    inApp: new InAppRepository(db), billing: new BillingRepository(db), outbox: new OutboxRepository(db),
  };

  const simulatedProvider = new SimulatedProvider(repos.outbox);
  const channelFactory = new ChannelFactory()
    .register('email', () => new EmailChannel({ config, simulatedProvider }))
    .register('sms', () => new SmsChannel({ config, simulatedProvider }))
    .register('whatsapp', () => new WhatsAppChannel({ config }))
    .register('telegram', () => new TelegramChannel({ config }))
    .register('webhook', () => new WebhookChannel({ config }))
    .register('in-app', () => new InAppChannel({ inAppRepo: repos.inApp }));

  const queue = new DbJobQueue(db, config);
  const eventBus = new EventBus(logger);
  const limiter = new RateLimiter(repos.rateLimits, config);
  const mailer = new SystemMailer({ channelFactory, logger });

  const services = {
    auth: new AuthService({ config, db, tenants: repos.tenants, users: repos.users, apiKeys: repos.apiKeys, mailer, logger }),
    apiKeys: new ApiKeyService({ apiKeys: repos.apiKeys }),
    templates: new TemplateService({ db, templates: repos.templates }),
    notifications: new NotificationService({
      config, db, notifications: repos.notifications, attempts: repos.attempts, templates: repos.templates, tenants: repos.tenants,
      usage: repos.usage, queue, channelFactory, eventBus,
    }),
    delivery: new DeliveryService({
      config, notifications: repos.notifications, attempts: repos.attempts, tenants: repos.tenants, channelFactory, limiter, eventBus, logger,
    }),
    webhooks: new WebhookService({ config, repo: repos.webhooks, tenants: repos.tenants, queue, logger }),
    billing: new BillingService({
      config, tenants: repos.tenants, usage: repos.usage, billing: repos.billing,
      provider: config.stripeSecretKey ? new StripeBillingProvider(config) : new MockBillingProvider(),
    }),
    analytics: new AnalyticsService({ notifications: repos.notifications }),
    platform: new PlatformService({ db, queue, tenants: repos.tenants, notifications: repos.notifications }),
  };

  // Observer subscriptions
  eventBus.subscribe('notification.status_changed', (e) => services.webhooks.enqueueEvent(e));
  eventBus.subscribe('notification.status_changed', async (e) => {
    logger.info('notification status changed', { tenantId: e.tenantId, notificationId: e.notificationId, from: e.previousStatus, to: e.status, channel: e.channel, attempts: e.attempts });
  });

  const handlers = {
    deliver: (payload) => services.delivery.processDelivery(payload),
    webhook: (payload) => services.webhooks.processDelivery(payload),
  };
  const createWorker = (workerId) => new Worker({ queue, handlers, config, logger, db, workerId });

  return { config, logger, db, repos, services, queue, channelFactory, limiter, eventBus, createWorker, close: () => db.close() };
}
module.exports = { createContainer };
