'use strict';
// Contenus du site : textes, coordonnées, apparence, blocs de contenu, galerie.
const express = require('express');
const db = require('../../db');
const auth = require('../../lib/auth');
const audit = require('../../lib/audit');
const media = require('../../lib/media');
const settings = require('../../lib/settings');
const C = require('../../lib/constants');
const U = require('../../lib/util');
const { move } = require('./catalog');

const router = express.Router();
router.use(['/contenu', '/blocs', '/galerie'], auth.requirePerm('content.edit'));

const fileOf = (req, field) => (req.files || []).find((f) => f.fieldname === field);

const SECTIONS = {
  accueil: 'Page d’accueil',
  apropos: 'À propos et fondateur',
  coordonnees: 'Coordonnées et réseaux sociaux',
  apparence: 'Logo, nom et couleurs',
  devis: 'Paramètres des devis',
  seo: 'Référencement et options',
};

router.get('/contenu', (req, res) => res.redirect('/admin/contenu/accueil'));

router.get('/contenu/:section', (req, res, next) => {
  if (!SECTIONS[req.params.section]) return next();
  res.render('admin/content', { title: 'Contenu du site', section: req.params.section, SECTIONS, st: settings.all() });
});

function pairs(b, prefix, max = 8) {
  const arr = (k) => (Array.isArray(b[k]) ? b[k] : b[k] == null ? [] : [b[k]]);
  const titles = arr(prefix + '_title');
  const texts = arr(prefix + '_text');
  return titles.map((t, i) => ({ title: U.str(t, 120), text: U.str(texts[i], 600) })).filter((x) => x.title).slice(0, max);
}

// Remplace l'image stockée dans un paramètre (logo, photo du fondateur, image d'accueil).
function replaceImage(req, field, key, alt) {
  const f = fileOf(req, field);
  const current = Number(settings.get(key)) || null;
  if (f) {
    const id = media.store(f, { kind: 'image', access: 'public', userId: req.user.id, alt });
    if (current) media.remove(current);
    settings.set(key, id);
  } else if (req.body['remove_' + field] === '1' && current) {
    media.remove(current);
    settings.set(key, '');
  }
}

