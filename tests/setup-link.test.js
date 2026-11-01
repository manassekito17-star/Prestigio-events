'use strict';
// Lien d'installation à usage unique pour créer le compte propriétaire.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SETUP_TOKEN = 'AbC/def+GhI=jkl-mno_pqrSTUVwxyz0123456789';
const H = require('./helpers');
const setup = require('../src/lib/setup');
const { db, request, app } = H;
const TOKEN = process.env.SETUP_TOKEN;
const URL = '/admin/installation/' + TOKEN;

async function form(url) {
  const agent = request.agent(app);
  const page = await agent.get(url);
  return { agent, page, csrf: H.csrfFrom(page.text) };
}

test('the link is announced at start-up while no account exists', () => {
  const link = setup.prepare();
  assert.ok(link.endsWith(URL));
});

test('a wrong token is rejected', async () => {
  const res = await request(app).get('/admin/installation/mauvais-jeton-mauvais-jeton-123');
  assert.equal(res.status, 404);
  assert.match(res.text, /Lien non valide/);
});

test('weak passwords and invalid e-mails are refused', async () => {
  const { agent, csrf } = await form(URL);
  let res = await agent.post(URL).type('form').send({ _csrf: csrf, name: 'Billy', email: 'pas-un-email', password: 'Motdepasse2026', password2: 'Motdepasse2026' });
  assert.equal(res.status, 400);
  res = await agent.post(URL).type('form').send({ _csrf: csrf, name: 'Billy', email: 'billy@example.org', password: 'court', password2: 'court' });
  assert.equal(res.status, 400);
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('the link creates exactly one owner account, logs the person in, then stops working', async () => {
  const { agent, page, csrf } = await form(URL);
  assert.equal(page.status, 200);
  assert.match(page.text, /Créer le compte propriétaire/);
  const res = await agent.post(URL).type('form').send({ _csrf: csrf, name: 'Billy Kito', email: 'Billy@Example.org', password: 'Motdepasse2026', password2: 'Motdepasse2026' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/admin');
  const u = db.get().prepare('SELECT * FROM users').all();
  assert.equal(u.length, 1);
  assert.equal(u[0].role, 'owner');
  assert.equal(u[0].email, 'billy@example.org');
  assert.equal((await agent.get('/admin')).status, 200, 'logged in right away');

  // Le même lien ne fonctionne plus, même avec un nouveau formulaire
  assert.equal((await request(app).get(URL)).status, 404);
  const again = await agent.post(URL).type('form').send({ _csrf: csrf, name: 'Intrus', email: 'intrus@example.org', password: 'Motdepasse2027', password2: 'Motdepasse2027' });
  assert.equal(again.status, 404);
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  // …ni après un redémarrage du serveur
  assert.equal(setup.prepare(), null);
  assert.equal(setup.checkToken(TOKEN), false);
});
