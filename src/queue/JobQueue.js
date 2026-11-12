'use strict';
const { newId } = require('../util/crypto');

/**
 * Database-backed job queue (works on SQLite and PostgreSQL, no Redis needed).
 * - claim() is atomic: only one worker can take a job.
 * - A job whose worker died (lock older than jobLockTimeoutMs) goes back to "queued"  => at-least-once delivery (NFR-05).
 * To use Redis/RabbitMQ instead, implement this same interface (enqueue / claim / complete / reschedule / fail / stats).
 */
class DbJobQueue {
  constructor(db, config) { this.db = db; this.config = config; }

  async enqueue(type, payload, { runAt = Date.now() } = {}, tx = this.db) {
    const id = newId();
    await tx.run(
      'INSERT INTO jobs (id, type, payload, status, run_at, attempts, created_at) VALUES (?,?,?,?,?,0,?)',
      [id, type, JSON.stringify(payload), 'queued', runAt, Date.now()],
    );
    return id;
  }

  async claim(workerId) {
    const now = Date.now();
    await this.db.run(
      "UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL WHERE status = 'processing' AND locked_at < ?",
      [now - this.config.jobLockTimeoutMs],
    );
    const row = await this.db.get(
      `UPDATE jobs SET status = 'processing', locked_at = ?, locked_by = ?, attempts = attempts + 1
       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT 1) AND status = 'queued'
       RETURNING *`,
      [now, workerId, now],
    );
    return row ? { ...row, payload: JSON.parse(row.payload) } : null;
  }

  complete(id) { return this.db.run("UPDATE jobs SET status = 'done', locked_at = NULL, locked_by = NULL WHERE id = ?", [id]); }

  reschedule(id, runAt, { error = null, payload = null } = {}) {
    return this.db.run(
      `UPDATE jobs SET status = 'queued', run_at = ?, locked_at = NULL, locked_by = NULL, last_error = ?,
       payload = COALESCE(?, payload) WHERE id = ?`,
      [runAt, error, payload ? JSON.stringify(payload) : null, id],
    );
  }

  fail(id, error) { return this.db.run("UPDATE jobs SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?", [error, id]); }

  async stats() {
    const rows = await this.db.all('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status');
    const out = { queued: 0, processing: 0, done: 0, dead: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }
  recentDead(limit = 10) {
    return this.db.all("SELECT id, type, last_error, attempts, created_at FROM jobs WHERE status = 'dead' ORDER BY created_at DESC LIMIT ?", [limit]);
  }
}
module.exports = { DbJobQueue };
