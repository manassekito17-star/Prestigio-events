'use strict';
const db = require('../db');

function log(req, action, entity, entityId, details) {
  try {
    db.get().prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)')
      .run(req && req.user ? req.user.id : null, action, entity || null, entityId || null,
        details ? JSON.stringify(details).slice(0, 4000) : null, req ? req.ip : null);
  } catch (e) {
    console.error('audit log failed', e.message);
  }
}

module.exports = { log };
