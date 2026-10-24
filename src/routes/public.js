'use strict';
// Site public. IMPORTANT : chaque requête SQL de ce fichier sélectionne
// explicitement des colonnes publiques. Les tables privées (demandes, devis,
// paiements, notes, coordonnées privées des partenaires) ne sont jamais lues ici,
// sauf en écriture pour enregistrer une nouvelle demande.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const auth = require('../lib/auth');
const catalog = require('../lib/catalog');
const formguard = require('../lib/formguard');
const quotes = require('../lib/quotes');
const mailer = require('../lib/mailer');
const config = require('../config');
const PricingCore = require('../../public/js/pricing-core');
const C = require('../lib/constants');
const U = require('../lib/util');

const router = express.Router();

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.publicFormLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Trop de demandes envoyées depuis cette connexion. Merci de réessayer plus tard ou de nous écrire sur WhatsApp.',
});

// Aperçu des contenus non publiés : réservé aux comptes autorisés à gérer le contenu.
function previewMode(req) {
  return req.query.apercu === '1' && auth.can(req.user, 'content.edit');
}

router.use((req, res, next) => {
  res.locals.preview = previewMode(req);
  res.locals.showPartnersNav = res.locals.s.show_partners_section === '1' &&
    !!db.get().prepare('SELECT 1 FROM partners WHERE publish = 1 AND status = \'active\' LIMIT 1').get();
  next();
});

function blocks(page, preview) {
  return db.get().prepare(`SELECT id, type, title, body, media_id, button_label, button_url, published FROM content_blocks
    WHERE page = ? ${preview ? '' : 'AND published = 1'} ORDER BY sort_order, id`).all(page);
}

function publicServices(preview, slug) {
  return db.get().prepare(`SELECT id, slug, name, category, summary, description, includes, media_id, demo_image, is_protocol, published
    FROM services WHERE 1=1 ${preview ? '' : 'AND published = 1'} ${slug ? 'AND slug = @slug' : ''} ORDER BY sort_order, id`).all(slug ? { slug } : {});
}

function publicGallery(limit) {
  return db.get().prepare(`SELECT g.id, g.kind, g.media_id, g.video_url, g.caption, g.event_type, g.is_illustration, m.alt_text
    FROM gallery_items g LEFT JOIN media m ON m.id = g.media_id
    WHERE g.is_public = 1 ORDER BY g.sort_order, g.id DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`).all();
}

// Projection publique d'un partenaire : uniquement les champs explicitement
// autorisés (liste blanche) et seulement si la publication est activée.
function publicPartners() {
  const rows = db.get().prepare(`SELECT id, trade_name, category, service_area, public_fields, public_description, public_phone,
      public_email, public_website, contact_publication_authorized, image_publication_authorized, logo_media_id
    FROM partners WHERE publish = 1 AND status = 'active' ORDER BY trade_name`).all();
  return rows.map((p) => {
    let fields = [];
    try { fields = JSON.parse(p.public_fields || '[]'); } catch { fields = []; }
    const f = (k) => fields.includes(k);
    const contactOk = p.contact_publication_authorized === 1;
    return {
      name: p.trade_name,
      category: f('category') ? C.PARTNER_CATEGORIES[p.category] || null : null,
      description: f('description') ? p.public_description || null : null,
      area: f('area') ? p.service_area || null : null,
      logo: f('logo') && p.image_publication_authorized === 1 ? p.logo_media_id : null,
      phone: f('phone') && contactOk ? p.public_phone || null : null,
      email: f('email') && contactOk ? p.public_email || null : null,
      website: f('website') && contactOk ? U.safeUrl(p.public_website) || null : null,
    };
  });
}

router.get('/', (req, res) => {
  const preview = res.locals.preview;
  res.render('public/home', {
    title: null,
    services: publicServices(preview).slice(0, 6),
    gallery: publicGallery(6).filter((g) => !g.is_illustration),
    blocks: blocks('home', preview),
  });
});

router.get('/services', (req, res) => {
  const preview = res.locals.preview;
  const services = publicServices(preview);
  const tariffs = catalog.validTariffs(U.today()).filter((t) => t.scope === 'service')
    .map((t) => ({ ...catalog.publicTariff(t), service_id: t.service_id }));
  res.render('public/services', {
    title: 'Nos services',
    description: 'Organisation de mariages, cérémonies, anniversaires, conférences et événements d’entreprise à Kinshasa : décoration, salles, catering, sonorisation, DJ, photo, protocole et coordination.',
    services, tariffs, blocks: blocks('services', preview),
  });
});

