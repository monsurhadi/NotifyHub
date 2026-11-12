'use strict';
const { randomHex } = require('../util/crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pulls jobs from the queue and runs the matching handler. Several workers can run side by side. */
class Worker {
  constructor({ queue, handlers, config, logger, db, workerId }) {
    Object.assign(this, { queue, handlers, config, logger, db });
    this.id = workerId || `worker-${randomHex(4)}`;
    this.running = false;
    this.active = new Set();
  }

  async runJob(job) {
    try {
      const handler = this.handlers[job.type];
      if (!handler) { await this.queue.fail(job.id, `No handler for job type "${job.type}"`); return; }
      const outcome = await handler(job.payload);
      if (outcome && outcome.reschedule) await this.queue.reschedule(job.id, outcome.reschedule, { payload: outcome.payload });
      else await this.queue.complete(job.id);
    } catch (err) {
      this.logger.error('job failed unexpectedly', { jobId: job.id, type: job.type, claims: job.attempts, err: err.message });
      if (job.attempts >= this.config.maxJobClaims) await this.queue.fail(job.id, err.message);
      else await this.queue.reschedule(job.id, Date.now() + Math.min(1000 * 2 ** Math.min(job.attempts, 6), 60000), { error: err.message });
    }
  }

  async _heartbeat() {
    await this.db.run(
      'INSERT INTO worker_heartbeats (worker_id, last_seen) VALUES (?,?) ON CONFLICT (worker_id) DO UPDATE SET last_seen = excluded.last_seen',
      [this.id, Date.now()],
    ).catch(() => {});
  }

  start() {
    this.running = true;
    this._heartbeat();
    this.heartbeatTimer = setInterval(() => this._heartbeat(), 5000);
    this.loop = this._loop();
    this.logger.info('worker started', { workerId: this.id, concurrency: this.config.workerConcurrency });
  }

  async _loop() {
    while (this.running) {
      let claimedAny = false;
      try {
        while (this.running && this.active.size < this.config.workerConcurrency) {
          const job = await this.queue.claim(this.id);
          if (!job) break;
          claimedAny = true;
          const task = this.runJob(job).finally(() => this.active.delete(task));
          this.active.add(task);
        }
      } catch (err) {
        this.logger.error('worker poll failed', { err: err.message });
      }
      if (!claimedAny) await sleep(this.config.workerPollMs);
      else await sleep(1);
    }
  }

  async stop() {
    this.running = false;
    clearInterval(this.heartbeatTimer);
    await this.loop;
    await Promise.allSettled([...this.active]);
    this.logger.info('worker stopped', { workerId: this.id });
  }

  /** Test helper: process jobs (waiting for deferred ones) until the queue is empty. */
  async drain(timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.queue.claim(this.id);
      if (job) { await this.runJob(job); continue; }
      const s = await this.queue.stats();
      if (s.queued === 0 && s.processing === 0) return;
      if (Date.now() > end) throw new Error(`drain timeout: ${JSON.stringify(s)}`);
      await sleep(15);
    }
  }
}
module.exports = { Worker };
