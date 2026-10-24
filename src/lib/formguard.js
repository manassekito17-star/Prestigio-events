'use strict';
// Protection des formulaires publics (sans compte) :
//  - jeton signé HMAC contenant l'heure d'affichage (rejette les envois trop
//    rapides, typiques des robots, et les jetons trop anciens) ;
//  - champ « pot de miel » invisible qui doit rester vide ;
//  - le nonce du jeton sert d'identifiant anti double-soumission.
const crypto = require('crypto');
const config = require('../config');

const MIN_SECONDS = 3;
const MAX_AGE_SECONDS = 12 * 3600;

function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

// backdateSeconds : utilisé uniquement par les tests automatisés.
function issue(form, backdateSeconds = 0) {
  const payload = `${form}.${Math.floor(Date.now() / 1000) - backdateSeconds}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

function check(form, tokenStr, honeypot) {
  if (honeypot) return { ok: false, reason: 'spam' };
  const parts = String(tokenStr || '').split('.');
  if (parts.length !== 4) return { ok: false, reason: 'invalid' };
  const [f, ts, nonce, sig] = parts;
  const expected = sign(`${f}.${ts}.${nonce}`);
  if (f !== form || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: 'invalid' };
  }
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  if (age < MIN_SECONDS) return { ok: false, reason: 'too_fast' };
  if (age > MAX_AGE_SECONDS) return { ok: false, reason: 'expired' };
  return { ok: true, nonce };
}

module.exports = { issue, check, MIN_SECONDS };