router.get('/services/:slug', (req, res, next) => {
  const preview = res.locals.preview;
  const svc = publicServices(preview, String(req.params.slug).slice(0, 100))[0];
  if (!svc) return next();
  const tariffs = catalog.validTariffs(U.today()).filter((t) => t.service_id === svc.id).map(catalog.publicTariff);
  res.render('public/service', { title: svc.name, description: svc.summary, svc, tariffs });
});

router.get('/offres', (req, res) => {
  const preview = res.locals.preview;
  const packages = db.get().prepare(`SELECT id, name, event_type, summary, price_type, amount_cents, includes, excludes, provisional, featured, published
    FROM packages ${preview ? '' : 'WHERE published = 1'} ORDER BY sort_order, id`).all();
  const cat = catalog.publicCatalog();
  res.render('public/offers', {
    title: 'Offres et tarifs',
    description: 'Forfaits et services à la carte de PRESTIGIO EVENTS à Kinshasa. Estimez votre événement en ligne et demandez un devis.',
    packages, cat, blocks: blocks('offers', preview),
  });
});

router.get('/galerie', (req, res) => {
  const items = publicGallery();
  const types = [...new Set(items.map((i) => i.event_type).filter(Boolean))];
  res.render('public/gallery', { title: 'Galerie', description: 'Galerie photos et vidéos des événements organisés par PRESTIGIO EVENTS à Kinshasa.', items, types });
});

router.get('/a-propos', (req, res) => {
  res.render('public/about', {
    title: 'À propos',
    description: 'PRESTIGIO EVENTS, agence événementielle à Kinshasa fondée par Billy Kito : mission, vision, valeurs et accompagnement.',
    blocks: blocks('about', res.locals.preview),
  });
});

router.get('/partenaires', (req, res, next) => {
  if (res.locals.s.show_partners_section !== '1') return next();
  res.render('public/partners', { title: 'Partenaires et prestataires', partners: publicPartners() });
});

router.get('/contact', (req, res) => {
  res.render('public/contact', { title: 'Contact', form: {}, errors: {}, sent: false, token: formguard.issue('contact') });
});

router.post('/contact', submitLimiter, async (req, res) => {
  const b = req.body;
  const g = formguard.check('contact', b._ft, b.website);
  const form = { name: U.str(b.name, 120), phone: U.str(b.phone, 40), email: U.str(b.email, 160), message: U.str(b.message, 3000) };
  const errors = {};
  if (!g.ok) errors._form = g.reason === 'too_fast' ? 'Envoi trop rapide : merci de vérifier le formulaire puis réessayer.' : 'Le formulaire a expiré. Merci de réessayer.';
  if (!form.name) errors.name = 'Indiquez votre nom.';
  if (!form.phone && !form.email) errors.phone = 'Indiquez un téléphone ou un e-mail.';
  if (form.phone && !U.isPhone(form.phone)) errors.phone = 'Numéro de téléphone invalide.';
  if (form.email && !U.isEmail(form.email)) errors.email = 'Adresse e-mail invalide.';
  if (form.message.length < 5) errors.message = 'Écrivez votre message.';
  if (Object.keys(errors).length) {
    return res.status(400).render('public/contact', { title: 'Contact', form, errors, sent: false, token: formguard.issue('contact') });
  }
  db.get().prepare('INSERT INTO contact_messages (name, phone, email, message) VALUES (?,?,?,?)').run(form.name, form.phone, form.email, form.message);
  notifyAdmin(`Nouveau message de contact — ${form.name}`, `${form.name}\n${form.phone}\n${form.email}\n\n${form.message}`);
  res.render('public/contact', { title: 'Contact', form: {}, errors: {}, sent: true, token: formguard.issue('contact') });
});

// ------------------------------------------------------------------ Devis
router.get('/devis', (req, res) => {
  const cat = catalog.publicCatalog();
  res.render('public/quote', {
    title: 'Demander un devis',
    description: 'Demandez un devis pour votre événement à Kinshasa et obtenez une estimation indicative immédiate.',
    cat, token: formguard.issue('quote'), preselect: Number(req.query.service) || null, eventPreselect: C.EVENT_TYPES[req.query.type] ? req.query.type : null,
  });
});

router.get('/api/catalogue', (req, res) => {
  res.set('Cache-Control', 'no-cache').json(catalog.publicCatalog());
});

