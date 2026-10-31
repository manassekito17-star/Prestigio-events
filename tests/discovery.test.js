'use strict';
// Fiche de découverte mariage : enregistrement, liste blanche, confidentialité.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const discovery = require('../src/lib/discovery');

const { db, request, app } = H;
const staffId = H.createUser('staff@test.local', 'staff', 'Collaborateur');
H.createUser('owner@test.local', 'owner', 'Directeur');
const row = (ref) => db.get().prepare('SELECT * FROM requests WHERE reference = ?').get(ref);

const WEDDING = {
  event_type: 'mariage',
  guests: '',
  w_groom_name: 'Jean Mukendi', w_bride_name: 'Grâce Mbuyi',
  w_ceremonies: ['dot', 'civil', 'pirate'],          // « pirate » n'est pas une option prévue
  w_venues: 'agency',
  w_guests_groom: '150', w_guests_bride: '120',
  w_special_guests: ['abroad', 'autre'], w_special_guests_other: 'Délégation de l’église',
  w_style: '<script>alert(1)</script>',               // valeur hors liste
  w_payer: 'families',
  w_success: 'Que nos deux familles se sentent honorées.',
  budget_mode: 'exact', budget_currency: 'CDF', budget_amount: '25 000 000',
};

test('the wedding page is served with the discovery questions', async () => {
  const res = await request(app).get('/devis/mariage');
  assert.equal(res.status, 200);
  for (const q of discovery.QUESTIONS) assert.ok(res.text.includes(`name="w_${q.key}"`), q.key);
  assert.match(res.text, /Votre mariage, orchestré avec excellence/);
});

test('wedding answers are stored, filtered against the allowed options, and mapped to the request', async () => {
  const { res, reference } = await H.submitQuote(WEDDING);
  assert.equal(res.status, 200, res.text.slice(0, 300));
  const r = row(reference);
  const d = JSON.parse(r.discovery);
  assert.deepEqual(d.ceremonies, ['dot', 'civil']);
  assert.equal(d.style, undefined, 'unknown option rejected');
  assert.equal(d.special_guests_other, 'Délégation de l’église');
  assert.equal(r.guests, 270, 'total guests = groom side + bride side');
  assert.equal(r.venue_booked, 0);
  assert.equal(r.wants_venue_search, 1, '« PRESTIGIO EVENTS s’en charge » → venue search');
  assert.equal(r.budget_currency, 'CDF');
  assert.equal(r.budget_min_cents, 25_000_000 * 100, 'large CDF amounts are accepted');
  // Le devis provisoire est toujours généré
  assert.ok(db.get().prepare('SELECT 1 FROM quotes WHERE request_id = ?').get(r.id));
});

test('no discovery data is stored for other event types', async () => {
  const { reference } = await H.submitQuote({ event_type: 'anniversaire', w_groom_name: 'X', w_style: 'luxury' });
  assert.equal(row(reference).discovery, null);
});

test('the director sees the discovery sheet and can record internal observations with a follow-up task', async () => {
  const { reference } = await H.submitQuote(WEDDING);
  const r = row(reference);
  const owner = await H.login('owner@test.local');
  const page = await owner.get(`/admin/demandes/${r.id}`);
  assert.match(page.text, /Fiche de découverte — Mariage/);
  assert.match(page.text, /Jean Mukendi/);
  assert.match(page.text, /Les deux familles/);
  const res = await owner.post(`/admin/demandes/${r.id}/decouverte`).type('form')
    .send({ _csrf: owner.csrf, observations: 'OBS-INTERNE-123', next_step: 'site_visit', follow_up: '2099-01-10' });
  assert.equal(res.status, 302);
  const internal = JSON.parse(row(reference).discovery_internal);
  assert.equal(internal.next_step, 'site_visit');
  const task = db.get().prepare('SELECT * FROM tasks WHERE request_id = ?').get(r.id);
  assert.match(task.title, /visite technique/);
  assert.equal(task.due_date, '2099-01-10');
  // Les observations internes ne sont jamais visibles publiquement
  for (const url of ['/', '/devis', '/devis/mariage', '/api/catalogue']) {
    assert.ok(!(await request(app).get(url)).text.includes('OBS-INTERNE-123'), url);
  }
});

test('a staff member assigned to a wedding sees the sheet without budget answers and cannot edit observations', async () => {
  const { reference } = await H.submitQuote(WEDDING);
  const r = row(reference);
  db.get().prepare('UPDATE requests SET assigned_to = ? WHERE id = ?').run(staffId, r.id);
  const staff = await H.login('staff@test.local');
  const page = await staff.get(`/admin/demandes/${r.id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Jean Mukendi/);
  assert.doesNotMatch(page.text, /Qui prend principalement en charge les dépenses/, 'budget questions hidden');
  assert.doesNotMatch(page.text, /Les deux familles/);
  const res = await staff.post(`/admin/demandes/${r.id}/decouverte`).type('form').send({ _csrf: staff.csrf, observations: 'x' });
  assert.equal(res.status, 403);
});
