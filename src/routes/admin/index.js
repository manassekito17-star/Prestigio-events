'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../../db');
const auth = require('../../lib/auth');
const csrf = require('../../lib/csrf');
const audit = require('../../lib/audit');
const media = require('../../lib/media');
const mailer = require('../../lib/mailer');
const config = require('../../config');
const U = require('../../lib/util');
const setup = require('../../lib/setup');

const router = express.Router();

// Les pages d'administration ne doivent jamais être mises en cache ni indexées.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true,
  message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' });

// Formulaires de connexion : jeton CSRF stocké en session (session créée à l'affichage).
function ensureSession(req, res, next) {
  csrf.token(req);
  res.locals.csrfToken = req.session.csrf;
  next();
}

// ------------------------------------------------------------ Connexion
router.get('/connexion', ensureSession, (req, res) => {
  if (req.user) return res.redirect('/admin');
  res.render('admin/login', { title: 'Connexion', error: null, email: '', next: safeNext(req.query.next) });
});

function safeNext(n) {
  return typeof n === 'string' && /^\/admin(\/|$)/.test(n) && !n.startsWith('//') ? n : '/admin';
}

router.post('/connexion', loginLimiter, ensureSession, csrf.verify, (req, res, next) => {
  const email = U.str(req.body.email, 160).toLowerCase();
  const password = String(req.body.password || '');
  const u = db.get().prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = auth.verifyPassword(password, u ? u.password_hash : auth.DUMMY_HASH) && u && u.active;
  if (!ok) {
    audit.log(req, 'login_failed', 'user', u ? u.id : null, { email });
    return res.status(401).render('admin/login', { title: 'Connexion', error: 'Identifiants incorrects.', email, next: safeNext(req.body.next) });
  }
  // Nouvelle session à la connexion (protection contre la fixation de session)
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = u.id;
    csrf.token(req);
    db.get().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(u.id);
    req.user = u;
    audit.log(req, 'login', 'user', u.id);
    res.redirect(safeNext(req.body.next));
  });
});

router.post('/deconnexion', ensureSession, csrf.verify, (req, res) => {
  if (req.user) audit.log(req, 'logout', 'user', req.user.id);
  req.session.destroy(() => res.redirect('/admin/connexion'));
});

// ------------------------------------------------------------ Récupération du compte
router.get('/mot-de-passe-oublie', ensureSession, (req, res) => {
  res.render('admin/forgot', { title: 'Mot de passe oublié', sent: false, mailOk: mailer.isConfigured() });
});

router.post('/mot-de-passe-oublie', loginLimiter, ensureSession, csrf.verify, async (req, res) => {
  const email = U.str(req.body.email, 160).toLowerCase();
  const u = db.get().prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (u && mailer.isConfigured()) {
    const tokenStr = crypto.randomBytes(32).toString('base64url');
    db.get().prepare("UPDATE users SET reset_token_hash = ?, reset_expires_at = datetime('now', '+1 hour') WHERE id = ?").run(auth.sha256(tokenStr), u.id);
    try {
      await mailer.send({ to: u.email, subject: 'Réinitialisation de votre mot de passe — PRESTIGIO EVENTS',
        text: `Bonjour ${u.name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${config.baseUrl}/admin/reinitialiser/${tokenStr}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.` });
      audit.log(req, 'password_reset_requested', 'user', u.id);
    } catch (e) { console.error('reset mail', e.message); }
  }
  // Réponse identique que le compte existe ou non.
  res.render('admin/forgot', { title: 'Mot de passe oublié', sent: true, mailOk: mailer.isConfigured() });
});

function userByResetToken(tokenStr) {
  return db.get().prepare("SELECT * FROM users WHERE reset_token_hash = ? AND reset_expires_at > datetime('now') AND active = 1")
    .get(auth.sha256(String(tokenStr || '')));
}

router.get('/reinitialiser/:token', ensureSession, (req, res) => {
  const u = userByResetToken(req.params.token);
  res.render('admin/reset', { title: 'Nouveau mot de passe', valid: !!u, error: null, token: req.params.token });
});