function parseQuoteForm(b, cat) {
  const errors = {};
  const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
  const serviceIds = new Set(cat.services.map((s) => s.id));
  const optionIds = new Set(cat.services.flatMap((s) => s.tariffs.filter((t) => t.optional).map((t) => t.id)));
  const services = [...new Set(arr(b.services).map(Number).filter((id) => serviceIds.has(id)))];
  const options = [...new Set(arr(b.options).map(Number).filter((id) => optionIds.has(id)))];
  const hasProtocol = cat.services.some((s) => s.is_protocol && services.includes(s.id));
  const agentsRaw = b.protocol_unknown_cb ? 'unknown' : b.protocol_agents_n;

  const d = {
    event_type: C.EVENT_TYPES[b.event_type] ? b.event_type : null,
    event_type_other: U.str(b.event_type_other, 120) || null,
    event_date: /^\d{4}-\d{2}-\d{2}$/.test(b.event_date || '') ? b.event_date : null,
    start_time: /^\d{2}:\d{2}$/.test(b.start_time || '') ? b.start_time : null,
    duration_hours: b.duration_hours === '' || b.duration_hours == null ? null : Number(String(b.duration_hours).replace(',', '.')),
    guests: U.intOrNull(b.guests, 1, 100000),
    location_area: U.str(b.location_area, 160) || null,
    venue_booked: b.venue_booked === 'oui' ? 1 : b.venue_booked === 'non' ? 0 : null,
    wants_venue_search: b.venue_booked === 'non' ? (b.wants_venue_search === 'oui' ? 1 : 0) : null,
    services, options,
    protocol_unknown: hasProtocol && agentsRaw === 'unknown' ? 1 : 0,
    protocol_agents: hasProtocol && agentsRaw !== 'unknown' ? U.intOrNull(agentsRaw, 1, 500) : null,
    protocol_tasks: hasProtocol ? arr(b.protocol_tasks).filter((k) => C.PROTOCOL_TASKS[k]) : [],
    protocol_tasks_other: hasProtocol ? U.str(b.protocol_tasks_other, 200) : '',
    budget_mode: ['exact', 'range', 'unknown'].includes(b.budget_mode) ? b.budget_mode : 'unknown',
    budget_min_cents: null, budget_max_cents: null,
    client_name: U.str(b.client_name, 120),
    client_phone: U.str(b.client_phone, 40),
    client_email: U.str(b.client_email, 160).toLowerCase() || null,
    client_notes: U.str(b.client_notes, 3000) || null,
    consent: b.consent === 'oui' ? 1 : 0,
  };
  if (d.budget_mode === 'exact') {
    d.budget_min_cents = d.budget_max_cents = U.parseMoney(b.budget_amount);
    if (d.budget_min_cents == null) errors.budget = 'Indiquez un budget valide ou choisissez une autre option.';
  } else if (d.budget_mode === 'range') {
    const r = C.BUDGET_RANGES[Number(b.budget_range)];
    if (!r) errors.budget = 'Choisissez une fourchette budgétaire.';
    else { d.budget_min_cents = r[0] * 100; d.budget_max_cents = r[1] == null ? null : r[1] * 100; }
  }
  if (!d.event_type) errors.event_type = 'Choisissez un type d’événement.';
  if (d.event_type === 'autre' && !d.event_type_other) errors.event_type = 'Précisez le type d’événement.';
  if (b.event_date && !d.event_date) errors.event_date = 'Date invalide.';
  if (d.event_date && d.event_date < U.today()) errors.event_date = 'La date doit être dans le futur.';
  if (d.duration_hours != null && (!isFinite(d.duration_hours) || d.duration_hours <= 0 || d.duration_hours > 240)) errors.duration_hours = 'Durée invalide.';
  if (b.guests && d.guests == null) errors.guests = 'Nombre d’invités invalide.';
  if (hasProtocol && agentsRaw !== 'unknown' && d.protocol_agents == null) errors.protocol_agents = 'Indiquez le nombre d’agents de protocole ou choisissez « Je ne sais pas encore ».';
  if (!d.client_name) errors.client_name = 'Indiquez votre nom.';
  if (!U.isPhone(d.client_phone)) errors.client_phone = 'Indiquez un numéro de téléphone ou WhatsApp valide.';
  if (d.client_email && !U.isEmail(d.client_email)) errors.client_email = 'Adresse e-mail invalide.';
  if (!d.consent) errors.consent = 'Votre accord est nécessaire pour que nous puissions vous recontacter.';
  return { d, errors };
}

