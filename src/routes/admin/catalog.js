'use strict';
// Catalogue : services, tarifs et forfaits — gérés sans toucher au code.
const express = require('express');
const db = require('../../db');
const auth = require('../../lib/auth');
const audit = require('../../lib/audit');
const media = require('../../lib/media');
const C = require('../../lib/constants');
const U = require('../../lib/util');

const router = express.Router();
router.use(['/services', '/tarifs', '/forfaits'], auth.requirePerm('catalog.edit'));

const fileOf = (req, field) => (req.files || []).find((f) => f.fieldname === field);

// Réordonnancement générique (monter / descendre)
function move(table, id, dir, scopeSql = '', scopeParams = []) {
  const rows = db.get().prepare(`SELECT id FROM ${table} ${scopeSql} ORDER BY sort_order, id`).all(...scopeParams);
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  const upd = db.get().prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  db.tx(() => rows.forEach((r, k) => upd.run((k + 1) * 10, r.id)));
}

// ------------------------------------------------------------ Services
router.get('/services', (req, res) => {
  const rows = db.get().prepare(`SELECT s.*, (SELECT COUNT(*) FROM tariffs t WHERE t.service_id = s.id) AS n_tariffs FROM services s ORDER BY sort_order, id`).all();
  res.render('admin/services', { title: 'Services', rows });
});

router.get('/services/:id', (req, res) => {
  const svc = req.params.id === 'nouveau' ? { published: 0, in_quote_form: 1, category: 'Prestations' } : db.get().prepare('SELECT * FROM services WHERE id = ?').get(Number(req.params.id));
  if (!svc) return res.redirect('/admin/services');
  const tariffs = svc.id ? db.get().prepare('SELECT * FROM tariffs WHERE service_id = ? ORDER BY sort_order, id').all(svc.id) : [];
  const cats = db.get().prepare('SELECT DISTINCT category FROM services ORDER BY category').all().map((r) => r.category);
  res.render('admin/service-form', { title: svc.id ? `Service : ${svc.name}` : 'Nouveau service', svc, tariffs, cats });
});

router.post('/services/:id', (req, res) => {
  const b = req.body;
  const isNew = req.params.id === 'nouveau';
  const existing = isNew ? null : db.get().prepare('SELECT * FROM services WHERE id = ?').get(Number(req.params.id));
  if (!isNew && !existing) return res.redirect('/admin/services');
  const name = U.str(b.name, 160);
  if (!name) { req.flash('err', 'Le nom du service est obligatoire.'); return res.redirect(req.originalUrl); }
  let mediaId = existing ? existing.media_id : null;
  const f = fileOf(req, 'image');
  try {
    if (f) { const nid = media.store(f, { kind: 'image', access: 'public', userId: req.user.id, alt: name }); if (mediaId) media.remove(mediaId); mediaId = nid; }
  } catch (e) { req.flash('err', e.userMessage || 'Image refusée.'); return res.redirect(req.originalUrl); }
  if (b.remove_image === '1' && mediaId) { media.remove(mediaId); mediaId = null; }
  const vals = {
    name, form_label: U.str(b.form_label, 120) || null, category: U.str(b.category, 80) || 'Prestations',
    summary: U.str(b.summary, 400), description: U.str(b.description, 6000), includes: U.str(b.includes, 3000),
    media_id: mediaId, demo_image: b.remove_demo === '1' ? null : existing ? existing.demo_image : null,
    is_protocol: U.bool(b.is_protocol), published: U.bool(b.published), in_quote_form: U.bool(b.in_quote_form),
  };
  let id;
  if (isNew) {
    let slug = U.slugify(U.str(b.slug, 80) || name);
    while (db.get().prepare('SELECT 1 FROM services WHERE slug = ?').get(slug)) slug += '-2';
    const max = db.get().prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM services').get().m;
    id = db.get().prepare(`INSERT INTO services (slug, name, form_label, category, summary, description, includes, media_id, demo_image, is_protocol, published, in_quote_form, sort_order)
      VALUES (@slug,@name,@form_label,@category,@summary,@description,@includes,@media_id,@demo_image,@is_protocol,@published,@in_quote_form,@sort)`).run({ ...vals, slug, sort: max + 10 }).lastInsertRowid;
  } else {
    id = existing.id;
    let slug = U.slugify(U.str(b.slug, 80) || existing.slug);
    if (slug !== existing.slug && db.get().prepare('SELECT 1 FROM services WHERE slug = ? AND id <> ?').get(slug, id)) slug = existing.slug;
    db.get().prepare(`UPDATE services SET slug=@slug, name=@name, form_label=@form_label, category=@category, summary=@summary, description=@description, includes=@includes,
      media_id=@media_id, demo_image=@demo_image, is_protocol=@is_protocol, published=@published, in_quote_form=@in_quote_form, updated_at=datetime('now') WHERE id=@id`).run({ ...vals, slug, id });
  }
  audit.log(req, isNew ? 'service_create' : 'service_update', 'service', Number(id));
  req.flash('ok', 'Service enregistré.' + (vals.published ? '' : ' Il est masqué sur le site (utilisez l’aperçu pour le voir).'));
  res.redirect(`/admin/services/${id}`);
});

