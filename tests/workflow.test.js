'use strict';
// Parcours complet : demande → devis provisoire → validation du directeur → envoi.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { db, request, app } = H;
H.createUser('owner@test.local', 'owner', 'Directeur');
H.createUser('ops@test.local', 'ops', 'Opérations');

function reqByRef(ref) {
  return db.get().prepare('SELECT * FROM requests WHERE reference = ?').get(ref);
}
function versions(requestId) {
  return db.get().prepare('SELECT v.* FROM quote_versions v JOIN quotes q ON q.id = v.quote_id WHERE q.request_id = ? ORDER BY version_no').all(requestId);
}
function linesForm(v, override = {}) {
  const lines = JSON.parse(v.lines);
  return {
    l_kind: lines.map((l) => l.kind), l_label: lines.map((l) => l.label), l_desc: lines.map((l) => l.description),
    l_qty: lines.map((l) => String(l.qty)), l_unit: lines.map((l) => l.unit),
    l_price: lines.map((l) => (l.unit_price_cents == null ? '' : String(l.unit_price_cents / 100))),
    l_confirm: lines.map((l) => (l.to_confirm ? '1' : '0')), l_tariff: lines.map((l) => String(l.tariff_id || '')), l_prov: lines.map(() => '0'),
    payment_terms: 'Acompte 50 %', validity_days: '30', ...override,
  };
}

test('submission stores the request, generates a provisional quote, and shows only an acknowledgement', async () => {
  H.enableTestMail();
  H.sentMails.length = 0;
  const { res, reference } = await H.submitQuote();
  assert.equal(res.status, 200);
  assert.ok(reference, 'a unique reference is shown');
  assert.match(res.text, /ne constitue pas encore une réservation confirmée/);
  assert.doesNotMatch(res.text, /DV-\d{4}/, 'the provisional quote reference is not shown to the client');
  assert.doesNotMatch(res.text, /\d+ \$/, 'no amount in the acknowledgement');

  const r = reqByRef(reference);
  assert.equal(r.status, 'pending_validation');
  assert.equal(r.protocol_agents, 6);
  const v = versions(r.id);
  assert.equal(v.length, 1);
  assert.equal(v[0].state, 'draft');
  assert.equal(v[0].locked, 0);
  const lines = JSON.parse(v[0].lines);
  const proto = lines.find((l) => /Agent de protocole/.test(l.label) && !/supplémentaires/.test(l.label));
  assert.equal(proto.qty, 6, 'protocol agents are included in the calculation');
  assert.ok(lines.some((l) => l.provisional), 'provisional tariffs are flagged for the director');
  assert.equal(H.sentMails.filter((m) => m.to === 'client@example.org').length, 0, 'the provisional quote is NEVER emailed to the client');
  H.disableMail();
});

test('the same form cannot create two requests (double submission)', async () => {
  const form = H.quoteForm();
  const a = await request(app).post('/devis').type('form').send(form);
  const b = await request(app).post('/devis').type('form').send(form);
  const ref = (t) => /Référence : <strong>([A-Z0-9-]+)/.exec(t)[1];
  assert.equal(ref(a.text), ref(b.text));
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM requests WHERE reference = ?').get(ref(a.text)).n, 1);
});

test('spam protection: honeypot, too-fast submission and missing consent are rejected', async () => {
  const before = db.get().prepare('SELECT COUNT(*) AS n FROM requests').get().n;
  assert.equal((await request(app).post('/devis').type('form').send(H.quoteForm({ website: 'http://spam' }))).status, 400);
  assert.equal((await request(app).post('/devis').type('form').send(H.quoteForm({ _ft: H.formguard.issue('quote') }))).status, 400);
  assert.equal((await request(app).post('/devis').type('form').send(H.quoteForm({ consent: '' }))).status, 400);
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM requests').get().n, before);
});

