'use strict';
const crypto = require('crypto');
const session = require('express-session');
const db = require('../db');

// ------------------------------------------------------------ Mots de passe
// scrypt (intégré à Node.js) avec sel aléatoire par utilisateur.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(pw, stored) {
  try {
    const [algo, n, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Hachage factice pour égaliser le temps de réponse quand l'utilisateur n'existe pas.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (pw.length > 200) return 'Mot de passe trop long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Le mot de passe doit contenir des lettres et des chiffres.';
  return null;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// ------------------------------------------------------------ Rôles & permissions
const ROLE_LABELS = {
  owner: 'Propriétaire / Administrateur principal',
  ops: 'Responsable des opérations',
  staff: 'Collaborateur',
};

const PERMISSIONS = {
  owner: ['*'],
  ops: [
    'dashboard', 'requests.view_all', 'requests.edit', 'requests.notes', 'requests.assign', 'requests.export',
    'quotes.view', 'quotes.edit', 'quotes.record_response', 'calendar', 'tasks.manage',
    'payments.view', 'payments.record', 'partners.view', 'messages.view',
  ],
  staff: ['dashboard', 'requests.view_assigned', 'requests.notes', 'calendar', 'tasks.own'],
};

function can(user, perm) {
  if (!user || !user.active) return false;
  const list = PERMISSIONS[user.role] || [];
  return list.includes('*') || list.includes(perm);
}

function canSeeRequest(user, request) {
  if (can(user, 'requests.view_all')) return true;
  return can(user, 'requests.view_assigned') && request && request.assigned_to === user.id;
}

// ------------------------------------------------------------ Middlewares
function loadUser(req, res, next) {
  req.user = null;
  if (req.session && req.session.userId) {
    const u = db.get().prepare('SELECT id, email, name, role, active FROM users WHERE id = ?').get(req.session.userId);
    if (u && u.active) req.user = u;
    else if (req.session) delete req.session.userId;
  }
  res.locals.user = req.user;
  res.locals.can = (perm) => can(req.user, perm);
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect('/admin/connexion?next=' + encodeURIComponent(req.originalUrl));
  return res.status(401).send('Authentification requise.');
}

function requirePerm(...perms) {
  return (req, res, next) => {
    if (perms.some((p) => can(req.user, p))) return next();
    res.status(403);
    return res.render('admin/error', { title: 'Accès refusé', message: 'Vous n’avez pas la permission d’accéder à cette page.' });
  };
}

// ------------------------------------------------------------ Stockage des sessions (SQLite)
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.timer = setInterval(() => this.prune(), 60 * 60 * 1000);
    this.timer.unref();
  }
  prune() {
    db.get().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }
  expiry(sess) {
    return sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 3600e3;
  }
  get(sid, cb) {
    try {
      const r = db.get().prepare('SELECT sess, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!r || r.expires_at < Date.now()) return cb(null, null);
      cb(null, JSON.parse(r.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      db.get().prepare('INSERT INTO sessions (sid, sess, expires_at) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at')
        .run(sid, JSON.stringify(sess), this.expiry(sess));
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      db.get().prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(this.expiry(sess), sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try {
      db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroyUserSessions(userId, exceptSid) {
    const rows = db.get().prepare('SELECT sid, sess FROM sessions').all();
    for (const r of rows) {
      try {
        if (JSON.parse(r.sess).userId === userId && r.sid !== exceptSid) this.destroy(r.sid);
      } catch { /* ignore */ }
    }
  }
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, passwordProblem, sha256,
  ROLE_LABELS, PERMISSIONS, can, canSeeRequest, loadUser, requireAuth, requirePerm, SqliteStore,
};
