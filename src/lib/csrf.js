'use strict';
// Jeton CSRF synchronisé, stocké dans la session de l'utilisateur connecté.
const crypto = require('crypto');

function token(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

function provide(req, res, next) {
  if (req.session) res.locals.csrfToken = token(req);
  next();
}

function verify(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session && req.session.csrf;
  if (expected && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) return next();
  res.status(403).send('Jeton de sécurité invalide ou expiré. Rechargez la page et réessayez.');
}

module.exports = { provide, verify, token };
