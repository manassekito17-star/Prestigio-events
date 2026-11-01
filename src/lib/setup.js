'use strict';
// Lien d'installation à usage unique : /admin/installation/<jeton>
// Permet à une personne de créer le PREMIER compte propriétaire avec sa propre
// adresse e-mail. Le lien ne fonctionne que tant qu'aucun compte n'existe, et
// il est désactivé définitivement dès que le compte est créé.
//
// Jeton : variable d'environnement SETUP_TOKEN (au moins 24 caractères), sinon
// un jeton aléatoire est généré au démarrage et le lien est écrit dans les
// journaux du serveur. Seul son empreinte (SHA-256) est conservée en base.
const crypto = require('crypto');
const db = require('../db');
const settings = require('./settings');
const config = require('../config');
const { sha256 } = require('./auth');

const MIN_TOKEN = 24;

function hasUsers() {
  return db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

function isOpen() {
  return settings.get('setup_completed') !== '1' && !hasUsers();
}

function envToken() {
  const t = process.env.SETUP_TOKEN || '';
  return t.length >= MIN_TOKEN ? t : null;
}

// Prépare le jeton au démarrage et renvoie le lien à communiquer (ou null).
function prepare() {
  if (!isOpen()) return null;
  let token = envToken();
  if (token) {
    settings.set('setup_token_hash', sha256(token));
  } else {
    token = crypto.randomBytes(24).toString('base64url');
    settings.set('setup_token_hash', sha256(token));
  }
  return `${config.baseUrl}/admin/installation/${token}`;
}

function checkToken(token) {
  const stored = settings.get('setup_token_hash');
  if (!isOpen() || !stored || typeof token !== 'string' || token.length < MIN_TOKEN || token.length > 200) return false;
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Après création du compte : le lien ne pourra plus jamais servir.
function complete() {
  settings.set('setup_completed', '1');
  settings.set('setup_token_hash', '');
}

module.exports = { isOpen, prepare, checkToken, complete, MIN_TOKEN };