router.post('/devis', submitLimiter, (req, res) => {
  const b = req.body;
  const wantsJson = req.get('accept') === 'application/json';
  const g = formguard.check('quote', b._ft, b.website);
  const cat = catalog.publicCatalog();
  const fail = (status, errors) => {
    if (wantsJson) return res.status(status).json({ ok: false, errors });
    return res.status(status).render('public/quote', { title: 'Demander un devis', cat, token: formguard.issue('quote'), preselect: null, eventPreselect: null, serverErrors: errors, prev: b });
  };
  if (!g.ok) {
    return fail(400, { _form: g.reason === 'too_fast' ? 'Envoi trop rapide. Merci de vérifier vos informations puis de réessayer.' : 'Le formulaire a expiré. Merci de recharger la page.' });
  }
  // Anti double-soumission : un même formulaire ne crée qu'une seule demande.
  const existing = db.get().prepare('SELECT reference FROM requests WHERE submit_token = ?').get(g.nonce);
  if (existing) return done(existing.reference);

  const { d, errors } = parseQuoteForm(b, cat);
  if (Object.keys(errors).length) return fail(400, errors);

  // Estimation visible par le client (tarifs publics uniquement), conservée pour référence.
  const est = PricingCore.estimate(cat, { services: d.services, options: d.options, guests: d.guests, hours: d.duration_hours, agents: d.protocol_unknown ? 'unknown' : d.protocol_agents });

  let reference;
  let requestId;
  db.tx(() => {
    reference = quotes.newRequestReference();
    requestId = Number(db.get().prepare(`INSERT INTO requests (reference, status, event_type, event_type_other, event_date, start_time, duration_hours, guests,
        location_area, venue_booked, wants_venue_search, selections, protocol_agents, protocol_unknown, protocol_tasks, budget_mode, budget_min_cents,
        budget_max_cents, client_name, client_phone, client_email, client_notes, consent, client_estimate, submit_token)
      VALUES (@reference, 'new', @event_type, @event_type_other, @event_date, @start_time, @duration_hours, @guests, @location_area, @venue_booked,
        @wants_venue_search, @selections, @protocol_agents, @protocol_unknown, @protocol_tasks, @budget_mode, @budget_min_cents, @budget_max_cents,
        @client_name, @client_phone, @client_email, @client_notes, @consent, @client_estimate, @submit_token)`).run({
      ...d,
      reference,
      selections: JSON.stringify({ services: d.services, options: d.options }),
      protocol_tasks: JSON.stringify({ tasks: d.protocol_tasks, other: d.protocol_tasks_other }),
      client_estimate: JSON.stringify({ total_cents: est.total_cents, has_unconfirmed: est.has_unconfirmed }),
      submit_token: g.nonce,
    }).lastInsertRowid);
    quotes.addHistory(requestId, 'new', null, 'Demande reçue depuis le site.');
    quotes.generateDraft(requestId);
  });

  notifyAdmin(`Nouvelle demande de devis ${reference}`,
    `Une nouvelle demande (${reference}) et son devis provisoire sont disponibles dans l’administration :\n${config.baseUrl}/admin/demandes\n\n` +
    `Client : ${d.client_name} — ${d.client_phone}\nÉvénement : ${C.EVENT_TYPES[d.event_type]}${d.event_date ? ' le ' + d.event_date : ''}`);
  return done(reference);

  function done(ref) {
    if (wantsJson) return res.json({ ok: true, reference: ref });
    res.render('public/quote-received', { title: 'Demande reçue', reference: ref });
  }
});

// Notification facultative à l'administrateur (sans bloquer la réponse).
function notifyAdmin(subject, text) {
  if (!mailer.isConfigured() || !config.adminNotifyEmail) return;
  mailer.send({ to: config.adminNotifyEmail, subject, text }).catch((e) => console.error('Notification admin non envoyée :', e.message));
}

router.get('/devis/confirmation/:ref', (req, res) => {
  // Page de confirmation sans aucune donnée personnelle.
  res.render('public/quote-received', { title: 'Demande reçue', reference: U.str(req.params.ref, 30).replace(/[^A-Z0-9-]/g, '') });
});

// ------------------------------------------------------------------ SEO
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /media/\nAllow: /\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const pages = ['/', '/services', '/offres', '/galerie', '/a-propos', '/contact', '/devis'];
  if (res.locals.showPartnersNav) pages.push('/partenaires');
  for (const s of publicServices(false)) pages.push(`/services/${s.slug}`);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${config.baseUrl}${p}</loc></url>`).join('\n')}\n</urlset>`);
});

module.exports = router;
module.exports.publicPartners = publicPartners;
