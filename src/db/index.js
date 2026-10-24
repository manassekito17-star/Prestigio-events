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
  return db;
}

function get() {
  if (!db) open();
  return db;
}

function tx(fn) {
  return get().transaction(fn)();
}

module.exports = { open, get, tx };
