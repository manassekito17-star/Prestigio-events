'use strict';
// Demandes, devis (validation obligatoire du directeur), notes, paiements.
const express = require('express');
const db = require('../../db');
const auth = require('../../lib/auth');
const audit = require('../../lib/audit');
const quotes = require('../../lib/quotes');
const media = require('../../lib/media');
const C = require('../../lib/constants');
const U = require('../../lib/util');
const discovery = require('../../lib/discovery');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ------------------------------------------------------------ Liste
function listFilters(req) {
  const f = {
    q: U.str(req.query.q, 100),
    status: C.STATUSES[req.query.status] ? req.query.status : '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : '',
    datefield: req.query.datefield === 'event' ? 'event' : 'created',
    sort: ['created_desc', 'created_asc', 'event_asc', 'event_desc', 'name'].includes(req.query.sort) ? req.query.sort : 'created_desc',
    archived: req.query.archived === '1',
  };
  const where = [];
  const p = {};
  if (!auth.can(req.user, 'requests.view_all')) { where.push('r.assigned_to = @me'); p.me = req.user.id; }
  if (f.q) { where.push('(r.reference LIKE @q OR qu.reference LIKE @q OR r.client_name LIKE @q OR r.client_phone LIKE @q OR r.client_email LIKE @q)'); p.q = `%${f.q}%`; }
  if (f.status) { where.push('r.status = @status'); p.status = f.status; } else if (!f.archived) where.push("r.status NOT IN ('archived')");
  const col = f.datefield === 'event' ? 'r.event_date' : 'date(r.created_at)';
  if (f.from) { where.push(`${col} >= @from`); p.from = f.from; }
  if (f.to) { where.push(`${col} <= @to`); p.to = f.to; }
  const order = { created_desc: 'r.created_at DESC', created_asc: 'r.created_at ASC', event_asc: 'r.event_date IS NULL, r.event_date ASC', event_desc: 'r.event_date DESC', name: 'r.client_name COLLATE NOCASE' }[f.sort];
  const sql = `SELECT r.*, qu.reference AS quote_reference, u.name AS assignee_name,
      v.total_cents, v.state AS version_state, v.version_no, v.has_unconfirmed
    FROM requests r LEFT JOIN quotes qu ON qu.request_id = r.id
    LEFT JOIN quote_versions v ON v.quote_id = qu.id AND v.version_no = (SELECT MAX(version_no) FROM quote_versions WHERE quote_id = qu.id)
    LEFT JOIN users u ON u.id = r.assigned_to
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  return { f, sql, p };
}

router.get('/demandes', auth.requirePerm('requests.view_all', 'requests.view_assigned'), (req, res) => {
  const { f, sql, p } = listFilters(req);
  const rows = db.get().prepare(sql + ' LIMIT 500').all(p);
  res.render('admin/requests', { title: 'Demandes et devis', rows, f });
});

router.get('/devis', auth.requirePerm('quotes.view'), (req, res) => {
  res.redirect('/admin/demandes' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''));
});

router.get('/demandes/export.csv', auth.requirePerm('requests.export'), (req, res) => {
  const { sql, p } = listFilters(req);
  const rows = db.get().prepare(sql).all(p);
  const cols = [
    ['Référence', 'reference'], ['Devis', 'quote_reference'], ['Statut', (r) => C.STATUSES[r.status] ? C.STATUSES[r.status].label : r.status],
    ['Reçue le', 'created_at'], ['Type', (r) => (r.event_type === 'autre' ? r.event_type_other : C.EVENT_TYPES[r.event_type])],
    ['Date événement', 'event_date'], ['Invités', 'guests'], ['Agents protocole', (r) => (r.protocol_unknown ? 'à définir' : r.protocol_agents)],
    ['Lieu', 'location_area'], ['Client', 'client_name'], ['Téléphone', 'client_phone'], ['E-mail', 'client_email'],
    ['Total devis (USD)', (r) => (r.total_cents == null ? '' : (r.total_cents / 100).toFixed(2))], ['Responsable', 'assignee_name'],
  ];
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // protection contre l'injection de formules
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [cols.map((c) => cell(c[0])).join(';')]
    .concat(rows.map((r) => cols.map(([, k]) => cell(typeof k === 'function' ? k(r) : r[k])).join(';'))).join('\r\n');
  audit.log(req, 'export_requests', 'request', null, { count: rows.length });
  res.set('Content-Disposition', `attachment; filename="demandes-${U.today()}.csv"`).type('text/csv; charset=utf-8').send('﻿' + csv);
});

// ------------------------------------------------------------ Détail
function loadRequest(req, res, next) {
  const r = db.get().prepare('SELECT * FROM requests WHERE id = ?').get(Number(req.params.id));
  if (!r || !auth.canSeeRequest(req.user, r)) {
    res.status(404);
    return res.render('admin/error', { title: 'Introuvable', message: 'Cette demande n’existe pas ou vous n’y avez pas accès.' });
  }
  req.request = r;
  next();
}

router.get('/demandes/:id', auth.requirePerm('requests.view_all', 'requests.view_assigned'), loadRequest, (req, res) => {
  const r = req.request;
  const u = req.user;
  if (!r.seen_at && auth.can(u, 'requests.view_all')) db.get().prepare("UPDATE requests SET seen_at = datetime('now') WHERE id = ?").run(r.id);
  const sel = JSON.parse(r.selections || '{}');
  const services = sel.services && sel.services.length
    ? db.get().prepare(`SELECT id, name, form_label FROM services WHERE id IN (${sel.services.map(() => '?').join(',')})`).all(...sel.services) : [];
  const options = sel.options && sel.options.length
    ? db.get().prepare(`SELECT id, name FROM tariffs WHERE id IN (${sel.options.map(() => '?').join(',')})`).all(...sel.options) : [];
  let ptasks = {};
  try { ptasks = JSON.parse(r.protocol_tasks || '{}') || {}; } catch { ptasks = {}; }
  const data = {
    title: `Demande ${r.reference}`, r, services, options, ptasks,
    notes: db.get().prepare('SELECT n.*, u.name AS author FROM request_notes n LEFT JOIN users u ON u.id = n.user_id WHERE request_id = ? ORDER BY n.created_at DESC').all(r.id),
    history: db.get().prepare('SELECT h.*, u.name AS author FROM request_history h LEFT JOIN users u ON u.id = h.user_id WHERE request_id = ? ORDER BY h.id DESC').all(r.id),
    tasks: db.get().prepare('SELECT t.*, u.name AS assignee FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE request_id = ? ORDER BY t.status = \'done\', t.due_date IS NULL, t.due_date').all(r.id),
    users: db.get().prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all(),
  };
  if (auth.can(u, 'quotes.view')) {
    data.bundle = quotes.getQuoteBundle(r.id);
    data.tariffs = db.get().prepare(`SELECT t.id, t.name, t.method, t.amount_cents, t.provisional, s.name AS service FROM tariffs t
      LEFT JOIN services s ON s.id = t.service_id WHERE t.active = 1 ORDER BY s.sort_order, t.sort_order`).all();
  }
  if (auth.can(u, 'payments.view')) {
    data.payments = db.get().prepare('SELECT p.*, u.name AS recorder FROM payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE request_id = ? ORDER BY paid_on').all(r.id);
    const ref = data.bundle && data.bundle.versions.find((v) => ['sent', 'approved'].includes(v.state));
    data.approvedTotal = ref ? ref.total_cents : null;
    data.paidUsd = data.payments.filter((p) => p.currency === 'USD').reduce((a, p) => a + p.amount_cents, 0);
    data.paidCdf = data.payments.filter((p) => p.currency === 'CDF').reduce((a, p) => a + p.amount_cents, 0);
  }
  // Fiche de découverte mariage (le budget est masqué aux comptes sans accès aux devis)
  const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  data.discoverySections = discovery.isWedding(r.event_type) || r.discovery
    ? discovery.display(parseJson(r.discovery) || {}, { hideBudget: !auth.can(u, 'quotes.view') }) : null;
  data.discoveryInternal = parseJson(r.discovery_internal);
  res.render('admin/request', data);
});

router.post('/demandes/:id/statut', auth.requirePerm('requests.edit'), loadRequest, (req, res) => {
  const st = req.body.status;
  if (!C.MANUAL_STATUSES.includes(st)) {
    req.flash('err', 'Ce statut ne peut être défini que par les actions du devis (validation, envoi, réponse du client).');
  } else {
    quotes.setStatus(req.request.id, st, req.user.id, U.str(req.body.comment, 500) || 'Statut modifié manuellement.');
    audit.log(req, 'request_status', 'request', req.request.id, { status: st });
    req.flash('ok', 'Statut mis à jour.');
  }
  res.redirect(`/admin/demandes/${req.request.id}`);
});

router.post('/demandes/:id/assigner', auth.requirePerm('requests.assign'), loadRequest, (req, res) => {
  const uid = U.intOrNull(req.body.assigned_to, 1);
  const user = uid ? db.get().prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').get(uid) : null;
  db.get().prepare("UPDATE requests SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?").run(user ? user.id : null, req.request.id);
  audit.log(req, 'request_assign', 'request', req.request.id, { to: user ? user.id : null });
  req.flash('ok', user ? `Demande assignée à ${user.name}.` : 'Assignation retirée.');
  res.redirect(`/admin/demandes/${req.request.id}`);
});

router.post('/demandes/:id/notes', auth.requirePerm('requests.notes'), loadRequest, (req, res) => {
  const body = U.str(req.body.body, 5000);
  if (body) db.get().prepare('INSERT INTO request_notes (request_id, user_id, body) VALUES (?,?,?)').run(req.request.id, req.user.id, body);
  res.redirect(`/admin/demandes/${req.request.id}#notes`);
});

