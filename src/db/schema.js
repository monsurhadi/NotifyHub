'use strict';

/**
 * Portable DDL (works on SQLite and PostgreSQL).
 * Timestamps shown to users are ISO-8601 TEXT; scheduling timestamps are epoch milliseconds (BIGINT).
 */
module.exports = [
  `CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    plan TEXT NOT NULL DEFAULT 'free',
    webhook_secret TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until BIGINT NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    consumed_at BIGINT,
    created_at BIGINT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_purpose ON auth_tokens(user_id, purpose, consumed_at)',
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    key_id TEXT NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id)',
  `CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    placeholders TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (template_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    payload TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created ON notifications(tenant_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_notifications_tenant_status ON notifications(tenant_id, status)',
  `CREATE TABLE IF NOT EXISTS delivery_attempts (
    id TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    provider_message_id TEXT,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_attempts_notification ON delivery_attempts(notification_id)',
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    run_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_at BIGINT,
    locked_by TEXT,
    last_error TEXT,
    created_at BIGINT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status, run_at)',
  `CREATE TABLE IF NOT EXISTS rate_limits (
    tenant_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    per_minute INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, channel)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_counters (
    tenant_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    hits INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, channel, window_start)
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    url TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_attempts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    notification_id TEXT,
    attempt_number INTEGER NOT NULL,
    http_status INTEGER,
    error TEXT,
    success INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_webhook_attempts_tenant ON webhook_attempts(tenant_id, created_at)',
  `CREATE TABLE IF NOT EXISTS in_app_messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_ref TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    notification_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    read_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_inapp_user ON in_app_messages(tenant_id, user_ref)',
  `CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    idem_key TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS usage_counters (
    tenant_id TEXT NOT NULL,
    period TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, period)
  )`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    tenant_id TEXT NOT NULL,
    idem_key TEXT NOT NULL,
    notification_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, idem_key)
  )`,
  `CREATE TABLE IF NOT EXISTS checkout_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_id TEXT PRIMARY KEY,
    last_seen BIGINT NOT NULL
  )`,
];
