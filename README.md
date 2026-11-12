# NotifyHub

A multi-tenant **notification orchestration platform**. A business (a *tenant*) signs up, gets an API key, defines message
templates and sends **email, SMS, WhatsApp, Telegram, webhook and in-app** notifications through one API. NotifyHub queues every message,
delivers it in the background, retries failures with exponential backoff, rate-limits per tenant, tracks every attempt,
reports status changes to the tenant by signed webhook, and shows analytics in a dashboard.

Local simulator mode runs for **$0** with no Docker or database server. Real delivery is optional and may incur provider charges.

* Node.js + Express, plain JavaScript, four runtime dependencies (`express`, `nodemailer`, `pg`, `undici`)
* SQLite out of the box, PostgreSQL when you set `DATABASE_URL`
* Object-oriented design: Strategy, Factory, Decorator, Observer, Repository (see `docs/ARCHITECTURE.md`)
* DevOps: Dockerfile, docker-compose (API + worker + PostgreSQL), GitHub Actions CI, 66 automated tests
* Red/orange responsive operations dashboard, one-click technical email template pack, and a per-recipient bulk composer

---

## 1. Quick start (about 2 minutes)

**You need:** [Node.js](https://nodejs.org) **22.13 or newer** (the current LTS is fine). Check with `node -v`.

```bash
# 1. unzip the project and open a terminal inside the folder
cd notifyhub

# 2. install dependencies
npm install

# 3. start the API (this also starts a background worker in the same process)
npm start
```

You should see `NotifyHub API listening` and `worker started`. Now open **http://localhost:3000** in your browser.

1. Click **Create workspace**, enter a company name, e-mail and password (8+ characters).
2. You land on the **Dashboard**. Go to **Templates** and choose **Add 15 starter templates**, or create an email template, for example
   subject `Hello {{name}}`, body `<p>Hi {{name}}, your code is {{code}}</p>`.
3. Go to **Notifications**, pick the template, enter any recipient such as `asha@example.com`, set the payload to
   `{"name": "Asha", "code": "4821"}` and press **Send**. The row appears as `queued`, then turns `delivered` within a second.
4. Click **Details** on the row to see the rendered message and every delivery attempt.

New workspaces must verify their email before sign-in. Use the emailed link; the local simulated-email demo also
shows a verification link on screen. **Forgot password?** sends a one-use link that expires after one hour. Point
`PUBLIC_BASE_URL` at your HTTPS domain before production so those links return to the right app.

For an email campaign, open **Bulk email**, choose a template, set shared JSON values, then add one recipient per line.
Add a name after a comma or tab after an address to personalize the name placeholder for that person. Invalid addresses
are reported in the result while valid recipients are queued. Bulk sends still use the platform quota and 1,000-recipient limit.

> No real e-mail is sent in this default mode. The **simulated provider** records what it "sent" (see section 6).
> To send real e-mail, put your SMTP details into `.env` (section 8).

### Try the whole flow with one command

With the server running, open a **second terminal** in the same folder:

```bash
npm run demo
```

It registers a workspace, creates an API key and a template, sends emails (one to a provider that fails twice so you
can watch the **retries**), receives **signed webhooks** on a local port, sends a **bulk** batch and prints the
analytics. At the end it prints a login you can use in the dashboard.

### Windows notes

* Use PowerShell or Command Prompt; the commands above are identical.
* To create the optional settings file: `copy .env.example .env`
* For the `curl` examples below, in PowerShell write `curl.exe` (not `curl`) or just use the dashboard and `npm run demo`.

---

## 2. Using the API

Every tenant call needs a key: `Authorization: Bearer nh_...` (create one in the dashboard under **API keys**, or with
`POST /api/keys`). The key is shown **once**; only a salted hash is stored. Replace `$KEY` and `$TEMPLATE_ID` below.

```bash
# create a template
curl -X POST http://localhost:3000/v1/templates -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"welcome","channel":"email","subject":"Hello {{name}}","body":"<p>Hi {{name}}, your code is {{code}}</p>"}'

# send a notification  ->  202 {"id":"...","status":"queued", ...}
curl -X POST http://localhost:3000/v1/notifications -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1001" \
  -d '{"channel":"email","recipient":"asha@example.com","template_id":"'$TEMPLATE_ID'","payload":{"name":"Asha","code":"4821"}}'

# check the status (queued -> processing -> delivered / retrying -> failed)
curl http://localhost:3000/v1/notifications/<id> -H "Authorization: Bearer $KEY"

# bulk send (1 to 1000 recipients, each one tracked separately)
curl -X POST http://localhost:3000/v1/notifications/bulk -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"channel":"email","template_id":"'$TEMPLATE_ID'","payload":{"name":"Friend","code":"1"},"recipients":["a@example.com","b@example.com"]}'
```

The full reference (all endpoints, error format, webhook signature verification) is in **`docs/API.md`**.

---

## 3. Watching the reliability features work

The simulated provider fails on purpose for special recipients, so you can see retries without any setup:

| Recipient | Behaviour |
|---|---|
| `flaky@example.com` | fails attempts 1 and 2, succeeds on attempt 3 |
| `fail@example.com` | always fails: 5 attempts, then status `failed` |
| `timeout@example.com` | always times out |
| `empty@example.com` | provider answers without a message id: treated as a failure, never as success |
| SMS `+15550000001` / `+15550000002` | always fails / flaky |

Retry delays double each time: `RETRY_BASE_MS` x 1, 2, 4, 8 (2, 4, 8, 16 seconds by default; use
`RETRY_BASE_MS=300 npm start` for a faster demo). Open a notification's **Details** to see each attempt.

Other things to try: set a low **rate limit** (dashboard, *Rate limits*) and send a burst: extra messages are held and
sent in the next window, never dropped. Add a **webhook** endpoint and watch the signed events arrive. Use the
**Plan & billing** page to upgrade with the test card `4242 4242 4242 4242` (the card `4000 0000 0000 0002` is declined).

---

## 4. Running it with PostgreSQL

SQLite is perfect for development. For a "real" setup use PostgreSQL by setting one variable:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/notifyhub npm start
```

The tables are created automatically. Free hosted PostgreSQL is available from Neon and Supabase.

### Docker (API + worker + PostgreSQL in one command)

```bash
docker compose up --build        # then open http://localhost:3000
docker compose up --scale worker=3   # three workers share the queue
```

Set `JWT_SECRET`, `ADMIN_TOKEN` and `PROVIDER_CALLBACK_SECRET` in your shell or a `.env` file next to the compose file
before exposing it publicly.

### API and worker as separate processes (no Docker)

```bash
EMBEDDED_WORKER=false npm start      # terminal 1: API only
npm run worker                       # terminal 2: a worker (start as many as you like)
```

On Windows PowerShell set the variable first: `$env:EMBEDDED_WORKER="false"; npm start`.

---

## 5. Tests

```bash
npm test
```

66 automated tests run the real application against a temporary database (about 25 seconds). They cover registration,
login lockout, API keys, templates and versioning, single/bulk sending and the 1000-recipient boundary, channel routing,
retries and backoff, rate limiting, crash recovery, duplicate protection, signed webhooks and their retries, tenant
isolation, analytics and CSV export, plan limits and upgrades, and four workers draining a queue without duplicates.

To run the very same tests against PostgreSQL:

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

(Each test file creates and drops its own database.) The test files line up with the designed test cases:

| Test case area | Test file |
|---|---|
| Single notification, routing, idempotency | `test/notifications.test.js` |
| Bulk and batch limit | `test/bulk.test.js` |
| Retry, rate limiting, crash recovery, per-IP limits and webhook target safety | `test/reliability.test.js`, `test/concurrency.test.js`, `test/security.test.js` |
| Template rendering, edit/archive | `test/templates.test.js`, `test/units.test.js` |
| Webhook status events | `test/webhooks.test.js` |
| Tenant data isolation | `test/isolation.test.js` |
| Analytics and CSV export | `test/analytics.test.js` |
| Plan limits and upgrade | `test/billing.test.js` |
| Registration, login, API keys, health | `test/auth.test.js` |

---

## 6. Where is my e-mail? (simulated provider)

With no SMTP settings, e-mail and SMS are "sent" by a simulated provider that stores each message in an `outbox` table.
The dashboard has no page for it, so read it through the API:

```bash
curl http://localhost:3000/api/dev/outbox -H "Authorization: Bearer <dashboard login token>"
```

(The login token is the `token` returned by `POST /api/auth/login`.) This endpoint is switched off when `NODE_ENV=production`.

---

## 7. Project structure

```
notifyhub/
├── src/
│   ├── server.js, worker.js, app.js, container.js   entry points, Express app, wiring (composition root)
│   ├── config.js, logger.js
│   ├── domain/        constants, errors, validators, template engine (pure logic)
│   ├── channels/      NotificationChannel (Strategy), Email/Sms/WhatsApp/Telegram/Webhook/InApp, ChannelFactory, SimulatedProvider
│   ├── decorators/    RateLimit, Logging, Retry decorators around a channel
│   ├── queue/         DbJobQueue (atomic claim, crash recovery) and Worker
│   ├── services/      Auth, ApiKey, Template, Notification, Delivery, Webhook, Billing, Analytics, Platform, EventBus, RateLimiter
│   ├── repositories/  all SQL; every tenant-facing query takes the tenant id
│   ├── billing/       Mock (Stripe-test simulator) and real Stripe providers
│   ├── db/            SQLite + PostgreSQL adapters, schema, migration
│   ├── middleware/    authentication, error handling
│   └── routes/        public, admin (dashboard-only) and /v1 (tenant API) routers
├── public/            dashboard (index.html, app.js, styles.css, no build step)
├── test/              66 tests
├── scripts/demo.js    end-to-end demo
├── docs/              API.md, ARCHITECTURE.md
├── Dockerfile, docker-compose.yml, .github/workflows/ci.yml
└── .env.example
```

---

## 8. Configuration

All settings are environment variables (or lines in a `.env` file in the project folder). `.env.example` lists every one
with comments. The most useful:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DATABASE_URL` | empty | PostgreSQL connection string. Empty means SQLite at `SQLITE_PATH` |
| `EMBEDDED_WORKER` | true | Run a worker inside the API process |
| `MAX_DELIVERY_ATTEMPTS` | 5 | Total attempts per notification |
| `RETRY_BASE_MS` | 2000 | Backoff base (doubles every retry) |
| `DEFAULT_RATE_PER_MINUTE` | 100 | Per tenant and channel; changeable in the dashboard |
| `FREE_PLAN_LIMIT` / `PRO_PLAN_LIMIT` | 1000 / 50000 | Notifications per month |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | empty | Real e-mail instead of the simulator |
| `SMS_PROVIDER` | `simulated` | Set `twilio` and configure Twilio credentials below for real SMS |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | empty | Twilio SMS sender and account credentials |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` | empty | Meta WhatsApp Cloud API text messages |
| `TELEGRAM_BOT_TOKEN` | empty | Telegram Bot API; destination must be a numeric chat id or public channel username |
| `STRIPE_SECRET_KEY` | empty | Real Stripe **test-mode** checkout instead of the simulator |
| `JWT_SECRET`, `ADMIN_TOKEN`, `PROVIDER_CALLBACK_SECRET` | dev values | **Change before deploying** |
| `EMAIL_VERIFICATION_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES` | 24 / 60 | Expiry for one-use account links |
| `NODE_ENV` | development | `production` refuses default secrets, disables the dev outbox and requires `https` webhook URLs |

Real provider setup is optional. Settings shows which channels are configured, without exposing credentials. Email uses SMTP. SMS uses Twilio when SMS_PROVIDER=twilio; local development otherwise uses the simulator. WhatsApp uses Meta Cloud API; Telegram uses the Bot API. Provider acceptance is recorded as sent; it is not a delivery receipt. WhatsApp has Meta messaging-window and approved-template rules. A Telegram bot cannot start a private conversation: the user must start the bot first and the app needs the numeric chat id. A profile username alone is not a private chat id.

### Deploying for free

Run one web service (for example on Render, Railway or Fly.io free tiers) with `EMBEDDED_WORKER=true`, plus a free
PostgreSQL (Neon or Supabase) via `DATABASE_URL`. Do not rely on SQLite on hosts with a temporary disk. These hosts
terminate HTTPS for you; NotifyHub itself speaks plain HTTP behind them. Set `NODE_ENV=production` and your own secrets.
The CI workflow runs the tests on SQLite and PostgreSQL and builds the Docker image; add a deploy-hook job to it for
continuous deployment.

---

## 9. How it maps to the SRS

| Requirement | Where it lives |
|---|---|
| FR-01 Register tenant, confirmation email | `AuthService.register`, `SystemMailer` |
| FR-02 Login, lockout after 3 failures, token expiry | `AuthService.login`, `LOGIN_MAX_ATTEMPTS`, `JWT_TTL_SECONDS` |
| FR-03 API keys: shown once, hashed, revocable, one tenant each | `ApiKeyService`, `ApiKeyRepository` |
| FR-04 Templates with `{{placeholders}}`, missing value is an error | `TemplateService`, `templateEngine`, `NotificationService._render` |
| FR-05 Edit creates a version, archive blocks use | `TemplateService.update/archive`, `template_versions` |
| FR-06 Send via one API call, 202 and an id | `POST /v1/notifications`, `NotificationService.create` |
| FR-07 Bulk up to 1000, partial failures do not block | `NotificationService.createBulk` |
| FR-08 Route by channel, reject unsupported | `ChannelFactory` |
| FR-09 Retry with exponential backoff, failure webhook | `RetryDecorator`, `DeliveryService`, `WebhookService` |
| FR-10 Per-channel rate limit, queued not dropped, live changes | `RateLimiter`, `RateLimitDecorator`, `/api/rate-limits` |
| FR-11 Status lookup, provider receipts | `GET /v1/notifications/:id`, `/internal/provider-callbacks/:id` |
| FR-12 Signed webhooks, 3 retries, attempts visible | `WebhookService`, dashboard *Webhooks* |
| FR-13 Dashboard by channel/status/date, 60 s refresh | `AnalyticsService`, `public/app.js` |
| FR-14 CSV export, masked recipients | `AnalyticsService.exportCsv` |
| FR-15 Plan and usage, HTTP 429 at the limit | `BillingService.overview`, `UsageRepository.reserve` |
| FR-16 Upgrade through test-mode checkout | `BillingService`, `MockBillingProvider`, `StripeBillingProvider` |
| NFR-01 fast accept | API only validates and enqueues; a test asserts the answer arrives in under 200 ms |
| NFR-02 scale workers | any number of workers share the queue (`test/concurrency.test.js`) |
| NFR-03 security | scrypt passwords, hashed API keys, HMAC-signed webhooks, strict CSP, per-IP request limits, public-address DNS pinning for outbound hooks, HTTPS via the host |
| NFR-04 tenant scoping in the repository layer | every tenant-facing repository method takes `tenantId` (`test/isolation.test.js`) |
| NFR-05 at-least-once | jobs whose worker died are re-queued; duplicates are suppressed (`test/reliability.test.js`) |
| NFR-07 open for new channels | `ChannelFactory.register()` (shown in `test/units.test.js`) |
| NFR-09 observability | JSON logs, `delivery_attempts` table, `/health`, `/api/platform/overview` |
| NFR-10 one-command run | `npm start` or `docker compose up --build` |

### Decisions and differences you should know about

* **SQLite and a database-backed queue by default**, instead of Redis/RabbitMQ, so it runs with zero installs. The same
  code runs on PostgreSQL. The queue is one small class (`src/queue/JobQueue.js`); a Redis or RabbitMQ version only has to
  provide the same six methods.
* **Retry count:** `MAX_DELIVERY_ATTEMPTS=5` means 5 attempts in total (1 first try + 4 retries). Section 3.3.4 of the SRS says
  "three attempts" while FR-09 says five; the value is configurable.
* **Rate limit behaviour:** over-limit messages are held and sent in the next window (FR-10), not rejected with an error
  as section 3.3.6 of the SRS suggests.
* **Webhook events** are sent for `queued`, `retrying`, `sent`, `delivered` and `failed`. The internal, transient
  `processing` state is not sent.
* **Status words** in the API are lower case (`queued`, `delivered`, ...). On the dashboard, "Delivered" counts `sent` +
  `delivered`. Real SMTP e-mail ends as `sent` until a provider receipt moves it to `delivered`; simulated and in-app/webhook
  deliveries are `delivered` immediately.
* **Account recovery** uses hashed, one-use verification and reset tokens. Existing accounts created before this feature are preserved as verified; new accounts must verify before login.
* **SMS** uses the local simulator by default; set `SMS_PROVIDER=twilio` to send through Twilio. WhatsApp and Telegram use their configured provider APIs.
* **Outbound webhooks** reject non-public DNS answers in production, pin connections to checked addresses and do not follow redirects. `ALLOW_PRIVATE_WEBHOOK_TARGETS` defaults on only outside production to support localhost development. The in-memory IP throttle is per app process; put a shared edge limit in front of multiple replicas.
* **Billing** uses a built-in checkout simulator that mimics Stripe test mode. Set `STRIPE_SECRET_KEY=sk_test_...` to use
  real Stripe Checkout in test mode.
* **Free plan 1,000 and Pro 50,000** notifications per month are assumptions (configurable); the SRS gives no numbers.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `node:sqlite` error / `Cannot find module 'node:sqlite'` | Your Node.js is too old. Install Node 22.13 or newer. |
| `EADDRINUSE` port already in use | Another program uses port 3000. Run with `PORT=3001 npm start` (PowerShell: `$env:PORT="3001"; npm start`). |
| Notifications stay `queued` | No worker is running. `npm start` runs one itself; with `EMBEDDED_WORKER=false` start `npm run worker`. |
| "Refusing to start in production with the default JWT_SECRET" | You set `NODE_ENV=production`. Set your own `JWT_SECRET` and `ADMIN_TOKEN`. |
| Started with a stale database after changing settings | Stop the server and delete the `data/` folder to start fresh. |
| Locked out after 3 wrong passwords | Wait 5 minutes (`LOGIN_LOCK_SECONDS`) or delete `data/`. |
#   N o t i f y H u b  
 