test('saving a draft never sends anything; ops cannot approve', async () => {
  H.enableTestMail();
  H.sentMails.length = 0;
  const { reference } = await H.submitQuote();
  const r = reqByRef(reference);
  const v = versions(r.id)[0];
  const ops = await H.login('ops@test.local');
  let res = await ops.post(`/admin/demandes/${r.id}/devis/${v.id}`).type('form').send({ _csrf: ops.csrf, ...linesForm(v), action: 'save' });
  assert.equal(res.status, 302);
  res = await ops.post(`/admin/demandes/${r.id}/devis/${v.id}`).type('form').send({ _csrf: ops.csrf, ...linesForm(v), action: 'approve' });
  assert.equal(versions(r.id)[0].state, 'draft', 'ops (non-director) cannot validate');
  assert.equal(versions(r.id)[0].locked, 0);
  assert.equal(H.sentMails.length, 0);
  assert.equal(reqByRef(reference).status, 'editing');
  // Envoi manuel / e-mail directs refusés pour ops
  res = await ops.post(`/admin/demandes/${r.id}/devis/${v.id}/envoi-manuel`).type('form').send({ _csrf: ops.csrf, channel: 'whatsapp_manual' });
  assert.equal(res.status, 403);
  H.disableMail();
});

test('director approval with email configured: locked version, PDF generated, sent only after SMTP accepts', async () => {
  H.enableTestMail();
  H.sentMails.length = 0;
  const { reference } = await H.submitQuote();
  const r = reqByRef(reference);
  const v = versions(r.id)[0];
  const owner = await H.login('owner@test.local');
  const form = linesForm(v, { action: 'approve', client_message: 'Merci pour votre confiance.', internal_comment: 'NOTE-SECRETE-INTERNE' });
  form.l_price = form.l_price.map((p) => p || '100');
  form.l_confirm = form.l_confirm.map(() => '0');
  const res = await owner.post(`/admin/demandes/${r.id}/devis/${v.id}`).type('form').send({ _csrf: owner.csrf, ...form });
  assert.equal(res.status, 302);
  const after = versions(r.id)[0];
  assert.equal(after.state, 'sent');
  assert.equal(after.locked, 1);
  assert.ok(after.approved_at && after.sent_at && after.pdf_media_id);
  assert.equal(after.sent_channel, 'email');
  assert.equal(reqByRef(reference).status, 'sent');
  assert.equal(H.sentMails.length, 1);
  assert.equal(H.sentMails[0].to, 'client@example.org');
  assert.ok(H.sentMails[0].attachments[0].content.slice(0, 5).toString() === '%PDF-');
  assert.doesNotMatch(H.sentMails[0].text, /NOTE-SECRETE-INTERNE/, 'internal comments never reach the client');

  // Une version verrouillée ne peut plus être modifiée
  const again = await owner.post(`/admin/demandes/${r.id}/devis/${v.id}`).type('form').send({ _csrf: owner.csrf, ...linesForm(after, { l_price: ['1'] }), action: 'save' });
  assert.equal(again.status, 302);
  assert.equal(versions(r.id)[0].total_cents, after.total_cents, 'a sent quote is never silently modified');

  // Correction → nouvelle version (brouillon) qui exige une nouvelle validation
  await owner.post(`/admin/demandes/${r.id}/devis/nouvelle-version`).type('form').send({ _csrf: owner.csrf });
  const vs = versions(r.id);
  assert.equal(vs.length, 2);
  assert.equal(vs[1].state, 'draft');
  assert.equal(vs[0].state, 'sent');
  assert.equal(reqByRef(reference).status, 'editing');
  assert.equal(H.sentMails.length, 1, 'creating a new version sends nothing');
  H.disableMail();
});

