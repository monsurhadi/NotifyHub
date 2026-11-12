'use strict';
const path = require('node:path');

const int = (v, d) => (v === undefined || v === '' || Number.isNaN(parseInt(v, 10)) ? d : parseInt(v, 10));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

/**
 * Central configuration. Every value can be set with an environment variable
 * (see .env.example). `overrides` lets tests inject their own values.
 */
function loadConfig(overrides = {}) {
  const e = process.env;
  const config = {
    env: e.NODE_ENV || 'development',
    port: int(e.PORT, 3000),
    logLevel: e.LOG_LEVEL || 'info',

    // storage: SQLite file by default, PostgreSQL when DATABASE_URL is set
    databaseUrl: e.DATABASE_URL || '',
    sqlitePath: e.SQLITE_PATH || path.join(process.cwd(), 'data', 'notifyhub.db'),

    // auth
    jwtSecret: e.JWT_SECRET || 'dev-only-change-me',
    jwtTtlSeconds: int(e.JWT_TTL_SECONDS, 3600),
    loginMaxAttempts: int(e.LOGIN_MAX_ATTEMPTS, 3),
    loginLockSeconds: int(e.LOGIN_LOCK_SECONDS, 300),
    emailVerificationTtlMs: int(e.EMAIL_VERIFICATION_TTL_HOURS, 24) * 60 * 60 * 1000,
    passwordResetTtlMs: int(e.PASSWORD_RESET_TTL_MINUTES, 60) * 60 * 1000,
    adminToken: e.ADMIN_TOKEN || 'dev-admin-token',
    providerCallbackSecret: e.PROVIDER_CALLBACK_SECRET || 'dev-callback-secret',

    // delivery
    maxDeliveryAttempts: int(e.MAX_DELIVERY_ATTEMPTS, 5), // total attempts, first try included
    retryBaseMs: int(e.RETRY_BASE_MS, 2000),
    retryMaxMs: int(e.RETRY_MAX_MS, 300000),
    bulkMax: int(e.BULK_MAX, 1000),

    // rate limiting (per tenant, per channel)
    defaultRatePerMinute: int(e.DEFAULT_RATE_PER_MINUTE, 100),
    rateWindowMs: int(e.RATE_WINDOW_MS, 60000),
    rateConfigCacheMs: int(e.RATE_CONFIG_CACHE_MS, 10000), // must stay well below 60 s (FR-10)

    // webhooks
    webhookMaxRetries: int(e.WEBHOOK_MAX_RETRIES, 3), // retries after the first attempt
    webhookRetryBaseMs: int(e.WEBHOOK_RETRY_BASE_MS, 5000),
    webhookTimeoutMs: int(e.WEBHOOK_TIMEOUT_MS, 5000),
    allowPrivateWebhookTargets: bool(e.ALLOW_PRIVATE_WEBHOOK_TARGETS, (e.NODE_ENV || 'development') !== 'production'),

    // queue / worker
    workerPollMs: int(e.WORKER_POLL_MS, 500),
    workerConcurrency: int(e.WORKER_CONCURRENCY, 5),
    jobLockTimeoutMs: int(e.JOB_LOCK_TIMEOUT_MS, 60000),
    maxJobClaims: int(e.MAX_JOB_CLAIMS, 25),
    embeddedWorker: bool(e.EMBEDDED_WORKER, true),

    // plans (FR-15)
    plans: {
      free: { name: 'Free', monthlyLimit: int(e.FREE_PLAN_LIMIT, 1000) },
      pro: { name: 'Pro', monthlyLimit: int(e.PRO_PLAN_LIMIT, 50000) },
    },

    // e-mail: real SMTP when SMTP_HOST is set, otherwise the simulated provider
    smtp: {
      host: e.SMTP_HOST || '',
      port: int(e.SMTP_PORT, 587),
      user: e.SMTP_USER || '',
      pass: e.SMTP_PASS || '',
      from: e.SMTP_FROM || 'NotifyHub <no-reply@notifyhub.local>',
    },

    // SMS: Twilio when selected; simulation remains the safe local default.
    sms: {
      provider: String(e.SMS_PROVIDER || 'simulated').toLowerCase(),
      accountSid: e.TWILIO_ACCOUNT_SID || '',
      authToken: e.TWILIO_AUTH_TOKEN || '',
      from: e.TWILIO_FROM || '',
      messagingServiceSid: e.TWILIO_MESSAGING_SERVICE_SID || '',
    },

    // WhatsApp Cloud API (Meta) and Telegram Bot API are enabled when credentials are configured.
    whatsapp: {
      accessToken: e.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID || '',
      apiVersion: e.WHATSAPP_API_VERSION || '',
    },
    telegram: { botToken: e.TELEGRAM_BOT_TOKEN || '' },

    // billing: Stripe test mode when STRIPE_SECRET_KEY is set, otherwise a built-in simulator
    stripeSecretKey: e.STRIPE_SECRET_KEY || '',
    publicBaseUrl: e.PUBLIC_BASE_URL || `http://localhost:${int(e.PORT, 3000)}`,
  };
  const merged = { ...config, ...overrides };
  merged.plans = { ...config.plans, ...(overrides.plans || {}) };
  return merged;
}

module.exports = { loadConfig };