router.post('/contenu/:section', (req, res, next) => {
  const sec = req.params.section;
  if (!SECTIONS[sec]) return next();
  const b = req.body;
  const set = (k, max = 4000) => settings.set(k, U.str(b[k], max));
  try {
    if (sec === 'accueil') {
      set('home_hero_title', 120); set('home_hero_text', 600); set('home_intro', 3000);
      settings.set('why_items', pairs(b, 'why'));
      replaceImage(req, 'hero', 'hero_media_id', 'Événement organisé par PRESTIGIO EVENTS');
    } else if (sec === 'apropos') {
      set('about_mission', 2000); set('about_vision', 2000);
      settings.set('about_approach', pairs(b, 'step'));
      settings.set('values', pairs(b, 'value'));
      set('founder_name', 120); set('founder_title', 160); set('founder_bio', 5000);
      replaceImage(req, 'founder_photo', 'founder_photo_media_id', settings.get('founder_name'));
    } else if (sec === 'coordonnees') {
      const wa = U.normalizePhone(b.whatsapp);
      if (!U.isPhone(wa)) throw Object.assign(new Error(), { userMessage: 'Numéro WhatsApp invalide.' });
      settings.set('whatsapp', wa.startsWith('+') ? wa : '+' + wa);
      set('phone_display', 40); set('city', 160); set('address', 300);
      const email = U.str(b.public_email, 160);
      if (email && !U.isEmail(email)) throw Object.assign(new Error(), { userMessage: 'Adresse e-mail invalide.' });
      settings.set('public_email', email);
      const map = U.safeUrl(b.map_url);
      settings.set('map_url', map.startsWith('https://www.google.com/maps/embed') ? map : '');
      const socials = {};
      for (const k of ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube']) socials[k] = U.safeUrl(b['social_' + k]);
      settings.set('socials', socials);
    } else if (sec === 'apparence') {
      set('agency_name', 80); set('slogan', 200);
      for (const k of ['color_primary', 'color_accent']) if (U.isHexColor(b[k])) settings.set(k, b[k]);
      if (b.reset_colors === '1') { settings.set('color_primary', '#0B1F3A'); settings.set('color_accent', '#D4AF37'); }
      replaceImage(req, 'logo', 'logo_media_id', settings.get('agency_name'));
    } else if (sec === 'devis') {
      set('quote_payment_terms', 2000); set('quote_legal_mentions', 3000);
      settings.set('quote_validity_days', U.intOrNull(b.quote_validity_days, 1, 365) || 30);
    } else if (sec === 'seo') {
      set('seo_description', 300);
      settings.set('show_partners_section', U.bool(b.show_partners_section));
    }
  } catch (e) {
    if (!e.userMessage) throw e;
    req.flash('err', e.userMessage);
    return res.redirect(`/admin/contenu/${sec}`);
  }
  audit.log(req, 'settings_update', 'settings', null, { section: sec });
  req.flash('ok', 'Modifications enregistrées et publiées.');
  res.redirect(`/admin/contenu/${sec}`);
});

// ------------------------------------------------------------ Blocs de contenu
const PAGES = { home: 'Accueil', services: 'Services', offers: 'Offres et tarifs', about: 'À propos' };
const PAGE_URL = { home: '/', services: '/services', offers: '/offres', about: '/a-propos' };

router.get('/blocs', (req, res) => {
  const rows = db.get().prepare('SELECT * FROM content_blocks ORDER BY page, sort_order, id').all();
  res.render('admin/blocks', { title: 'Blocs de contenu', rows, PAGES, PAGE_URL });
});

router.get('/blocs/:id', (req, res) => {
  const bl = req.params.id === 'nouveau' ? { page: PAGES[req.query.page] ? req.query.page : 'home', type: 'text', published: 0 } : db.get().prepare('SELECT * FROM content_blocks WHERE id = ?').get(Number(req.params.id));
  if (!bl) return res.redirect('/admin/blocs');
  res.render('admin/block-form', { title: bl.id ? 'Modifier un bloc' : 'Nouveau bloc', bl, PAGES, PAGE_URL });
});

router.post('/blocs/:id', (req, res) => {
  const b = req.body;
  const isNew = req.params.id === 'nouveau';
  const existing = isNew ? null : db.get().prepare('SELECT * FROM content_blocks WHERE id = ?').get(Number(req.params.id));
  if (!isNew && !existing) return res.redirect('/admin/blocs');
  let mediaId = existing ? existing.media_id : null;
  const f = fileOf(req, 'image');
  try {
    if (f) { const nid = media.store(f, { kind: 'image', access: 'public', userId: req.user.id }); if (mediaId) media.remove(mediaId); mediaId = nid; }
  } catch (e) { req.flash('err', e.userMessage || 'Image refusée.'); return res.redirect(req.originalUrl); }
  if (b.remove_image === '1' && mediaId) { media.remove(mediaId); mediaId = null; }
  const btnUrl = U.str(b.button_url, 300);
  const v = {
    page: PAGES[b.page] ? b.page : 'home', type: ['text', 'image_text', 'cta', 'highlight'].includes(b.type) ? b.type : 'text',
    title: U.str(b.title, 200) || null, body: U.str(b.body, 8000) || null, media_id: mediaId,
    button_label: U.str(b.button_label, 60) || null,
    button_url: btnUrl && (btnUrl.startsWith('/') && !btnUrl.startsWith('//') ? btnUrl : U.safeUrl(btnUrl)) || null,
    published: U.bool(b.published),
  };
  let id = existing && existing.id;
  if (isNew) {
    v.sort_order = db.get().prepare('SELECT COALESCE(MAX(sort_order),0) + 10 AS m FROM content_blocks WHERE page = ?').get(v.page).m;
    id = db.get().prepare('INSERT INTO content_blocks (page, type, title, body, media_id, button_label, button_url, published, sort_order) VALUES (@page,@type,@title,@body,@media_id,@button_label,@button_url,@published,@sort_order)').run(v).lastInsertRowid;
  } else {
    db.get().prepare("UPDATE content_blocks SET page=@page, type=@type, title=@title, body=@body, media_id=@media_id, button_label=@button_label, button_url=@button_url, published=@published, updated_at=datetime('now') WHERE id=@id").run({ ...v, id });
  }
  audit.log(req, 'block_save', 'content_block', Number(id));
  req.flash('ok', v.published ? 'Bloc enregistré et publié.' : 'Bloc enregistré (non publié). Utilisez « Aperçu » pour le voir avant publication.');
  res.redirect(`/admin/blocs/${id}`);
});

router.post('/blocs/:id/deplacer', (req, res) => {
  const bl = db.get().prepare('SELECT page FROM content_blocks WHERE id = ?').get(Number(req.params.id));
  if (bl) move('content_blocks', Number(req.params.id), req.body.dir, 'WHERE page = ?', [bl.page]);
  res.redirect('/admin/blocs');
});

router.post('/blocs/:id/supprimer', (req, res) => {
  const bl = db.get().prepare('SELECT * FROM content_blocks WHERE id = ?').get(Number(req.params.id));
  if (bl) { db.get().prepare('DELETE FROM content_blocks WHERE id = ?').run(bl.id); media.remove(bl.media_id); }
  req.flash('ok', 'Bloc supprimé.');
  res.redirect('/admin/blocs');
});

// ------------------------------------------------------------ Galerie
router.get('/galerie', (req, res) => {
  const rows = db.get().prepare('SELECT g.*, m.alt_text, m.mime FROM gallery_items g LEFT JOIN media m ON m.id = g.media_id ORDER BY g.sort_order, g.id DESC').all();
  res.render('admin/gallery', { title: 'Galerie', rows, EVENT_TYPES: C.EVENT_TYPES });
});

router.post('/galerie', (req, res) => {
  const b = req.body;
  const files = (req.files || []).filter((f) => f.fieldname === 'files');
  const isPublic = U.bool(b.is_public);
  const base = { caption: U.str(b.caption, 300) || null, event_type: C.EVENT_TYPES[b.event_type] ? b.event_type : null, is_public: isPublic, is_illustration: U.bool(b.is_illustration) };
  const ins = db.get().prepare('INSERT INTO gallery_items (kind, media_id, video_url, caption, event_type, is_public, is_illustration, sort_order) VALUES (?,?,?,?,?,?,?,?)');
  let n = 0;
  const errors = [];
  for (const f of files) {
    try {
      const id = media.store(f, { kind: 'image_or_video', access: isPublic ? 'public' : 'staff', userId: req.user.id, alt: U.str(b.alt, 200) || base.caption });
      const m = db.get().prepare('SELECT mime FROM media WHERE id = ?').get(id);
      ins.run(m.mime.startsWith('video/') ? 'video' : 'image', id, null, base.caption, base.event_type, base.is_public, base.is_illustration, 0);
      n++;
    } catch (e) { errors.push(`${f.originalname} : ${e.userMessage || 'refusé'}`); }
  }
  const vurl = U.safeUrl(b.video_url);
  if (vurl) {
    if (require('../../lib/view-helpers').videoEmbed(vurl)) { ins.run('video', null, vurl, base.caption, base.event_type, base.is_public, base.is_illustration, 0); n++; }
    else errors.push('Lien vidéo non reconnu (YouTube ou Vimeo uniquement).');
  }
  audit.log(req, 'gallery_add', 'gallery', null, { count: n });
  if (errors.length) req.flash('err', `${n} élément(s) ajouté(s). Erreurs : ${errors.join(' ; ')}`);
  else req.flash('ok', n ? `${n} élément(s) ajouté(s) à la galerie.` : 'Aucun fichier sélectionné.');
  res.redirect('/admin/galerie');
});

router.post('/galerie/:id', (req, res) => {
  const g = db.get().prepare('SELECT * FROM gallery_items WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.redirect('/admin/galerie');
  const b = req.body;
  if (b.delete === '1') {
    db.get().prepare('DELETE FROM gallery_items WHERE id = ?').run(g.id);
    media.remove(g.media_id);
    req.flash('ok', 'Élément supprimé.');
  } else if (b.dir) {
    move('gallery_items', g.id, b.dir);
  } else {
    const isPublic = U.bool(b.is_public);
    db.get().prepare('UPDATE gallery_items SET caption = ?, event_type = ?, is_public = ?, is_illustration = ? WHERE id = ?')
      .run(U.str(b.caption, 300) || null, C.EVENT_TYPES[b.event_type] ? b.event_type : null, isPublic, U.bool(b.is_illustration), g.id);
    // Un élément privé n'est pas accessible par son URL directe.
    media.setAccess(g.media_id, isPublic ? 'public' : 'staff');
    media.setAlt(g.media_id, U.str(b.alt, 200));
    req.flash('ok', 'Élément mis à jour.');
  }
  res.redirect('/admin/galerie');
});

module.exports = router;
