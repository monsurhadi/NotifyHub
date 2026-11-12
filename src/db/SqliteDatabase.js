'use strict';
const fs = require('node:fs');
const path = require('node:path');

const normalize = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

/**
 * SQLite adapter (Node's built-in node:sqlite, no native build needed).
 * All statements are serialised through one promise chain so a transaction
 * can never be interleaved with statements from other requests.
 * Inside `transaction(fn)` always use the `tx` handle, never `this`.
 */
class SqliteDatabase {
  constructor(file) {
    const { DatabaseSync } = require('node:sqlite');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.dialect = 'sqlite';
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
    this._tail = Promise.resolve();
  }

  _exclusive(fn) {
    const result = this._tail.then(fn, fn);
    this._tail = result.catch(() => {});
    return result;
  }

  _run(sql, params) { const r = this.db.prepare(sql).run(...normalize(params)); return { changes: Number(r.changes) }; }
  _get(sql, params) { const r = this.db.prepare(sql).get(...normalize(params)); return r ? { ...r } : null; }
  _all(sql, params) { return this.db.prepare(sql).all(...normalize(params)).map((r) => ({ ...r })); }

  exec(sql) { return this._exclusive(() => this.db.exec(sql)); }
  run(sql, params = []) { return this._exclusive(() => this._run(sql, params)); }
  get(sql, params = []) { return this._exclusive(() => this._get(sql, params)); }
  all(sql, params = []) { return this._exclusive(() => this._all(sql, params)); }

  transaction(fn) {
    return this._exclusive(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      const tx = {
        dialect: 'sqlite',
        run: async (s, p = []) => this._run(s, p),
        get: async (s, p = []) => this._get(s, p),
        all: async (s, p = []) => this._all(s, p),
      };
      try {
        const result = await fn(tx);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw err;
      }
    });
  }

  async close() { await this._exclusive(() => this.db.close()); }
}

module.exports = { SqliteDatabase };
