'use strict';
const db = require('../db');

const JSON_KEYS = new Set(['socials', 'why_items', 'about_approach', 'values']);

function all() {
  const out = {};
  for (const r of db.get().prepare('SELECT key, value FROM settings').all()) {
    if (JSON_KEYS.has(r.key)) {
      try { out[r.key] = JSON.parse(r.value || 'null'); } catch { out[r.key] = null; }
    } else out[r.key] = r.value;
  }
  return out;
}

function get(key) {
  const r = db.get().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

function set(key, value) {
  const v = JSON_KEYS.has(key) && typeof value !== 'string' ? JSON.stringify(value) : value == null ? '' : String(value);
  db.get().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, v);
}

module.exports = { all, get, set, JSON_KEYS };
