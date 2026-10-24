'use strict';
// Répertoire PRIVÉ des partenaires et prestataires, avec publication sélective.
const express = require('express');
const db = require('../../db');
const auth = require('../../lib/auth');
const audit = require('../../lib/audit');
const media = require('../../lib/media');
const C = require('../../lib/constants');
const U = require('../../lib/util');

const router = express.Router();
const fileOf = (req, field) => (req.files || []).find((f) => f.fieldname === field);

// Champs confidentiels : visibles uniquement par le propriétaire.
const CONFIDENTIAL = ['negotiated_rates', 'commission', 'internal_notes'];

function redact(p, user) {
  if (auth.can(user, 'partners.confidential')) return p;
  const out = { ...p };
  for (const k of CONFIDENTIAL) out[k] = null;
  return out;
}

// Le logo n'est accessible publiquement que si la publication est réellement autorisée.
function syncLogoAccess(p) {
  if (!p.logo_media_id) return;
  let fields = [];
  try { fields = JSON.parse(p.public_fields || '[]'); } catch { fields = []; }
  const pub = p.publish === 1 && p.status === 'active' && p.image_publication_authorized === 1 && fields.includes('logo');
  media.setAccess(p.logo_media_id, pub ? 'public' : 'manager');
}

router.get('/partenaires', auth.requirePerm('partners.view'), (req, res) => {
  const status = C.PARTNER_STATUSES[req.query.status] ? req.query.status : '';
  const cat = C.PARTNER_CATEGORIES[req.query.cat] ? req.query.cat : '';
  const q = U.str(req.query.q, 100);
  const rows = db.get().prepare(`SELECT id, trade_name, category, contact_name, phone, whatsapp, status, publish, last_verified_at FROM partners
    WHERE 1=1 ${status ? 'AND status = @status' : "AND status <> 'archived'"} ${cat ? 'AND category = @cat' : ''}
    ${q ? 'AND (trade_name LIKE @q OR contact_name LIKE @q OR services_desc LIKE @q)' : ''} ORDER BY trade_name COLLATE NOCASE`).all({ status, cat, q: `%${q}%` });
  res.render('admin/partners', { title: 'Partenaires et prestataires', rows, status, cat, q });
});