router.post('/demandes/:id/decouverte', auth.requirePerm('requests.edit'), loadRequest, (req, res) => {
  const b = req.body;
  let before = {};
  try { before = JSON.parse(req.request.discovery_internal || '{}') || {}; } catch { before = {}; }
  const v = {
    observations: U.str(b.observations, 4000) || null,
    recommendations: U.str(b.recommendations, 4000) || null,
    next_step: discovery.NEXT_STEPS[b.next_step] ? b.next_step : null,
    follow_up: /^\d{4}-\d{2}-\d{2}$/.test(b.follow_up || '') ? b.follow_up : null,
    updated_by: req.user.id,
  };
  db.get().prepare("UPDATE requests SET discovery_internal = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(v), req.request.id);
  // Tâche de suivi lorsqu'une nouvelle date ou étape est fixée
  const planTask = v.follow_up && (v.follow_up !== before.follow_up || v.next_step !== before.next_step);
  if (planTask) {
    const title = 'Suivi découverte : ' + (discovery.NEXT_STEPS[v.next_step] || 'recontacter le client');
    db.get().prepare('INSERT INTO tasks (request_id, title, due_date, assignee_id) VALUES (?,?,?,?)').run(req.request.id, title, v.follow_up, req.request.assigned_to || null);
  }
  audit.log(req, 'discovery_internal_update', 'request', req.request.id);
  req.flash('ok', 'Observations enregistrées.' + (planTask ? ' Une tâche de suivi a été planifiée.' : ''));
  res.redirect(`/admin/demandes/${req.request.id}#decouverte`);
});

router.post('/demandes/:id/supprimer', auth.requirePerm('requests.delete'), loadRequest, (req, res) => {
  if (req.body.confirm !== req.request.reference) {
    req.flash('err', 'Pour supprimer définitivement, saisissez exactement la référence de la demande.');
    return res.redirect(`/admin/demandes/${req.request.id}`);
  }
  const mediaIds = db.get().prepare(`SELECT pdf_media_id AS m FROM quote_versions v JOIN quotes q ON q.id = v.quote_id WHERE q.request_id = ?
    UNION SELECT proof_media_id FROM payments WHERE request_id = ?`).all(req.request.id, req.request.id).map((x) => x.m).filter(Boolean);
  db.tx(() => db.get().prepare('DELETE FROM requests WHERE id = ?').run(req.request.id));
  mediaIds.forEach(media.remove);
  audit.log(req, 'request_delete', 'request', req.request.id, { reference: req.request.reference });
  req.flash('ok', `Demande ${req.request.reference} supprimée définitivement.`);
  res.redirect('/admin/demandes');
});

// ------------------------------------------------------------ Devis
function parseLines(b) {
  const arr = (k) => (Array.isArray(b[k]) ? b[k] : b[k] == null ? [] : [b[k]]);
  const labels = arr('l_label');
  const out = [];
  labels.forEach((label, i) => {
    label = U.str(label, 300);
    if (!label) return;
    const kind = ['service', 'fee', 'discount'].includes(arr('l_kind')[i]) ? arr('l_kind')[i] : 'service';
    let qty = Number(String(arr('l_qty')[i] || '1').replace(',', '.'));
    if (!isFinite(qty) || qty < 0 || qty > 100000) qty = 1;
    const unitPrice = U.parseMoney(arr('l_price')[i]);
    const toConfirm = arr('l_confirm')[i] === '1' || unitPrice == null;
    out.push({
      kind, label,
      description: U.str(arr('l_desc')[i], 500),
      qty, unit: U.str(arr('l_unit')[i], 40) || 'forfait',
      unit_price_cents: unitPrice,
      amount_cents: toConfirm ? null : Math.round(qty * unitPrice),
      to_confirm: toConfirm,
      provisional: arr('l_prov')[i] === '1',
      tariff_id: U.intOrNull(arr('l_tariff')[i], 1),
    });
  });
  return out;
}

function versionForRequest(req) {
  const v = quotes.getVersion(Number(req.params.vid));
  if (!v || v.request_id !== req.request.id) throw quotes.userError('Version de devis introuvable.');
  return v;
}

router.post('/demandes/:id/devis/:vid(\\d+)', auth.requirePerm('quotes.edit'), loadRequest, wrap(async (req, res) => {
  const v = versionForRequest(req);
  const b = req.body;
  const data = {
    lines: parseLines(b),
    payment_terms: U.str(b.payment_terms, 2000),
    validity_days: U.intOrNull(b.validity_days, 1, 365) || 30,
    client_message: U.str(b.client_message, 3000) || null,
    conditions: U.str(b.conditions, 3000) || null,
    internal_comment: U.str(b.internal_comment, 3000) || null,
  };
  try {
    quotes.saveDraft(v.id, data, req.user);
    audit.log(req, 'quote_save_draft', 'quote_version', v.id);
    if (b.action !== 'approve') {
      req.flash('ok', 'Devis enregistré comme brouillon. Rien n’a été envoyé au client.');
      return res.redirect(`/admin/demandes/${req.request.id}#devis`);
    }
    if (!auth.can(req.user, 'quotes.approve')) {
      req.flash('err', 'Brouillon enregistré. Seul le directeur (propriétaire) peut valider et envoyer un devis.');
      return res.redirect(`/admin/demandes/${req.request.id}#devis`);
    }
    const r = await quotes.approveAndSend(v.id, req.user);
    audit.log(req, 'quote_approve', 'quote_version', v.id, { sent: r.sent });
    req.flash(r.sent ? 'ok' : 'warn', r.sent ? 'Devis validé et envoyé au client par e-mail.' : 'Devis validé. ' + r.reason);
  } catch (e) {
    if (!e.userMessage) throw e;
    req.flash('err', e.userMessage);
  }
  res.redirect(`/admin/demandes/${req.request.id}#devis`);
}));

router.post('/demandes/:id/devis/:vid(\\d+)/envoyer-email', auth.requirePerm('quotes.approve'), loadRequest, wrap(async (req, res) => {
  const v = versionForRequest(req);
  try {
    const r = await quotes.sendByEmail(v.id, req.user);
    audit.log(req, 'quote_send_email', 'quote_version', v.id, { sent: r.sent });
    req.flash(r.sent ? 'ok' : 'warn', r.sent ? 'Devis envoyé par e-mail.' : r.reason);
  } catch (e) { if (!e.userMessage) throw e; req.flash('err', e.userMessage); }
  res.redirect(`/admin/demandes/${req.request.id}#devis`);
}));

router.post('/demandes/:id/devis/:vid(\\d+)/envoi-manuel', auth.requirePerm('quotes.approve'), loadRequest, (req, res) => {
  const v = versionForRequest(req);
  const channel = ['whatsapp_manual', 'other_manual'].includes(req.body.channel) ? req.body.channel : 'other_manual';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.sent_on || '') ? req.body.sent_on + ' 12:00:00' : null;
  try {
    quotes.markSent(v.id, req.user, channel, date, U.str(req.body.note, 500));
    audit.log(req, 'quote_manual_send', 'quote_version', v.id, { channel });
    req.flash('ok', 'Envoi manuel enregistré.');
  } catch (e) { if (!e.userMessage) throw e; req.flash('err', e.userMessage); }
  res.redirect(`/admin/demandes/${req.request.id}#devis`);
});

