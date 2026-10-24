'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const { bootstrapOwner } = require('../src/lib/bootstrap');

test('initial owner is created only when no account exists, with a valid password', () => {
  assert.equal(bootstrapOwner({}).created, false);
  assert.equal(bootstrapOwner({ ADMIN_EMAIL: 'boss@example.org', ADMIN_INITIAL_PASSWORD: 'court' }).created, false);
  assert.equal(bootstrapOwner({ ADMIN_EMAIL: 'boss@example.org', ADMIN_INITIAL_PASSWORD: 'MotDePasse2026' }).created, true);
  const u = H.db.get().prepare("SELECT role FROM users WHERE email = 'boss@example.org'").get();
  assert.equal(u.role, 'owner');
  // Une seconde exécution (redémarrage) ne crée ni ne modifie rien
  assert.equal(bootstrapOwner({ ADMIN_EMAIL: 'autre@example.org', ADMIN_INITIAL_PASSWORD: 'MotDePasse2027' }).reason, 'users_exist');
  assert.equal(H.db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});
