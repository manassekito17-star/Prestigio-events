'use strict';
// Tests de sécurité et de confidentialité (section 11 du cahier des charges).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const { db, request, app } = H;
const ownerId = H.createUser('owner@test.local', 'owner', 'Directeur');
const opsId = H.createUser('ops@test.local', 'ops', 'Opérations');
const staffId = H.createUser('staff@test.local', 'staff', 'Collaborateur');
void ownerId; void opsId;

const SECRET = {
  partnerRate: 'TARIF-NEGOCIE-123',
  commission: 'COMMISSION-15PCT',
  notes: 'NOTE-INTERNE-PARTENAIRE',
  privatePhone: '+243 999 111 222',
  tariffNote: 'NOTE-TARIF-SECRETE',
  requestNote: 'NOTE-DOSSIER-PRIVEE',
};

function insertPartner(o) {
  const cols = Object.keys(o);
  return Number(db.get().prepare(`INSERT INTO partners (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(o).lastInsertRowid);
}

// Données privées de référence
insertPartner({ trade_name: 'Traiteur Publié', category: 'traiteur', status: 'active', publish: 1, public_fields: JSON.stringify(['category', 'description']),
  public_description: 'Cuisine congolaise', phone: SECRET.privatePhone, negotiated_rates: SECRET.partnerRate, commission: SECRET.commission, internal_notes: SECRET.notes,
  public_phone: '+243 800 000 000', contact_publication_authorized: 0 });
insertPartner({ trade_name: 'Salle Non Publiée', category: 'salle', status: 'active', publish: 0, public_fields: '[]' });
insertPartner({ trade_name: 'Décorateur Archivé', category: 'decorateur', status: 'archived', publish: 1, public_fields: '[]' });
db.get().prepare('UPDATE tariffs SET internal_note = ? WHERE id = (SELECT MIN(id) FROM tariffs)').run(SECRET.tariffNote);

const PUBLIC_PAGES = ['/', '/services', '/services/decoration', '/services/protocole-accueil', '/offres', '/galerie', '/a-propos', '/partenaires', '/contact', '/devis', '/api/catalogue', '/sitemap.xml'];

test('a visitor cannot access any administration page', async () => {
  for (const url of ['/admin', '/admin/demandes', '/admin/demandes/1', '/admin/tarifs', '/admin/partenaires', '/admin/partenaires/1', '/admin/utilisateurs',
    '/admin/paiements', '/admin/journal', '/admin/sauvegardes', '/admin/demandes/export.csv', '/admin/demandes/1/devis/1/pdf', '/admin/contenu/accueil']) {
    const res = await request(app).get(url);
    assert.equal(res.status, 302, url);
    assert.match(res.headers.location, /^\/admin\/connexion/, url);
  }
  const post = await request(app).post('/admin/tarifs/1').type('form').send({ name: 'x' });
  assert.equal(post.status, 401);
});

test('admin POST without a CSRF token is rejected', async () => {
  const owner = await H.login('owner@test.local');
  const res = await owner.post('/admin/contenu/seo').type('form').send({ seo_description: 'pirate' });
  assert.equal(res.status, 403);
  assert.notEqual(db.get().prepare("SELECT value FROM settings WHERE key = 'seo_description'").get().value, 'pirate');
});

test('wrong password is refused and logged; no hard-coded admin account exists', async () => {
  const page = await request.agent(app).get('/admin/connexion');
  assert.equal(page.status, 200);
  const agent = request.agent(app);
  const p = await agent.get('/admin/connexion');
  const res = await agent.post('/admin/connexion').type('form').send({ _csrf: H.csrfFrom(p.text), email: 'owner@test.local', password: 'wrong-password1' });
  assert.equal(res.status, 401);
  assert.ok(db.get().prepare("SELECT 1 FROM audit_log WHERE action = 'login_failed'").get());
  assert.equal(db.get().prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'admin@%'").get().n, 0);
});

test('public pages and public API never leak supplier rates, commissions, internal notes or provisional prices', async () => {
  for (const url of PUBLIC_PAGES) {
    const res = await request(app).get(url);
    assert.equal(res.status, 200, url);
    for (const secret of Object.values(SECRET)) assert.ok(!res.text.includes(secret), `${url} leaks ${secret}`);
    assert.ok(!/internal_note|negotiated|commission/.test(res.text), `${url} leaks a private field name`);
  }
  // Tous les tarifs installés sont provisoires : aucun montant ne doit être exposé.
  const cat = (await request(app).get('/api/catalogue')).body;
  const all = [...cat.services.flatMap((s) => s.tariffs), ...cat.globals];
  assert.ok(all.length > 5);
  assert.ok(all.every((t) => t.amount_cents === null && t.to_confirm === true), 'provisional prices are hidden from visitors');
  assert.ok(all.every((t) => !('internal_note' in t) && !('provisional' in t) && !('public_price' in t)));
});

test('a tariff becomes visible only once public AND confirmed', async () => {
  const t = db.get().prepare("SELECT t.id FROM tariffs t JOIN services s ON s.id = t.service_id WHERE s.slug = 'dj-animation' AND t.optional = 0").get();
  const find = async () => (await request(app).get('/api/catalogue')).body.services.flatMap((s) => s.tariffs).find((x) => x.id === t.id);
  db.get().prepare('UPDATE tariffs SET public_price = 1 WHERE id = ?').run(t.id);
  assert.equal((await find()).amount_cents, null, 'public but still provisional → hidden');
  db.get().prepare('UPDATE tariffs SET provisional = 0 WHERE id = ?').run(t.id);
  assert.equal((await find()).amount_cents, 25000);
  db.get().prepare("UPDATE tariffs SET valid_to = '2000-01-01' WHERE id = ?").run(t.id);
  assert.equal(await find(), undefined, 'expired tariffs are not used');
  db.get().prepare('UPDATE tariffs SET valid_to = NULL, public_price = 0, provisional = 1 WHERE id = ?').run(t.id);
});

test('only explicitly published partners appear, with only the approved fields', async () => {
  const res = await request(app).get('/partenaires');
  assert.match(res.text, /Traiteur Publié/);
  assert.match(res.text, /Cuisine congolaise/);
  assert.doesNotMatch(res.text, /Salle Non Publiée/);
  assert.doesNotMatch(res.text, /Décorateur Archivé/);
  assert.doesNotMatch(res.text, /\+243 800 000 000/, 'public phone hidden: field not selected and contact publication not authorised');
});

test('private files are not reachable by direct URL', async () => {
  const media = require('../src/lib/media');
  const priv = media.storeBuffer(Buffer.from('%PDF-1.4 contrat'), { mime: 'application/pdf', ext: '.pdf', access: 'owner', name: 'contrat.pdf' });
  const mgr = media.storeBuffer(Buffer.from('%PDF-1.4 devis'), { mime: 'application/pdf', ext: '.pdf', access: 'manager', name: 'devis.pdf' });
  const staffFile = media.storeBuffer(Buffer.from('GIF89a'), { mime: 'image/gif', ext: '.gif', access: 'staff', name: 'prive.gif' });
  const pub = media.storeBuffer(Buffer.from('GIF89a'), { mime: 'image/gif', ext: '.gif', access: 'public', name: 'pub.gif' });
  assert.equal((await request(app).get(`/media/${priv}`)).status, 404);
  assert.equal((await request(app).get(`/media/${mgr}`)).status, 404);
  assert.equal((await request(app).get(`/media/${staffFile}`)).status, 404);
  assert.equal((await request(app).get(`/media/${pub}`)).status, 200);
  const staff = await H.login('staff@test.local');
  assert.equal((await staff.get(`/media/${staffFile}`)).status, 200);
  assert.equal((await staff.get(`/media/${mgr}`)).status, 404, 'staff cannot read quote PDFs');
  assert.equal((await staff.get(`/media/${priv}`)).status, 404);
  const ops = await H.login('ops@test.local');
  assert.equal((await ops.get(`/media/${mgr}`)).status, 200);
  assert.equal((await ops.get(`/media/${priv}`)).status, 404, 'partner contracts are owner-only');
  const owner = await H.login('owner@test.local');
  assert.equal((await owner.get(`/media/${priv}`)).status, 200);
  // Les fichiers téléversés ne sont jamais servis en statique
  const stored = db.get().prepare('SELECT stored_name FROM media WHERE id = ?').get(priv).stored_name;
  assert.equal((await request(app).get(`/static/../storage/uploads/${stored}`)).status, 404);
  assert.equal((await request(app).get(`/uploads/${stored}`)).status, 404);
});

test('a staff member only sees requests assigned to them, without budget, quote or payments', async () => {
  const { reference } = await H.submitQuote({ budget_mode: 'exact', budget_amount: '4321' });
  const { reference: other } = await H.submitQuote();
  const r = db.get().prepare('SELECT * FROM requests WHERE reference = ?').get(reference);
  const o = db.get().prepare('SELECT * FROM requests WHERE reference = ?').get(other);
  db.get().prepare('UPDATE requests SET assigned_to = ? WHERE id = ?').run(staffId, r.id);
  db.get().prepare('INSERT INTO request_notes (request_id, body) VALUES (?, ?)').run(o.id, SECRET.requestNote);
  const staff = await H.login('staff@test.local');
  const mine = await staff.get(`/admin/demandes/${r.id}`);
  assert.equal(mine.status, 200);
  assert.doesNotMatch(mine.text, /4\s?321/, 'no budget');
  assert.doesNotMatch(mine.text, /DV-\d{4}/, 'no quote');
  assert.doesNotMatch(mine.text, /id="paiements"/);
  const notMine = await staff.get(`/admin/demandes/${o.id}`);
  assert.equal(notMine.status, 404);
  assert.ok(!notMine.text.includes(SECRET.requestNote));
  const list = await staff.get('/admin/demandes');
  assert.ok(list.text.includes(reference) && !list.text.includes(other));
  for (const url of ['/admin/tarifs', '/admin/partenaires', '/admin/paiements', '/admin/utilisateurs', '/admin/demandes/export.csv', `/admin/demandes/${r.id}/devis/1/pdf`]) {
    assert.equal((await staff.get(url)).status, 403, url);
  }
});

test('operations manager sees partners without confidential fields and cannot edit pricing or users', async () => {
  const ops = await H.login('ops@test.local');
  const id = db.get().prepare("SELECT id FROM partners WHERE trade_name = 'Traiteur Publié'").get().id;
  const page = await ops.get(`/admin/partenaires/${id}`);
  assert.equal(page.status, 200);
  for (const s of [SECRET.partnerRate, SECRET.commission, SECRET.notes]) assert.ok(!page.text.includes(s), `ops sees ${s}`);
  assert.equal((await ops.post(`/admin/partenaires/${id}`).type('form').send({ _csrf: ops.csrf, trade_name: 'x' })).status, 403);
  assert.equal((await ops.get('/admin/tarifs')).status, 403);
  assert.equal((await ops.get('/admin/utilisateurs')).status, 403);
  const owner = await H.login('owner@test.local');
  const full = await owner.get(`/admin/partenaires/${id}`);
  assert.ok(full.text.includes(SECRET.partnerRate));
});

test('new partners are private by default', async () => {
  const owner = await H.login('owner@test.local');
  await owner.post('/admin/partenaires/nouveau').field('_csrf', owner.csrf).field('trade_name', 'Nouveau DJ Privé').field('category', 'dj').field('status', 'active');
  const p = db.get().prepare("SELECT * FROM partners WHERE trade_name = 'Nouveau DJ Privé'").get();
  assert.equal(p.publish, 0);
  assert.doesNotMatch((await request(app).get('/partenaires')).text, /Nouveau DJ Privé/);
});

test('uploads are checked by content, not by extension', async () => {
  const owner = await H.login('owner@test.local');
  const before = db.get().prepare('SELECT COUNT(*) AS n FROM gallery_items').get().n;
  await owner.post('/admin/galerie').field('_csrf', owner.csrf).field('is_public', '1')
    .attach('files', Buffer.from('<script>alert(1)</script>'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
  assert.equal(db.get().prepare('SELECT COUNT(*) AS n FROM gallery_items').get().n, before);
});

test('private gallery items are not visible publicly', async () => {
  const owner = await H.login('owner@test.local');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex');
  await owner.post('/admin/galerie').field('_csrf', owner.csrf).field('caption', 'Photo privée test').attach('files', png, { filename: 'a.png', contentType: 'image/png' });
  const g = db.get().prepare("SELECT * FROM gallery_items WHERE caption = 'Photo privée test'").get();
  assert.ok(g);
  assert.equal(g.is_public, 0);
  assert.doesNotMatch((await request(app).get('/galerie')).text, /Photo privée test/);
  assert.equal((await request(app).get(`/media/${g.media_id}`)).status, 404);
});

test('security headers are set and admin pages are not cacheable', async () => {
  const res = await request(app).get('/');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
  const a = await request(app).get('/admin/connexion');
  assert.equal(a.headers['cache-control'], 'no-store');
  const robots = await request(app).get('/robots.txt');
  assert.match(robots.text, /Disallow: \/admin/);
});

test('the last active owner cannot be demoted or disabled', async () => {
  const owner = await H.login('owner@test.local');
  await owner.post(`/admin/utilisateurs/${ownerId}`).type('form').send({ _csrf: owner.csrf, name: 'Directeur', role: 'staff', active: '1' });
  assert.equal(db.get().prepare('SELECT role FROM users WHERE id = ?').get(ownerId).role, 'owner');
});

test('repeated failed logins are throttled', async () => {
  const agent = request.agent(app);
  const p = await agent.get('/admin/connexion');
  const token = H.csrfFrom(p.text);
  let last;
  for (let i = 0; i < 12; i++) {
    last = await agent.post('/admin/connexion').type('form').send({ _csrf: token, email: 'ops@test.local', password: 'mauvais-mdp-' + i });
  }
  assert.equal(last.status, 429);
});
