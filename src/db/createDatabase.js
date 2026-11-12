'use strict';
const { SqliteDatabase } = require('./SqliteDatabase');
const { PostgresDatabase } = require('./PostgresDatabase');

/** Picks the storage engine: PostgreSQL if DATABASE_URL is set, SQLite otherwise. */
function createDatabase(config) {
  return config.databaseUrl ? new PostgresDatabase(config.databaseUrl) : new SqliteDatabase(config.sqlitePath);
}
const isUniqueViolation = (err) => /UNIQUE constraint failed|duplicate key value/i.test(String(err && err.message)) || (err && err.code === '23505');

module.exports = { createDatabase, isUniqueViolation };
