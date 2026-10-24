'use strict';
// Comptes utilisateurs, mon compte, messages de contact, journal d'audit, sauvegardes.
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../../db');
const auth = require('../../lib/auth');
const audit = require('../../lib/audit');
const config = require('../../config');
const U = require('../../lib/util');

const router = express.Router();

// ------------------------------------------------------------ Mon compte
router.get('/compte', (req, res) => res.render('admin/account', { title: 'Mon compte', error: null }));

router.post('/compte', (req, res) => {
  const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { current, password, password2 } = req.body;
  let error = null;
  if (!auth.verifyPassword(String(current || ''), u.password_hash)) error = 'Mot de passe actuel incorrect.';
  else error = auth.passwordProblem(password) || (password !== password2 ? 'Les deux mots de passe ne correspondent pas.' : null);
  if (error) return res.status(400).render('admin/account', { title: 'Mon compte', error });
  db.get().prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(auth.hashPassword(password), u.id);
  new auth.SqliteStore().destroyUserSessions(u.id, req.sessionID);
  audit.log(req, 'password_change', 'user', u.id);
  req.flash('ok', 'Mot de passe modifié. Vos autres sessions ont été déconnectées.');
  res.redirect('/admin/compte');
});

// ------------------------------------------------------------ Utilisateurs
router.get('/utilisateurs', auth.requirePerm('users.manage'), (req, res) => {
  const rows = db.get().prepare('SELECT id, email, name, role, active, last_login_at, created_at FROM users ORDER BY active DESC, name').all();
  res.render('admin/users', { title: 'Utilisateurs', rows, ROLE_LABELS: auth.ROLE_LABELS, PERMISSIONS: auth.PERMISSIONS, error: null });
});

router.post('/utilisateurs', auth.requirePerm('users.manage'), (req, res) => {
  const b = req.body;
  const email = U.str(b.email, 160).toLowerCase();
  const name = U.str(b.name, 120);
  const role = auth.ROLE_LABELS[b.role] ? b.role : 'staff';
  const problem = !U.isEmail(email) ? 'Adresse e-mail invalide.' : !name ? 'Nom obligatoire.' : auth.passwordProblem(b.password)
    || (db.get().prepare('SELECT 1 FROM users WHERE email = ?').get(email) ? 'Un compte existe déjà avec cet e-mail.' : null);
  if (problem) { req.flash('err', problem); return res.redirect('/admin/utilisateurs'); }
  const id = db.get().prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)').run(email, name, auth.hashPassword(b.password), role).lastInsertRowid;
  audit.log(req, 'user_create', 'user', Number(id), { email, role });
  req.flash('ok', `Compte créé pour ${name}. Communiquez-lui son mot de passe provisoire par un canal sûr et demandez-lui de le changer.`);
  res.redirect('/admin/utilisateurs');
});

router.post('/utilisateurs/:id', auth.requirePerm('users.manage'), (req, res) => {
  const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) return res.redirect('/admin/utilisateurs');
  const b = req.body;
  const owners = db.get().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").get().n;
  const role = auth.ROLE_LABELS[b.role] ? b.role : u.role;
  const active = U.bool(b.active);
  if (u.role === 'owner' && owners <= 1 && (role !== 'owner' || !active)) {
    req.flash('err', 'Impossible : il doit rester au moins un propriétaire actif.');
    return res.redirect('/admin/utilisateurs');
  }
  db.get().prepare("UPDATE users SET name = ?, role = ?, active = ?, updated_at = datetime('now') WHERE id = ?").run(U.str(b.name, 120) || u.name, role, active, u.id);
  if (b.password) {
    const pb = auth.passwordProblem(b.password);
    if (pb) { req.flash('err', pb); return res.redirect('/admin/utilisateurs'); }
    db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(b.password), u.id);
  }
  if (!active || b.password || role !== u.role) new auth.SqliteStore().destroyUserSessions(u.id, u.id === req.user.id ? req.sessionID : null);
  audit.log(req, 'user_update', 'user', u.id, { role, active, password_reset: !!b.password });
  req.flash('ok', 'Compte mis à jour.');
  res.redirect('/admin/utilisateurs');
});

// ------------------------------------------------------------ Messages de contact
router.get('/messages', auth.requirePerm('messages.view'), (req, res) => {
  const rows = db.get().prepare('SELECT * FROM contact_messages ORDER BY handled, created_at DESC LIMIT 300').all();
  res.render('admin/messages', { title: 'Messages de contact', rows });
});

router.post('/messages/:id', auth.requirePerm('messages.view'), (req, res) => {
  if (req.body.delete === '1' && auth.can(req.user, 'messages.delete')) db.get().prepare('DELETE FROM contact_messages WHERE id = ?').run(Number(req.params.id));
  else db.get().prepare('UPDATE contact_messages SET handled = ? WHERE id = ?').run(U.bool(req.body.handled), Number(req.params.id));
  res.redirect('/admin/messages');
});

// ------------------------------------------------------------ Journal d'audit
router.get('/journal', auth.requirePerm('audit.view'), (req, res) => {
  const rows = db.get().prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 500').all();
  res.render('admin/audit', { title: 'Journal d’audit', rows });
});

// ------------------------------------------------------------ Sauvegardes
router.get('/sauvegardes', auth.requirePerm('backups.manage'), (req, res) => {
  const files = fs.readdirSync(config.backupsDir).filter((f) => f.endsWith('.db')).sort().reverse()
    .map((f) => ({ name: f, size: fs.statSync(path.join(config.backupsDir, f)).size }));
  res.render('admin/backups', { title: 'Sauvegardes', files });
});

router.post('/sauvegardes', auth.requirePerm('backups.manage'), async (req, res, next) => {
  try {
    const name = `prestigio-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
    await db.get().backup(path.join(config.backupsDir, name));
    audit.log(req, 'backup_create', 'backup', null, { name });
    req.flash('ok', `Sauvegarde créée : ${name}. Pensez à la copier hors du serveur avec le dossier storage/uploads.`);
    res.redirect('/admin/sauvegardes');
  } catch (e) { next(e); }
});

router.get('/sauvegardes/:name', auth.requirePerm('backups.manage'), (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(config.backupsDir, name);
  if (!/^prestigio-[\w-]+\.db$/.test(name) || !fs.existsSync(file)) return res.status(404).send('Introuvable.');
  audit.log(req, 'backup_download', 'backup', null, { name });
  res.download(file);
});

module.exports = router;