router.post('/reinitialiser/:token', loginLimiter, ensureSession, csrf.verify, (req, res) => {
  const u = userByResetToken(req.params.token);
  if (!u) return res.render('admin/reset', { title: 'Nouveau mot de passe', valid: false, error: null, token: '' });
  const pw = String(req.body.password || '');
  const problem = auth.passwordProblem(pw) || (pw !== req.body.password2 ? 'Les deux mots de passe ne correspondent pas.' : null);
  if (problem) return res.render('admin/reset', { title: 'Nouveau mot de passe', valid: true, error: problem, token: req.params.token });
  db.get().prepare("UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(auth.hashPassword(pw), u.id);
  new auth.SqliteStore().destroyUserSessions(u.id);
  audit.log(req, 'password_reset_done', 'user', u.id);
  req.flash('ok', 'Mot de passe modifié. Vous pouvez vous connecter.');
  res.redirect('/admin/connexion');
});

// ------------------------------------------------------------ Installation (lien à usage unique)
function setupGuard(req, res, next) {
  if (setup.checkToken(req.params.token)) return next();
  res.status(404);
  return res.render('admin/setup-closed', { title: 'Lien non valide' });
}

router.get('/installation/:token(*)', loginLimiter, setupGuard, ensureSession, (req, res) => {
  res.render('admin/setup', { title: 'Création du compte propriétaire', error: null, form: {}, token: req.params.token });
});

router.post('/installation/:token(*)', loginLimiter, setupGuard, ensureSession, csrf.verify, (req, res, next) => {
  const b = req.body;
  const form = { name: U.str(b.name, 120), email: U.str(b.email, 160).toLowerCase() };
  const error = !form.name ? 'Indiquez votre nom.'
    : !U.isEmail(form.email) ? 'Adresse e-mail invalide.'
      : auth.passwordProblem(b.password) || (b.password !== b.password2 ? 'Les deux mots de passe ne correspondent pas.' : null);
  if (error) return res.status(400).render('admin/setup', { title: 'Création du compte propriétaire', error, form, token: req.params.token });
  let userId;
  try {
    db.tx(() => {
      // Vérification dans la transaction : un seul compte peut être créé par ce lien.
      if (!setup.isOpen()) throw Object.assign(new Error('closed'), { closed: true });
      userId = Number(db.get().prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'owner')")
        .run(form.email, form.name, auth.hashPassword(b.password)).lastInsertRowid);
      setup.complete();
    });
  } catch (e) {
    if (e.closed) return res.status(404).render('admin/setup-closed', { title: 'Lien non valide' });
    return next(e);
  }
  req.user = { id: userId };
  audit.log(req, 'owner_created_via_setup_link', 'user', userId, { email: form.email });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = userId;
    csrf.token(req);
    req.flash('ok', 'Votre compte propriétaire est créé. Le lien d’installation est désormais désactivé.');
    res.redirect('/admin');
  });
});

// ------------------------------------------------------------ Zone protégée
router.use(auth.requireAuth);
router.use(csrf.provide);

// Fichiers joints : traités avant la vérification CSRF (le jeton est dans le corps multipart).
router.use((req, res, next) => {
  if (req.method === 'POST' && req.is('multipart/form-data')) {
    return media.upload.any()(req, res, (err) => {
      if (err) { media.cleanup(req.files); return next(err); }
      res.on('finish', () => media.cleanup(req.files)); // fichiers temporaires non utilisés
      next();
    });
  }
  next();
});
router.use((req, res, next) => csrf.verify(req, res, next));

// Données communes au gabarit d'administration
router.use((req, res, next) => {
  const c = (sql) => db.get().prepare(sql).get().n;
  res.locals.badge = {
    pending: auth.can(req.user, 'quotes.view') ? c("SELECT COUNT(*) AS n FROM requests WHERE status IN ('pending_validation','editing','approved')") : 0,
    unseen: auth.can(req.user, 'requests.view_all') ? c('SELECT COUNT(*) AS n FROM requests WHERE seen_at IS NULL') : 0,
    messages: auth.can(req.user, 'messages.view') ? c('SELECT COUNT(*) AS n FROM contact_messages WHERE handled = 0') : 0,
  };
  res.locals.mailConfigured = mailer.isConfigured();
  next();
});

router.use('/', require('./dashboard'));
router.use('/', require('./requests'));
router.use('/', require('./operations'));
router.use('/', require('./catalog'));
router.use('/', require('./content'));
router.use('/', require('./partners'));
router.use('/', require('./system'));

module.exports = router;