router.get('/partenaires/:id', auth.requirePerm('partners.view'), (req, res) => {
  const isNew = req.params.id === 'nouveau';
  if (isNew && !auth.can(req.user, 'partners.edit')) return res.redirect('/admin/partenaires');
  const p = isNew ? { status: 'to_verify', category: 'autre', publish: 0, public_fields: '[]' } : db.get().prepare('SELECT * FROM partners WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.redirect('/admin/partenaires');
  const docs = p.id && auth.can(req.user, 'partners.confidential')
    ? db.get().prepare('SELECT d.*, m.original_name, m.mime, m.size FROM partner_documents d JOIN media m ON m.id = d.media_id WHERE partner_id = ? ORDER BY d.id DESC').all(p.id) : [];
  let fields = [];
  try { fields = JSON.parse(p.public_fields || '[]'); } catch { fields = []; }
  res.render('admin/partner-form', { title: p.id ? p.trade_name : 'Nouveau partenaire', p: redact(p, req.user), docs, fields, canEdit: auth.can(req.user, 'partners.edit') });
});

router.post('/partenaires/:id', auth.requirePerm('partners.edit'), (req, res) => {
  const b = req.body;
  const isNew = req.params.id === 'nouveau';
  const existing = isNew ? null : db.get().prepare('SELECT * FROM partners WHERE id = ?').get(Number(req.params.id));
  if (!isNew && !existing) return res.redirect('/admin/partenaires');
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const v = {
    trade_name: U.str(b.trade_name, 160),
    category: C.PARTNER_CATEGORIES[b.category] ? b.category : 'autre',
    contact_name: U.str(b.contact_name, 120) || null,
    phone: U.str(b.phone, 40) || null,
    whatsapp: U.str(b.whatsapp, 40) || null,
    email: U.str(b.email, 160) || null,
    address: U.str(b.address, 300) || null,
    service_area: U.str(b.service_area, 200) || null,
    services_desc: U.str(b.services_desc, 3000) || null,
    negotiated_rates: U.str(b.negotiated_rates, 3000) || null,
    booking_terms: U.str(b.booking_terms, 3000) || null,
    commission: U.str(b.commission, 500) || null,
    internal_notes: U.str(b.internal_notes, 5000) || null,
    status: C.PARTNER_STATUSES[b.status] ? b.status : 'to_verify',
    last_verified_at: /^\d{4}-\d{2}-\d{2}$/.test(b.last_verified_at || '') ? b.last_verified_at : null,
    publish: U.bool(b.publish),
    public_fields: JSON.stringify(arr(b.public_fields).filter((k) => C.PARTNER_PUBLIC_FIELDS[k])),
    public_description: U.str(b.public_description, 600) || null,
    public_phone: U.str(b.public_phone, 40) || null,
    public_email: U.str(b.public_email, 160) || null,
    public_website: U.safeUrl(b.public_website) || null,
    contact_publication_authorized: U.bool(b.contact_publication_authorized),
    image_publication_authorized: U.bool(b.image_publication_authorized),
    logo_media_id: existing ? existing.logo_media_id : null,
  };
  if (!v.trade_name) { req.flash('err', 'Le nom commercial est obligatoire.'); return res.redirect(req.originalUrl); }
  if (v.email && !U.isEmail(v.email)) { req.flash('err', 'E-mail invalide.'); return res.redirect(req.originalUrl); }
  try {
    const f = fileOf(req, 'logo');
    if (f) { const nid = media.store(f, { kind: 'image', access: 'manager', userId: req.user.id, alt: v.trade_name }); if (v.logo_media_id) media.remove(v.logo_media_id); v.logo_media_id = nid; }
  } catch (e) { req.flash('err', e.userMessage || 'Image refusée.'); return res.redirect(req.originalUrl); }
  if (b.remove_logo === '1' && v.logo_media_id) { media.remove(v.logo_media_id); v.logo_media_id = null; }

  const cols = Object.keys(v);
  let id;
  if (isNew) {
    id = db.get().prepare(`INSERT INTO partners (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(v).lastInsertRowid;
  } else {
    id = existing.id;
    db.get().prepare(`UPDATE partners SET ${cols.map((c) => `${c}=@${c}`).join(', ')}, updated_at=datetime('now') WHERE id=@id`).run({ ...v, id });
  }
  syncLogoAccess(db.get().prepare('SELECT * FROM partners WHERE id = ?').get(id));
  audit.log(req, isNew ? 'partner_create' : 'partner_update', 'partner', Number(id), { publish: v.publish });
  req.flash('ok', 'Partenaire enregistré.' + (v.publish ? ' Publication activée : seuls les champs cochés et autorisés sont visibles sur le site.' : ' Non publié sur le site.'));
  res.redirect(`/admin/partenaires/${id}`);
});

router.post('/partenaires/:id/documents', auth.requirePerm('partners.confidential'), (req, res) => {
  const p = db.get().prepare('SELECT id FROM partners WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.redirect('/admin/partenaires');
  const files = (req.files || []).filter((f) => f.fieldname === 'docs');
  let n = 0;
  for (const f of files) {
    try {
      const mid = media.store(f, { kind: 'document', access: 'owner', userId: req.user.id });
      db.get().prepare('INSERT INTO partner_documents (partner_id, media_id, label) VALUES (?,?,?)').run(p.id, mid, U.str(req.body.label, 160) || f.originalname);
      n++;
    } catch (e) { req.flash('err', e.userMessage || 'Fichier refusé (PDF, JPEG, PNG ou WebP).'); }
  }
  if (n) { audit.log(req, 'partner_docs_add', 'partner', p.id, { count: n }); req.flash('ok', `${n} document(s) ajouté(s) (accès propriétaire uniquement).`); }
  res.redirect(`/admin/partenaires/${p.id}#documents`);
});

router.post('/partenaires/:id/documents/:did/supprimer', auth.requirePerm('partners.confidential'), (req, res) => {
  const d = db.get().prepare('SELECT * FROM partner_documents WHERE id = ? AND partner_id = ?').get(Number(req.params.did), Number(req.params.id));
  if (d) { db.get().prepare('DELETE FROM partner_documents WHERE id = ?').run(d.id); media.remove(d.media_id); req.flash('ok', 'Document supprimé.'); }
  res.redirect(`/admin/partenaires/${req.params.id}#documents`);
});

router.post('/partenaires/:id/supprimer', auth.requirePerm('partners.edit'), (req, res) => {
  const p = db.get().prepare('SELECT * FROM partners WHERE id = ?').get(Number(req.params.id));
  if (p) {
    const docs = db.get().prepare('SELECT media_id FROM partner_documents WHERE partner_id = ?').all(p.id);
    db.get().prepare('DELETE FROM partners WHERE id = ?').run(p.id);
    docs.forEach((d) => media.remove(d.media_id));
    media.remove(p.logo_media_id);
    audit.log(req, 'partner_delete', 'partner', p.id, { name: p.trade_name });
    req.flash('ok', 'Partenaire supprimé définitivement.');
  }
  res.redirect('/admin/partenaires');
});

module.exports = router;
