'use strict';
const SCHEMA = require('./schema');

/** Creates all tables (idempotent). On PostgreSQL an advisory lock keeps API and worker from racing. */
async function migrate(db) {
  const grandfatherExistingAccounts = async (tx = db) => tx.run(`
    INSERT INTO auth_tokens (id, user_id, token_hash, purpose, expires_at, consumed_at, created_at)
    SELECT 'legacy-' || u.id, u.id, 'legacy-' || u.id, 'verify-email', 0, 0, 0
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM auth_tokens t WHERE t.user_id = u.id AND t.purpose = 'verify-email')
  `);
  if (db.dialect === 'postgres') {
    await db.transaction(async (tx) => {
      await tx.run('SELECT pg_advisory_xact_lock(727274)');
      for (const statement of SCHEMA) await tx.run(statement);
      await grandfatherExistingAccounts(tx);
    });
  } else {
    for (const statement of SCHEMA) await db.exec(statement);
    await grandfatherExistingAccounts();
  }
}
module.exports = { migrate };