router.post('/services/:id/deplacer', (req, res) => {
  move('services', Number(req.params.id), req.body.dir);
  res.redirect('/admin/services');
});

router.post('/services/:id/supprimer', (req, res) => {
  const s = db.get().prepare('SELECT * FROM services WHERE id = ?').get(Number(req.params.id));
  if (s) {
    db.get().prepare('DELETE FROM services WHERE id = ?').run(s.id);
    media.remove(s.media_id);
    audit.log(req, 'service_delete', 'service', s.id, { name: s.name });
    req.flash('ok', `Service « ${s.name} » supprimé (ses tarifs aussi). Les devis existants ne sont pas modifiés.`);
  }
  res.redirect('/admin/services');
});

// ------------------------------------------------------------ Tarifs
router.get('/tarifs', (req, res) => {
  const rows = db.get().prepare(`SELECT t.*, s.name AS service_name FROM tariffs t LEFT JOIN services s ON s.id = t.service_id
    ORDER BY t.scope = 'global', s.sort_order, t.sort_order, t.id`).all();
  res.render('admin/tariffs', { title: 'Tarifs', rows });
});

router.get('/tarifs/:id', (req, res) => {
  const t = req.params.id === 'nouveau'
    ? { scope: req.query.scope === 'global' ? 'global' : 'service', service_id: U.intOrNull(req.query.service, 1), method: 'fixed', active: 1, provisional: 1, public_price: 0 }
    : db.get().prepare('SELECT * FROM tariffs WHERE id = ?').get(Number(req.params.id));
  if (!t) return res.redirect('/admin/tarifs');
  const services = db.get().prepare('SELECT id, name FROM services ORDER BY sort_order').all();
  res.render('admin/tariff-form', { title: t.id ? `Tarif : ${t.name}` : 'Nouveau tarif', t, services });
});

router.post('/tarifs/:id', (req, res) => {
  const b = req.body;
  const isNew = req.params.id === 'nouveau';
  const existing = isNew ? null : db.get().prepare('SELECT * FROM tariffs WHERE id = ?').get(Number(req.params.id));
  if (!isNew && !existing) return res.redirect('/admin/tarifs');
  const scope = b.scope === 'global' ? 'global' : 'service';
  const v = {
    scope,
    service_id: scope === 'service' ? U.intOrNull(b.service_id, 1) : null,
    name: U.str(b.name, 200),
    method: C.TARIFF_METHODS[b.method] ? b.method : 'fixed',
    amount_cents: U.parseMoney(b.amount),
    percent: b.percent === '' || b.percent == null ? null : Math.min(100, Math.max(0, Number(String(b.percent).replace(',', '.')) || 0)),
    agent_unit: ['event', 'hour', 'day'].includes(b.agent_unit) ? b.agent_unit : null,
    included_hours: b.included_hours === '' ? null : Math.max(0, Number(String(b.included_hours).replace(',', '.')) || 0) || null,
    extra_hour_cents: U.parseMoney(b.extra_hour),
    optional: U.bool(b.optional),
    min_guests: U.intOrNull(b.min_guests, 0),
    valid_from: /^\d{4}-\d{2}-\d{2}$/.test(b.valid_from || '') ? b.valid_from : null,
    valid_to: /^\d{4}-\d{2}-\d{2}$/.test(b.valid_to || '') ? b.valid_to : null,
    active: U.bool(b.active),
    public_price: U.bool(b.public_price),
    provisional: U.bool(b.provisional),
    conditions: U.str(b.conditions, 1000) || null,
    internal_note: U.str(b.internal_note, 2000) || null,
  };
  const errors = [];
  if (!v.name) errors.push('Le nom est obligatoire.');
  if (scope === 'service' && !v.service_id) errors.push('Choisissez le service concerné.');
  if (v.method === 'per_agent' && !v.agent_unit) v.agent_unit = 'event';
  if (v.method.startsWith('discount') && scope !== 'global') errors.push('Les remises doivent être des tarifs globaux.');
  if (v.valid_from && v.valid_to && v.valid_from > v.valid_to) errors.push('La date de début de validité doit précéder la date de fin.');
  if (errors.length) { req.flash('err', errors.join(' ')); return res.redirect(req.originalUrl); }
  let id;
  if (isNew) {
    v.sort_order = db.get().prepare('SELECT COALESCE(MAX(sort_order),0) + 10 AS m FROM tariffs').get().m;
    id = db.get().prepare(`INSERT INTO tariffs (scope, service_id, name, method, amount_cents, percent, agent_unit, included_hours, extra_hour_cents, optional, min_guests,
      valid_from, valid_to, active, public_price, provisional, conditions, internal_note, sort_order) VALUES (@scope,@service_id,@name,@method,@amount_cents,@percent,@agent_unit,
      @included_hours,@extra_hour_cents,@optional,@min_guests,@valid_from,@valid_to,@active,@public_price,@provisional,@conditions,@internal_note,@sort_order)`).run(v).lastInsertRowid;
  } else {
    id = existing.id;
    db.get().prepare(`UPDATE tariffs SET scope=@scope, service_id=@service_id, name=@name, method=@method, amount_cents=@amount_cents, percent=@percent, agent_unit=@agent_unit,
      included_hours=@included_hours, extra_hour_cents=@extra_hour_cents, optional=@optional, min_guests=@min_guests, valid_from=@valid_from, valid_to=@valid_to, active=@active,
      public_price=@public_price, provisional=@provisional, conditions=@conditions, internal_note=@internal_note, updated_at=datetime('now') WHERE id=@id`).run({ ...v, id });
  }
  audit.log(req, isNew ? 'tariff_create' : 'tariff_update', 'tariff', Number(id), { amount: v.amount_cents, public: v.public_price, provisional: v.provisional });
  req.flash('ok', 'Tarif enregistré. Il s’applique aux nouvelles estimations ; les devis existants conservent leurs montants.');
  res.redirect(b.back_service && v.service_id ? `/admin/services/${v.service_id}` : '/admin/tarifs');
});