router.post('/demandes/:id/devis/:vid(\\d+)/reponse', auth.requirePerm('quotes.record_response'), loadRequest, (req, res) => {
  const v = versionForRequest(req);
  const accepted = req.body.response === 'accepted';
  try {
    quotes.recordResponse(v.id, req.user, accepted, /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : null, U.str(req.body.note, 500));
    audit.log(req, accepted ? 'quote_accepted' : 'quote_refused', 'quote_version', v.id);
    req.flash('ok', accepted ? 'Acceptation du client enregistrée.' : 'Refus du client enregistré.');
  } catch (e) { if (!e.userMessage) throw e; req.flash('err', e.userMessage); }
  res.redirect(`/admin/demandes/${req.request.id}#devis`);
});

router.post('/demandes/:id/devis/nouvelle-version', auth.requirePerm('quotes.edit'), loadRequest, (req, res) => {
  try {
    quotes.createNewVersion(req.request.id, req.user);
    audit.log(req, 'quote_new_version', 'request', req.request.id);
    req.flash('ok', 'Nouvelle version créée (brouillon). Elle devra être validée avant tout envoi.');
  } catch (e) { if (!e.userMessage) throw e; req.flash('err', e.userMessage); }
  res.redirect(`/admin/demandes/${req.request.id}#devis`);
});