test('director approval without email: approved but NOT marked sent until manual send is recorded', async () => {
  H.disableMail();
  const { reference } = await H.submitQuote({ client_email: '' });
  const r = reqByRef(reference);
  const v = versions(r.id)[0];
  const owner = await H.login('owner@test.local');
  await owner.post(`/admin/demandes/${r.id}/devis/${v.id}`).type('form').send({ _csrf: owner.csrf, ...linesForm(v), action: 'approve' });
  let cur = versions(r.id)[0];
  assert.equal(cur.state, 'approved');
  assert.equal(cur.sent_at, null);
  assert.equal(reqByRef(reference).status, 'approved');

  // Le PDF validé est téléchargeable par le directeur
  const pdf = await owner.get(`/admin/demandes/${r.id}/devis/${v.id}/pdf`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');

  // Acceptation impossible avant envoi
  await owner.post(`/admin/demandes/${r.id}/devis/${v.id}/reponse`).type('form').send({ _csrf: owner.csrf, response: 'accepted', note: 'ok' });
  assert.equal(reqByRef(reference).status, 'approved');

  await owner.post(`/admin/demandes/${r.id}/devis/${v.id}/envoi-manuel`).type('form').send({ _csrf: owner.csrf, channel: 'whatsapp_manual', sent_on: '2026-01-15' });
  cur = versions(r.id)[0];
  assert.equal(cur.state, 'sent');
  assert.equal(cur.sent_channel, 'whatsapp_manual');
  assert.equal(reqByRef(reference).status, 'sent');

  // Acceptation : exige une précision sur la confirmation du client
  await owner.post(`/admin/demandes/${r.id}/devis/${v.id}/reponse`).type('form').send({ _csrf: owner.csrf, response: 'accepted', note: '' });
  assert.equal(reqByRef(reference).status, 'sent');
  await owner.post(`/admin/demandes/${r.id}/devis/${v.id}/reponse`).type('form').send({ _csrf: owner.csrf, response: 'accepted', date: '2026-01-20', note: 'Accord écrit WhatsApp' });
  assert.equal(reqByRef(reference).status, 'accepted');
});

test('changing a tariff does not change existing quotes (historical amounts)', async () => {
  const { reference } = await H.submitQuote();
  const r = reqByRef(reference);
  const before = versions(r.id)[0];
  const tariff = db.get().prepare("SELECT t.* FROM tariffs t JOIN services s ON s.id = t.service_id WHERE s.slug = 'decoration' AND t.method = 'per_person'").get();
  const owner = await H.login('owner@test.local');
  await owner.post(`/admin/tarifs/${tariff.id}`).type('form').send({
    _csrf: owner.csrf, scope: 'service', service_id: String(tariff.service_id), name: tariff.name, method: 'per_person', amount: '99', active: '1',
  });
  assert.equal(db.get().prepare('SELECT amount_cents FROM tariffs WHERE id = ?').get(tariff.id).amount_cents, 9900);
  const after = versions(r.id)[0];
  assert.equal(after.lines, before.lines);
  assert.equal(after.total_cents, before.total_cents);
  // …mais s'applique aux nouvelles estimations
  const { reference: ref2 } = await H.submitQuote();
  const lines = JSON.parse(versions(reqByRef(ref2).id)[0].lines);
  assert.equal(lines.find((l) => l.tariff_id === tariff.id).unit_price_cents, 9900);
});

test('manual payments compute the remaining balance', async () => {
  const r = db.get().prepare("SELECT * FROM requests WHERE status = 'accepted'").get();
  const owner = await H.login('owner@test.local');
  const res = await owner.post(`/admin/demandes/${r.id}/paiements`).field('_csrf', owner.csrf).field('paid_on', '2026-01-21')
    .field('amount', '100').field('currency', 'USD').field('method', 'mobile_money');
  assert.equal(res.status, 302);
  const page = await owner.get(`/admin/demandes/${r.id}`);
  assert.match(page.text, /Payé \(USD\)<\/dt><dd>100 \$/);
  assert.match(page.text, /ne sont pas des transactions vérifiées/);
});
