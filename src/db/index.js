'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

let db;

function open(file = config.dbFile) {
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  if (!db.prepare('SELECT version FROM schema_version').get()) {
    db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
    require('./seed').seed(db);
  }
  migrate(db);
  return db;
}

// Ajoute les colonnes apparues après la première installation (bases existantes).
function migrate(d) {
  const has = (table, col) => d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  const add = (table, col, def) => { if (!has(table, col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
  add('requests', 'budget_currency', "TEXT NOT NULL DEFAULT 'USD'");
  add('requests', 'discovery', 'TEXT');
  add('requests', 'discovery_internal', 'TEXT');
}

function get() {
  if (!db) open();
  return db;
}

function tx(fn) {
  return get().transaction(fn)();
}

module.exports = { open, get, tx };
