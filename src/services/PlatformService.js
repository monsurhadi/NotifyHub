'use strict';

/** Platform Administrator view (use case "Monitor platform health") and the public health check. */
class PlatformService {
  constructor({ db, queue, tenants, notifications }) { Object.assign(this, { db, queue, tenants, notifications }); }

  async workersAlive() {
    const row = await this.db.get('SELECT COUNT(*) AS n FROM worker_heartbeats WHERE last_seen > ?', [Date.now() - 15000]);
    return row.n;
  }

  async health() {
    await this.db.get('SELECT 1 AS ok');
    return { status: 'ok', database: this.db.dialect, workers: await this.workersAlive(), time: new Date().toISOString() };
  }

  async overview() {
    const byStatus = {};
    for (const r of await this.notifications.countByStatus()) byStatus[r.status] = r.n;
    return {
      status: 'ok', database: this.db.dialect, workersAlive: await this.workersAlive(), tenants: await this.tenants.count(),
      queue: await this.queue.stats(), notificationsByStatus: byStatus, recentDeadJobs: await this.queue.recentDead(),
      time: new Date().toISOString(),
    };
  }
}
module.exports = { PlatformService };
