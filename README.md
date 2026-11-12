# NotifyHub

NotifyHub is a multi-tenant notification service with a web dashboard, REST API, background queue, reusable templates, delivery retries, per-channel rate limits, analytics, and signed webhooks.

It supports email, SMS, WhatsApp, Telegram, webhooks, and in-app notifications. By default, email and SMS use local simulators; real provider delivery is optional and can incur fees. Credentials are read from environment variables or a local .env file and are never displayed by the dashboard.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Run locally](#run-locally)
- [Configure real delivery](#configure-real-delivery)
- [Use the API](#use-the-api)
- [Dashboard tools](#dashboard-tools)
- [Configuration reference](#configuration-reference)
- [Tests](#tests)
- [Docker and deployment](#docker-and-deployment)
- [Security and limitations](#security-and-limitations)
- [Project structure](#project-structure)
- [Documentation and contributions](#documentation-and-contributions)

## Features

- Workspace registration, email verification, password reset, login lockout, and API keys
- Versioned templates with {{variable}} placeholders
- Single and bulk notification submission; bulk supports up to 1,000 recipients per request
- Background delivery queue with retries, exponential backoff, crash recovery, and idempotency
- Per-workspace, per-channel rate limits; held messages are queued for a later window
- Email, SMS, WhatsApp, Telegram, webhook, and in-app channel adapters
- Signed webhook events with retry history
- Dashboard analytics, filters, masked CSV export, plan usage, billing demo, and provider readiness indicators
- SQLite by default; PostgreSQL supported through DATABASE_URL
- Docker Compose setup and GitHub Actions CI

## Requirements

- Node.js 22.13 or newer
- npm
- Optional: Docker and Docker Compose for containerized use
- Optional: PostgreSQL for a shared or production database

## Run locally

From the project folder:

~~~bash
npm install
npm start
~~~

Open http://localhost:3000. npm start runs the API and an embedded worker by default. The first visit lets you create a workspace. In development, simulated email displays verification and password-reset links in the app flow.

To run the guided API demo in another terminal:

~~~bash
npm run demo
~~~

To use a local configuration file, copy the example and edit .env:

~~~powershell
Copy-Item .env.example .env
~~~

Keep .env private. It is ignored by Git. Never put real credentials in .env.example, commit them, or paste them into issues, chats, screenshots, or logs.

## Configure real delivery

Edit .env locally, save it, and restart NotifyHub. Settings → Delivery providers shows whether required configuration fields are present. This is a configuration check; it does not prove that a provider accepted a message or that a recipient received it.

### Email over SMTP

Set all required SMTP values. Example shape:

~~~dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM=NotifyHub <no-reply@example.com>
~~~

Port 465 uses secure SMTP in this application. Follow your mail provider’s rules for verified sender addresses, authentication, sending limits, and domain authentication. Use an app password or provider-issued SMTP credential when required; do not use your everyday account password.

Without a configured SMTP host, email is simulated.

### SMS through Twilio

~~~dotenv
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM=+15551234567
TWILIO_MESSAGING_SERVICE_SID=
~~~

Use either a Twilio sender number in international format or a Messaging Service SID. Check Twilio’s destination-country coverage, sender registration, and pricing before sending. SMS is pay-per-use.

Without SMS_PROVIDER=twilio, SMS uses the local simulator.

### WhatsApp through Meta Cloud API

~~~dotenv
WHATSAPP_ACCESS_TOKEN=your-meta-access-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_API_VERSION=vXX.X
~~~

Use the Graph API version currently supported by your Meta app. Meta test numbers may require recipients to be added and verified first. This adapter sends rendered text messages. WhatsApp’s messaging-window and approved-template policies still apply; provider acceptance is not a delivery receipt.

### Telegram Bot API

~~~dotenv
TELEGRAM_BOT_TOKEN=your-bot-token
~~~

Create the bot with Telegram’s @BotFather, then start a private chat with it. A private message needs a numeric chat ID; a user profile username alone is not a private chat ID. A public channel username can be used when the bot has permission to post there.

### Delivery status

Provider credentials can be valid while sending still fails because of account restrictions, sender approval, recipient permissions, template policies, quotas, or network errors. Check notification details and delivery attempts in the dashboard. Real provider adapter tests use mocked HTTP responses; npm test does not send live messages.

## Use the API

The full endpoint reference and request/response formats are in [docs/API.md](docs/API.md). Tenant API requests use a dashboard JWT or an API key:

~~~text
Authorization: Bearer <dashboard-token-or-api-key>
~~~

Create a template:

~~~bash
curl -X POST http://localhost:3000/v1/templates \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"name":"event-confirmation","channel":"email","subject":"You are registered, {{name}}","body":"Hello {{name}}, your event is {{event}}."}'
~~~

Create a notification:

~~~bash
curl -X POST http://localhost:3000/v1/notifications \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: registration-1001" \
  -d '{"channel":"email","recipient":"asha@example.com","template_id":"<TEMPLATE_ID>","payload":{"name":"Asha","event":"NotifyHub Live"}}'
~~~

The API responds with a queued notification ID. Check its status:

~~~bash
curl http://localhost:3000/v1/notifications/<NOTIFICATION_ID> \
  -H "Authorization: Bearer <API_KEY>"
~~~

Create an API key in the dashboard under **API keys**. The full key is shown only once; store it securely. API keys are for tenant API routes under /v1; dashboard-only routes require a login token.

## Dashboard tools

- **Dashboard:** delivery analytics, date/channel/status filters, and CSV export
- **Send a message:** compose one notification and inspect status and attempts
- **Bulk email:** personalize a template for up to 1,000 recipients
- **Templates:** create, edit, version, and archive reusable messages; starter templates are available
- **API keys:** create and revoke tenant API keys
- **Webhooks:** register a public endpoint, view the signing secret, and inspect delivery attempts
- **Plan & billing:** review usage and try the built-in checkout simulator
- **Rate limits:** change per-minute limits by channel and view provider configuration status

The development simulator includes special recipient values to demonstrate retry and failure behavior. See [docs/API.md](docs/API.md) and the automated tests for details.

## Configuration reference

All variables are optional unless required for a selected feature. .env.example contains safe defaults and blank provider credential fields.

| Variable | Default | Purpose |
|---|---|---|
| PORT | 3000 | HTTP server port |
| NODE_ENV | development | Runtime mode; production applies stricter checks |
| DATABASE_URL | empty | PostgreSQL connection string; empty uses SQLite |
| SQLITE_PATH | ./data/notifyhub.db | SQLite file location |
| EMBEDDED_WORKER | true | Run a worker with the API process |
| WORKER_CONCURRENCY | 5 | Concurrent jobs per worker |
| MAX_DELIVERY_ATTEMPTS | 5 | Total delivery attempts, including the first |
| RETRY_BASE_MS | 2000 | Exponential retry delay base |
| DEFAULT_RATE_PER_MINUTE | 100 | Default limit per workspace and channel |
| FREE_PLAN_LIMIT | 1000 | Free plan monthly notification quota |
| PRO_PLAN_LIMIT | 50000 | Pro plan monthly notification quota |
| SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM | host/user/pass empty; port 587 | SMTP email delivery |
| SMS_PROVIDER | simulated | Set to twilio to use Twilio |
| TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN | empty | Twilio account credentials |
| TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID | empty | Twilio sender configuration; provide one |
| WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION | empty | Meta WhatsApp Cloud API |
| TELEGRAM_BOT_TOKEN | empty | Telegram Bot API |
| JWT_SECRET, ADMIN_TOKEN, PROVIDER_CALLBACK_SECRET | development-only values | Replace with strong unique secrets before production |
| PUBLIC_BASE_URL | http://localhost:3000 | Origin used for links; use the public HTTPS origin in production |
| STRIPE_SECRET_KEY | empty | Optional Stripe Checkout provider; billing otherwise uses a simulator |

See [.env.example](.env.example) for additional timeout, retry, and authentication settings.

## Tests

Run the complete automated suite:

~~~bash
npm test
~~~

The suite contains 66 tests covering authentication, API keys, templates, notifications, bulk boundaries, provider adapters, retry and crash recovery, idempotency, rate limiting, tenant isolation, analytics/CSV export, billing, webhooks, validation, and worker concurrency.

The messaging-provider tests mock provider HTTP calls. They verify request construction and response handling without contacting Twilio, Meta, Telegram, or an SMTP server. Live credential verification and actual message delivery must be checked separately with controlled recipients.

To run against PostgreSQL, set TEST_DATABASE_URL before npm test:

~~~bash
TEST_DATABASE_URL=postgres://user:password@localhost:5432/notifyhub_test npm test
~~~

Use a dedicated test database. The test suite creates and removes test tables.

## Docker and deployment

Start the API, worker, and PostgreSQL using Compose:

~~~bash
docker compose up --build
~~~

For multiple workers, scale the worker service:

~~~bash
docker compose up --build --scale worker=3
~~~

Without Docker, run the API and worker separately:

~~~bash
EMBEDDED_WORKER=false npm start
npm run worker
~~~

PowerShell:

~~~powershell
$env:EMBEDDED_WORKER = "false"
npm start
~~~

Before deploying:

1. Set NODE_ENV=production.
2. Replace all development secrets with strong, unique values.
3. Set PUBLIC_BASE_URL to the public HTTPS address.
4. Use PostgreSQL or another persistent database. Do not rely on an ephemeral filesystem for SQLite data.
5. Configure provider credentials through the host’s secret manager or protected environment settings.
6. Configure HTTPS, backups, monitoring, and an external rate limit appropriate for your deployment.
7. Verify provider sending permissions and test with controlled recipients.

The app serves HTTP behind a reverse proxy or hosting platform that terminates TLS. Free hosting plans may sleep, have expiring databases, or block outbound SMTP; confirm the host’s current limits before production use.

## Security and limitations

- Passwords are hashed; API keys are stored hashed and shown once.
- Tenant data access is scoped by the authenticated tenant.
- Webhook destinations are validated; production requires HTTPS and blocks private-address targets.
- Webhook events are HMAC-signed. Protect the signing secret.
- Development defaults are not suitable for a public deployment.
- The IP rate limiter is process-local; multiple replicas need a shared edge or gateway limit.
- Provider configuration status checks required fields only. It does not validate credentials or guarantee delivery.
- SMTP, Twilio, Meta, Telegram, hosting, and payment providers may charge fees or enforce separate account rules.
- Billing defaults to a simulator; the optional Stripe path is not a complete recurring subscription lifecycle.
- The data/ directory contains local SQLite data and should be backed up before maintenance.

## Project structure

~~~text
src/
  billing/       Mock and Stripe checkout providers
  channels/      Email, SMS, WhatsApp, Telegram, webhook, and in-app adapters
  db/            SQLite/PostgreSQL adapters, schema, database setup
  decorators/    Retry, rate-limit, and logging wrappers
  domain/         Validation, errors, constants, template rendering
  middleware/     Authentication, rate limiting, and error handling
  queue/          Database-backed job queue and worker
  repositories/  SQL access, scoped by tenant
  routes/         Public, dashboard/admin, and tenant API routes
  services/       Authentication, delivery, templates, analytics, billing, webhooks
public/           Browser dashboard: HTML, JavaScript, CSS
test/             Automated unit and integration tests
docs/             API reference, architecture, contribution mapping
scripts/          Demo workflow
~~~

## Documentation and contributions

- API reference: [docs/API.md](docs/API.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Contribution mapping: [docs/CONTRIBUTIONS.md](docs/CONTRIBUTIONS.md)

The ZIP distribution includes four contribution review bundles. GitHub authorship is established by commits pushed from each contributor’s own account; a ZIP or copied module folder does not create verified contributor history.
