'use strict';
// Création du premier compte propriétaire sur un hébergeur sans accès en ligne
// de commande. Ne fait rien si un compte existe déjà : les variables
// ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD ne peuvent donc jamais écraser un compte.
const db = require('../db');
const auth = require('./auth');

function bootstrapOwner(env) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_INITIAL_PASSWORD || '';
  if (!email || !password) return { created: false, reason: 'not_configured' };
  if (db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return { created: false, reason: 'users_exist' };
  const problem = auth.passwordProblem(password);
  if (problem || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    console.error('Compte initial non créé :', problem || 'ADMIN_EMAIL invalide.');
    return { created: false, reason: 'invalid' };
  }
  db.get().prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'owner')")
    .run(email, String(env.ADMIN_NAME || 'Billy Kito').slice(0, 120), auth.hashPassword(password));
  console.log(`Compte propriétaire initial créé pour ${email}. Changez ce mot de passe dans « Mon compte » puis supprimez ADMIN_INITIAL_PASSWORD de la configuration.`);
  return { created: true };
}

module.exports = { bootstrapOwner };
