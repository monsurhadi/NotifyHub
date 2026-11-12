# Individual Contribution Modules

This mapping follows the individual-contributions section of the NotifyHub project report. Each contribution bundle in the accompanying ZIP contains a source snapshot and the tests most directly related to that area. The complete application remains in the ZIP root because these modules share services, repositories, routes, and runtime wiring.

| Member | Student ID | Contribution area | Main test files |
|---|---:|---|---|
| MD. Zafor Iqbal Sakil | 24524203145 | Delivery reliability and queue: workers, atomic job claims, retries, rate limiting, duplicate protection, and crash recovery | `concurrency.test.js`, `reliability.test.js` |
| Monsur Hasan Hadi | 24524203149 | Accounts and notification dispatch: registration, login, API keys, single and bulk sends, channel routing, and idempotency | `auth.test.js`, `bulk.test.js`, `notifications.test.js`, `providers.test.js` |
| Rafsan Rafi | 24524203153 | Tenant isolation, analytics, CSV export, usage, plans, and billing | `isolation.test.js`, `analytics.test.js`, `billing.test.js` |
| Jannatul Ferdous Athoy | 24524203157 | Template engine and versioning, signed outbound webhooks, retries, delivery receipts, and in-app inbox | `templates.test.js`, `units.test.js`, `webhooks.test.js` |

All members are credited in the report for the SRS, SDLC selection, UML diagrams, and report. Some implementation files are cross-cutting and appear in more than one module snapshot; each module README calls out its integration boundaries.

## GitHub attribution

The module snapshots make the reported areas easy to review and stage separately. A ZIP cannot establish verified GitHub authorship. For accurate contributor attribution, each listed member should review their module, commit it from their own GitHub account, and push that commit themselves.