router.post('/demandes/:id/devis/regenerer', auth.requirePerm('quotes.edit'), loadRequest, (req, res) => {
  // Recalcule les lignes du brouillon courant à partir du catalogue actuel.
  const b = quotes.getQuoteBundle(req.request.id);
  if (!b || b.current.state !== 'draft') {
    req.flash('err', 'Seul un brouillon peut être recalculé.');
  } else {
    const PricingCore = require('../../../public/js/pricing-core');
    const est = PricingCore.estimate(require('../../lib/catalog').internalCatalog(), quotes.selectionInput(req.request));
    quotes.saveDraft(b.current.id, { ...b.current, lines: quotes.estimateToLines(est) }, req.user);
    req.flash('ok', 'Lignes recalculées à partir du catalogue actuel (brouillon, non envoyé).');
  }
  res.redirect(`/admin/demandes/${req.request.id}#devis`);
});

router.get('/demandes/:id/devis/:vid(\\d+)/pdf', auth.requirePerm('quotes.view'), loadRequest, wrap(async (req, res) => {
  const v = versionForRequest(req);
  let buf;
  if (v.locked && v.pdf_media_id) {
    const m = db.get().prepare('SELECT * FROM media WHERE id = ?').get(v.pdf_media_id);
    if (m) buf = require('fs').readFileSync(media.filePath(m));
  }
  if (!buf) buf = await quotes.renderPdf(v, { draft: !v.locked });
  const name = `${v.quote_reference}${v.version_no > 1 ? '-v' + v.version_no : ''}${v.locked ? '' : '-BROUILLON'}.pdf`;
  res.set('Content-Disposition', `${req.query.dl ? 'attachment' : 'inline'}; filename="${name}"`).type('application/pdf').send(buf);
}));

