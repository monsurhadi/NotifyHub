'use strict';

/**
 * PostgreSQL adapter. Same interface as SqliteDatabase; SQL is written with
 * "?" placeholders and translated to $1, $2 ... here.
 */
class PostgresDatabase {
  constructor(url) {
    const { Pool, types } = require('pg');
    types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT -> number
    this.dialect = 'postgres';
    this.pool = new Pool({ connectionString: url, max: 10 });
  }

  _t(sql) { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); }
  static _p(params) { return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p)); }

  async exec(sql) { await this.pool.query(sql); }
  async run(sql, params = []) { const r = await this.pool.query(this._t(sql), PostgresDatabase._p(params)); return { changes: r.rowCount }; }
  async get(sql, params = []) { const r = await this.pool.query(this._t(sql), PostgresDatabase._p(params)); return r.rows[0] || null; }
  async all(sql, params = []) { const r = await this.pool.query(this._t(sql), PostgresDatabase._p(params)); return r.rows; }

  async transaction(fn) {
    const client = await this.pool.connect();
    const q = (s, p = []) => client.query(this._t(s), PostgresDatabase._p(p));
    const tx = {
      dialect: 'postgres',
      run: async (s, p) => ({ changes: (await q(s, p)).rowCount }),
      get: async (s, p) => (await q(s, p)).rows[0] || null,
      all: async (s, p) => (await q(s, p)).rows,
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }
}

module.exports = { PostgresDatabase };