router.post('/tarifs/:id/supprimer', (req, res) => {
  const t = db.get().prepare('SELECT * FROM tariffs WHERE id = ?').get(Number(req.params.id));
  if (t) {
    db.get().prepare('DELETE FROM tariffs WHERE id = ?').run(t.id);
    audit.log(req, 'tariff_delete', 'tariff', t.id, { name: t.name });
    req.flash('ok', 'Tarif supprimé.');
  }
  res.redirect('/admin/tarifs');
});

// ------------------------------------------------------------ Forfaits
router.get('/forfaits', (req, res) => {
  res.render('admin/packages', { title: 'Forfaits', rows: db.get().prepare('SELECT * FROM packages ORDER BY sort_order, id').all() });
});

router.get('/forfaits/:id', (req, res) => {
  const p = req.params.id === 'nouveau' ? { price_type: 'on_request', provisional: 1, published: 0 } : db.get().prepare('SELECT * FROM packages WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.redirect('/admin/forfaits');
  res.render('admin/package-form', { title: p.id ? `Forfait : ${p.name}` : 'Nouveau forfait', p });
});

router.post('/forfaits/:id', (req, res) => {
  const b = req.body;
  const isNew = req.params.id === 'nouveau';
  const v = {
    name: U.str(b.name, 160), event_type: U.str(b.event_type, 120) || null, summary: U.str(b.summary, 600),
    price_type: C.PACKAGE_PRICE_TYPES[b.price_type] ? b.price_type : 'on_request', amount_cents: U.parseMoney(b.amount),
    includes: U.str(b.includes, 3000), excludes: U.str(b.excludes, 3000), provisional: U.bool(b.provisional),
    featured: U.bool(b.featured), published: U.bool(b.published),
  };
  if (!v.name) { req.flash('err', 'Le nom est obligatoire.'); return res.redirect(req.originalUrl); }
  let id = Number(req.params.id);
  if (isNew) {
    v.sort_order = db.get().prepare('SELECT COALESCE(MAX(sort_order),0) + 10 AS m FROM packages').get().m;
    id = db.get().prepare(`INSERT INTO packages (name, event_type, summary, price_type, amount_cents, includes, excludes, provisional, featured, published, sort_order)
      VALUES (@name,@event_type,@summary,@price_type,@amount_cents,@includes,@excludes,@provisional,@featured,@published,@sort_order)`).run(v).lastInsertRowid;
  } else {
    db.get().prepare(`UPDATE packages SET name=@name, event_type=@event_type, summary=@summary, price_type=@price_type, amount_cents=@amount_cents, includes=@includes,
      excludes=@excludes, provisional=@provisional, featured=@featured, published=@published, updated_at=datetime('now') WHERE id=@id`).run({ ...v, id });
  }
  audit.log(req, isNew ? 'package_create' : 'package_update', 'package', Number(id));
  req.flash('ok', 'Forfait enregistré.');
  res.redirect('/admin/forfaits');
});

router.post('/forfaits/:id/deplacer', (req, res) => { move('packages', Number(req.params.id), req.body.dir); res.redirect('/admin/forfaits'); });

router.post('/forfaits/:id/supprimer', (req, res) => {
  db.get().prepare('DELETE FROM packages WHERE id = ?').run(Number(req.params.id));
  audit.log(req, 'package_delete', 'package', Number(req.params.id));
  req.flash('ok', 'Forfait supprimé.');
  res.redirect('/admin/forfaits');
});

module.exports = router;
module.exports.move = move;