// ------------------------------------------------------------ Paiements
router.post('/demandes/:id/paiements', auth.requirePerm('payments.record'), loadRequest, (req, res) => {
  const b = req.body;
  const amount = U.parseMoney(b.amount);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.paid_on || '') ? b.paid_on : null;
  if (!amount || !date || !C.PAYMENT_METHODS[b.method]) {
    req.flash('err', 'Paiement non enregistré : date, montant et mode de paiement sont obligatoires.');
    return res.redirect(`/admin/demandes/${req.request.id}#paiements`);
  }
  let proof = null;
  const file = (req.files || []).find((f) => f.fieldname === 'proof');
  if (file) {
    try { proof = media.store(file, { kind: 'document', access: 'manager', userId: req.user.id }); }
    catch (e) { req.flash('err', e.userMessage || 'Justificatif refusé.'); return res.redirect(`/admin/demandes/${req.request.id}#paiements`); }
  }
  const id = db.get().prepare('INSERT INTO payments (request_id, paid_on, amount_cents, currency, method, reference, proof_media_id, note, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.request.id, date, amount, b.currency === 'CDF' ? 'CDF' : 'USD', b.method, U.str(b.reference, 120) || null, proof, U.str(b.note, 500) || null, req.user.id).lastInsertRowid;
  audit.log(req, 'payment_record', 'payment', Number(id), { amount, currency: b.currency });
  req.flash('ok', 'Paiement enregistré (saisie manuelle).');
  res.redirect(`/admin/demandes/${req.request.id}#paiements`);
});

router.post('/demandes/:id/paiements/:pid/supprimer', auth.requirePerm('payments.delete'), loadRequest, (req, res) => {
  const p = db.get().prepare('SELECT * FROM payments WHERE id = ? AND request_id = ?').get(Number(req.params.pid), req.request.id);
  if (p) {
    db.get().prepare('DELETE FROM payments WHERE id = ?').run(p.id);
    media.remove(p.proof_media_id);
    audit.log(req, 'payment_delete', 'payment', p.id, { amount: p.amount_cents });
    req.flash('ok', 'Paiement supprimé.');
  }
  res.redirect(`/admin/demandes/${req.request.id}#paiements`);
});

module.exports = router;
