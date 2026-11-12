# NotifyHub API reference

Base URL: `http://localhost:3000`. All bodies are JSON unless noted.

## Authentication

| Credential | How to get it | Header | Works for |
|---|---|---|---|
| **Dashboard token** (JWT) | `POST /api/auth/login` | `Authorization: Bearer <token>` | everything |
| **API key** (`nh_<id>_<secret>`) | `POST /api/keys` or the dashboard | `Authorization: Bearer nh_...` (or `X-API-Key: nh_...`) | the tenant API (`/v1/*`) only |
| Admin token | `ADMIN_TOKEN` setting | `X-Admin-Token: <value>` | `GET /api/platform/overview` |
| Callback secret | `PROVIDER_CALLBACK_SECRET` setting | `X-Callback-Secret: <value>` | provider receipts |

New accounts must verify their email before login. Verification and password-reset tokens are stored as SHA-256 hashes,
expire, and can be consumed once. Password-reset requests return the same public message whether the address exists.

The tenant is always taken from the credential. A `tenant_id` in a body or header is ignored.

## Errors

```json
{ "error": { "code": "missing_placeholders", "message": "Missing values for placeholders: code", "details": { "missing": ["code"] } } }
```

| HTTP | Typical codes |
|---|---|
| 400 | `bad_request`, `malformed_json`, `invalid_recipient`, `unsupported_channel`, `invalid_template_syntax`, `invalid_date_range`, `batch_rejected` |
| 401 | `unauthorized`, `invalid_token`, `invalid_api_key`, `invalid_credentials`, `invalid_secret` |
| 403 | `login_required` (API key used on an admin endpoint), `tenant_suspended` |
| 404 | `notification_not_found`, `template_not_found`, `api_key_not_found`, `webhook_not_found` (also returned for other tenants' ids) |
| 409 | `duplicate_tenant`, `duplicate_template`, `template_archived`, `already_pro`, `checkout_closed` |
| 413 | `batch_too_large` (more than 1000 recipients) |
| 422 | `missing_placeholders`, `template_channel_mismatch`, `template_archived` |
| 429 | `account_locked` (3 failed logins), `plan_limit_reached` |
| 402 | `card_declined`, `card_invalid` (checkout simulator) |

## Public

| Method and path | Body | Result |
|---|---|---|
| `GET /health` | | `{status, database, workers, time}` |
| `POST /api/register` | `{companyName, email, password}` | `201 {tenant, message}`. A confirmation email is sent. |
| `POST /api/auth/verify-email` | `{token}` | Consumes an email verification link. |
| `POST /api/auth/password-reset` | `{email}` | Generic response; sends a reset email only if the address belongs to an account. |
| `POST /api/auth/password-reset/complete` | `{token, password}` | Consumes the reset link and updates the password. |
| `POST /api/auth/login` | `{email, password}` | `{token, expiresIn, tenant}`. Email verification required. After 3 wrong passwords the account is locked for `LOGIN_LOCK_SECONDS`. |
| `POST /internal/provider-callbacks/:notificationId` | `{status: "delivered" or "failed"}` + `X-Callback-Secret` | delivery receipt from a provider |

## Dashboard-only (needs the login token)

| Method and path | Purpose |
|---|---|
| `GET /api/me` | current workspace and user |
| `GET /api/keys`, `POST /api/keys {name}`, `DELETE /api/keys/:id` | API keys. The secret is returned only by `POST`. |
| `GET /api/webhooks` | `{signingSecret, endpoints}` |
| `POST /api/webhooks {url}`, `DELETE /api/webhooks/:id` | register / remove an endpoint |
| `GET /api/webhooks/attempts?limit=` | recent webhook delivery attempts |
| `GET /api/rate-limits`, `PUT /api/rate-limits {channel, perMinute}` | per-channel limit (1 to 100000) |
| `GET /api/billing` | plan, limit, usage, events |
| `POST /api/billing/checkout` | start an upgrade: `{sessionId, mode, url}` |
| `POST /api/billing/checkout/:id/pay {cardNumber}` | simulator only: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined |
| `POST /api/billing/checkout/:id/confirm` | Stripe mode: confirm after returning from Stripe |
| `POST /api/billing/checkout/:id/cancel` | cancel without charge |
| `GET /api/dev/outbox` | what the simulated provider "sent" (not in production) |
| `GET /api/platform/overview` | operator view: queue sizes, workers alive, dead jobs (`X-Admin-Token`) |

## Tenant API (`/v1`, login token or API key)

### Templates

| Method and path | Purpose |
|---|---|
| `POST /v1/templates` | `{name, channel, subject?, body}`. `channel` is `email`, `sms`, `whatsapp`, `telegram`, `webhook` or `in-app`. `subject` is required for email. Use `{{placeholder}}`. |
| `GET /v1/templates?includeArchived=true` | list |
| `GET /v1/templates/:id` | one template with its current version |
| `PUT /v1/templates/:id` | `{subject?, body?}` creates a **new version**. Archived templates cannot be edited. |
| `POST /v1/templates/:id/archive` | archive (existing logs are kept) |
| `GET /v1/templates/:id/versions` | version history |

Values are HTML-escaped for the email body and for in-app messages. SMS, WhatsApp, Telegram and webhook values are inserted as they are.

### Notifications

```
POST /v1/notifications
Idempotency-Key: order-1001            (optional, up to 128 characters)
{ "channel": "email", "recipient": "asha@example.com", "template_id": "<id>", "payload": { "name": "Asha" } }
-> 202 { "id": "...", "status": "queued", "channel": "email", "createdAt": "..." }
```

Recipient format by channel: email address; international phone number (`+8801712345678`) for SMS and WhatsApp; Telegram numeric chat id (or public channel username); `http(s)` URL (webhook); or a user reference (in-app, letters, digits and `_ . : @ -`). Sending the same `Idempotency-Key` again returns the
original notification (HTTP 200) and does not count twice.

`GET /api/providers/status` (dashboard JWT) reports provider types and configuration state without exposing credentials. Configure SMTP, Twilio, Meta WhatsApp Cloud API and Telegram Bot API through `.env`; see `.env.example`. SMS remains simulated unless `SMS_PROVIDER=twilio`. Telegram private-message recipients must be numeric chat ids; profile usernames and phone numbers do not work as private chat ids.

```
POST /v1/notifications/bulk
{ "channel": "email", "template_id": "<id>", "payload": { "name": "Friend" },
  "recipients": [ "a@example.com", { "recipient": "b@example.com", "payload": { "name": "Bea" } } ] }
-> 202 { "accepted": 2, "rejected": 0, "results": [ { "index": 0, "notificationId": "...", "status": "queued" }, ... ] }
```

1 to 1000 recipients. An invalid recipient is reported in `results` and does not block the others. If the monthly plan
limit is reached part-way, the rest are rejected with `plan_limit_reached`.

| Method and path | Purpose |
|---|---|
| `GET /v1/notifications/:id` | status, rendered subject and body, `deliveryAttempts` |
| `GET /v1/notifications?status=&channel=&limit=&offset=` | list (recipients masked) |
| `GET /v1/inbox/:userRef` | in-app messages for a user reference |

Statuses: `queued`, `processing`, `retrying`, `sent`, `delivered`, `failed`.

### Analytics and usage

| Method and path | Purpose |
|---|---|
| `GET /v1/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&channel=&status=` | totals, per channel, per day. `status` accepts `delivered` (sent + delivered), `failed`, `pending` or a raw status. Defaults to the last 30 days. |
| `GET /v1/analytics/export.csv?from=&to=&channel=&status=` | CSV with masked recipients |
| `GET /v1/usage` | plan, monthly limit and usage |

## Webhook events

NotifyHub POSTs to every registered endpoint on each status change (`queued`, `retrying`, `sent`, `delivered`, `failed`):

```json
{ "id": "evt_...", "type": "notification.status_changed", "created_at": "2026-03-02T10:00:00.000Z",
  "data": { "notification_id": "...", "status": "delivered", "previous_status": "queued", "channel": "email", "attempts": 1, "error": null } }
```

Headers: `X-NotifyHub-Signature: sha256=<hex>`, `X-NotifyHub-Event`, `X-NotifyHub-Delivery` (event id).
Answer with any 2xx. Otherwise NotifyHub retries 3 times with growing delays and then stops.

Verify the signature against the **raw** request body with your signing secret (shown in the dashboard):

```js
const crypto = require('node:crypto');
function isValid(rawBody, header, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

Notifications on the `webhook` channel (recipient is a URL) are signed the same way with the tenant's secret.
