'use strict';
// Workflow des demandes et devis.
//
// Règles garanties ici (et vérifiées par les tests) :
//  1. Chaque demande génère automatiquement un devis provisoire (version 1,
//     état « draft ») qui n'est JAMAIS transmis au client.
//  2. Seule l'action explicite « Valider et envoyer » (rôle propriétaire)
//     verrouille une version (approved) ; elle ne passe à « sent » qu'après
//     confirmation réelle de l'envoi (SMTP accepté) ou déclaration manuelle.
//  3. Une version verrouillée n'est plus jamais modifiée : toute correction
//     crée une nouvelle version, à revalider.
//  4. Les lignes sont figées (copie JSON) : modifier le catalogue ne change
//     pas les devis existants.
const db = require('../db');
const PricingCore = require('../../public/js/pricing-core');
const catalog = require('./catalog');
const settingsLib = require('./settings');
const media = require('./media');
const mailer = require('./mailer');
const { quotePdf } = require('./pdf');
const { randomCode, fmtMoney } = require('./util');

function newRequestReference() {
  const d = new Date();
  const prefix = `PE-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-`;
  for (;;) {
    const ref = prefix + randomCode(5);
    if (!db.get().prepare('SELECT 1 FROM requests WHERE reference = ?').get(ref)) return ref;
  }
}

function newQuoteReference() {
  const year = new Date().getFullYear();
  const row = db.get().prepare("SELECT reference FROM quotes WHERE reference LIKE ? ORDER BY id DESC LIMIT 1").get(`DV-${year}-%`);
  const next = row ? Number(row.reference.split('-')[2]) + 1 : 1;
  return `DV-${year}-${String(next).padStart(4, '0')}`;
}

function addHistory(requestId, status, userId, comment) {
  db.get().prepare('INSERT INTO request_history (request_id, user_id, status, comment) VALUES (?,?,?,?)')
    .run(requestId, userId || null, status, comment || null);
}

function setStatus(requestId, status, userId, comment) {
  db.get().prepare("UPDATE requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, requestId);
  addHistory(requestId, status, userId, comment);
}

// Convertit le résultat du moteur de calcul en lignes de devis figées.
function estimateToLines(est) {
  const conv = (kind) => (l) => ({
    kind,
    label: l.service && kind === 'service' && l.label !== l.service ? `${l.service} — ${l.label}` : l.label,
    description: [l.basis, l.reason].filter(Boolean).join(' · '),
    qty: l.qty,
    unit: l.unit,
    unit_price_cents: l.unit_price_cents,
    amount_cents: l.amount_cents,
    to_confirm: !!l.to_confirm,
    provisional: !!l.provisional,
    tariff_id: l.tariff_id,
  });
  return [...est.lines.map(conv('service')), ...est.fees.map(conv('fee')), ...est.discounts.map(conv('discount'))];
}

function totals(lines) {
  let subtotal = 0; let fees = 0; let discount = 0; let unconfirmed = false;
  for (const l of lines) {
    if (l.to_confirm || l.amount_cents == null) unconfirmed = true;
    if (l.amount_cents == null) continue;
    if (l.kind === 'fee') fees += l.amount_cents;
    else if (l.kind === 'discount') discount += l.amount_cents;
    else subtotal += l.amount_cents;
  }
  discount = Math.min(discount, subtotal + fees);
  return { subtotal_cents: subtotal, fees_cents: fees, discount_cents: discount, total_cents: subtotal + fees - discount, has_unconfirmed: unconfirmed ? 1 : 0 };
}

function selectionInput(request) {
  const sel = JSON.parse(request.selections || '{}');
  return {
    services: sel.services || [],
    options: sel.options || [],
    guests: request.guests,
    hours: request.duration_hours,
    agents: request.protocol_unknown ? 'unknown' : request.protocol_agents,
  };
}

// Crée le devis provisoire (version 1) d'une demande. Ne transmet rien au client.
function generateDraft(requestId) {
  const request = db.get().prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  const est = PricingCore.estimate(catalog.internalCatalog(), selectionInput(request));
  const lines = estimateToLines(est);
  const t = totals(lines);
  const s = settingsLib.all();
  const quoteId = db.get().prepare('INSERT INTO quotes (request_id, reference) VALUES (?, ?)').run(requestId, newQuoteReference()).lastInsertRowid;
  const flags = [];
  if (lines.some((l) => l.provisional)) flags.push('Contient des tarifs marqués provisoires — à vérifier.');
  if (lines.some((l) => l.to_confirm)) flags.push('Contient des éléments « À confirmer » (prix, disponibilité ou informations manquantes).');
  if (!lines.length) flags.push('Aucune prestation sélectionnée : devis à compléter.');
  db.get().prepare(`INSERT INTO quote_versions (quote_id, version_no, state, auto_generated, lines, subtotal_cents, fees_cents, discount_cents, total_cents,
      has_unconfirmed, payment_terms, validity_days, internal_comment)
    VALUES (?, 1, 'draft', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(quoteId, JSON.stringify(lines), t.subtotal_cents, t.fees_cents, t.discount_cents, t.total_cents, t.has_unconfirmed,
      s.quote_payment_terms || '', Number(s.quote_validity_days) || 30, flags.join('\n') || null);
  setStatus(requestId, 'draft_generated', null, 'Devis provisoire généré automatiquement à partir du catalogue.');
  setStatus(requestId, 'pending_validation', null, 'En attente de validation par PRESTIGIO EVENTS.');
  return quoteId;
}

function getQuoteBundle(requestId) {
  const quote = db.get().prepare('SELECT * FROM quotes WHERE request_id = ?').get(requestId);
  if (!quote) return null;
  const versions = db.get().prepare('SELECT * FROM quote_versions WHERE quote_id = ? ORDER BY version_no DESC').all(quote.id);
  return { quote, versions, current: versions[0] };
}

function getVersion(versionId) {
  return db.get().prepare(`SELECT v.*, q.reference AS quote_reference, q.request_id FROM quote_versions v
    JOIN quotes q ON q.id = v.quote_id WHERE v.id = ?`).get(versionId);
}

function isLatest(version) {
  const r = db.get().prepare('SELECT MAX(version_no) AS m FROM quote_versions WHERE quote_id = ?').get(version.quote_id);
  return r.m === version.version_no;
}

// Enregistre les modifications d'un brouillon (jamais d'une version verrouillée).
function saveDraft(versionId, data, user) {
  const v = getVersion(versionId);
  if (!v) throw userError('Version introuvable.');
  if (v.locked || v.state !== 'draft') throw userError('Cette version est verrouillée : créez une nouvelle version pour la corriger.');
  if (!isLatest(v)) throw userError('Seule la dernière version peut être modifiée.');
  const t = totals(data.lines);
  db.get().prepare(`UPDATE quote_versions SET lines = ?, subtotal_cents = ?, fees_cents = ?, discount_cents = ?, total_cents = ?, has_unconfirmed = ?,
      payment_terms = ?, validity_days = ?, client_message = ?, conditions = ?, internal_comment = ?, updated_at = datetime('now')
    WHERE id = ? AND locked = 0`)
    .run(JSON.stringify(data.lines), t.subtotal_cents, t.fees_cents, t.discount_cents, t.total_cents, t.has_unconfirmed,
      data.payment_terms, data.validity_days, data.client_message, data.conditions, data.internal_comment, versionId);
  const req = db.get().prepare('SELECT status FROM requests WHERE id = ?').get(v.request_id);
  if (['new', 'draft_generated', 'pending_validation'].includes(req.status)) {
    setStatus(v.request_id, 'editing', user.id, `Version ${v.version_no} modifiée (brouillon enregistré sans envoi).`);
  }
  return getVersion(versionId);
}

// Nouvelle version à partir de la dernière (après envoi, refus ou expiration).
function createNewVersion(requestId, user) {
  const b = getQuoteBundle(requestId);
  if (!b) throw userError('Aucun devis pour cette demande.');
  if (b.current.state === 'draft') return b.current.id;
  const c = b.current;
  const id = db.get().prepare(`INSERT INTO quote_versions (quote_id, version_no, state, lines, subtotal_cents, fees_cents, discount_cents, total_cents,
      has_unconfirmed, currency, payment_terms, validity_days, client_message, conditions, internal_comment, created_by)
    VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.quote_id, c.version_no + 1, c.lines, c.subtotal_cents, c.fees_cents, c.discount_cents, c.total_cents, c.has_unconfirmed,
      c.currency, c.payment_terms, c.validity_days, c.client_message, c.conditions, null, user.id).lastInsertRowid;
  setStatus(requestId, 'editing', user.id, `Version ${c.version_no + 1} créée à partir de la version ${c.version_no} — nouvelle validation requise.`);
  return Number(id);
}

async function renderPdf(version, { draft }) {
  const request = db.get().prepare('SELECT * FROM requests WHERE id = ?').get(version.request_id);
  const quote = db.get().prepare('SELECT * FROM quotes WHERE id = ?').get(version.quote_id);
  return quotePdf({ settings: settingsLib.all(), request, quote, version, draft });
}

// Valide (verrouille) la version puis tente l'envoi par e-mail si possible.
// Renvoie { approved: true, sent: bool, reason }.
async function approveAndSend(versionId, user) {
  const v = getVersion(versionId);
  if (!v) throw userError('Version introuvable.');
  if (v.state !== 'draft' || v.locked) throw userError('Cette version a déjà été validée.');
  if (!isLatest(v)) throw userError('Seule la dernière version peut être validée.');
  const lines = JSON.parse(v.lines || '[]');
  if (!lines.length) throw userError('Le devis ne contient aucune ligne.');

  // 1. Verrouillage de la version approuvée + PDF définitif
  db.get().prepare(`UPDATE quote_versions SET state = 'approved', locked = 1, approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND locked = 0`).run(user.id, versionId);
  const approved = getVersion(versionId);
  const pdf = await renderPdf(approved, { draft: false });
  const pdfId = media.storeBuffer(pdf, { mime: 'application/pdf', ext: '.pdf', access: 'manager', name: `${approved.quote_reference}-v${approved.version_no}.pdf`, userId: user.id });
  db.get().prepare('UPDATE quote_versions SET pdf_media_id = ? WHERE id = ?').run(pdfId, versionId);
  setStatus(v.request_id, 'approved', user.id, `Version ${v.version_no} validée par le directeur (${fmtMoney(approved.total_cents)}).`);

  // 2. Envoi effectif (si e-mail configuré et adresse client connue)
  const r = await sendByEmail(versionId, user, pdf);
  return { approved: true, ...r };
}

// Envoie par e-mail une version validée. Ne la marque « envoyée » que si le
// serveur SMTP a accepté le message.
async function sendByEmail(versionId, user, pdfBuffer) {
  const v = getVersion(versionId);
  if (!v || v.state !== 'approved') throw userError('Seule une version validée et non envoyée peut être envoyée.');
  const request = db.get().prepare('SELECT * FROM requests WHERE id = ?').get(v.request_id);
  if (!mailer.isConfigured()) return { sent: false, reason: 'L’envoi par e-mail n’est pas configuré. Téléchargez le PDF, transmettez-le (par exemple via WhatsApp) puis enregistrez l’envoi manuel.' };
  if (!request.client_email) return { sent: false, reason: 'Le client n’a pas indiqué d’adresse e-mail. Transmettez le PDF manuellement puis enregistrez l’envoi.' };
  const pdf = pdfBuffer || await renderPdf(v, { draft: false });
  const s = settingsLib.all();
  try {
    await mailer.send({
      to: request.client_email,
      subject: `Votre devis ${v.quote_reference} — ${s.agency_name}`,
      text: [
        `Bonjour ${request.client_name},`, '',
        `Veuillez trouver ci-joint notre devis ${v.quote_reference} pour votre événement (demande ${request.reference}).`,
        v.client_message ? `\n${v.client_message}\n` : '',
        `Montant total : ${fmtMoney(v.total_cents)}${v.has_unconfirmed ? ' (hors éléments à confirmer)' : ''}.`,
        `Ce devis est valable ${v.validity_days} jours. La réservation n’est confirmée qu’après acceptation du devis et réception de l’acompte.`, '',
        `Pour toute question : WhatsApp ${s.phone_display}.`, '', `${s.agency_name}`, s.slogan,
      ].join('\n'),
      attachments: [{ filename: `${v.quote_reference}.pdf`, content: pdf }],
    });
  } catch (e) {
    console.error('Échec envoi devis', e.message);
    return { sent: false, reason: 'L’envoi par e-mail a échoué (' + String(e.message).slice(0, 120) + '). Le devis reste validé mais NON envoyé.' };
  }
  markSent(versionId, user, 'email', null, null);
  return { sent: true };
}

function markSent(versionId, user, channel, sentAt, note) {
  const v = getVersion(versionId);
  if (!v || v.state !== 'approved') throw userError('Seule une version validée et non encore envoyée peut être marquée comme envoyée.');
  db.tx(() => {
    db.get().prepare(`UPDATE quote_versions SET state = 'superseded' WHERE quote_id = ? AND state = 'sent' AND id <> ?`).run(v.quote_id, versionId);
    db.get().prepare(`UPDATE quote_versions SET state = 'sent', sent_at = COALESCE(?, datetime('now')), sent_channel = ?, sent_by = ?, sent_note = ? WHERE id = ?`)
      .run(sentAt || null, channel, user.id, note || null, versionId);
    const labels = { email: 'par e-mail (accepté par le serveur SMTP)', whatsapp_manual: 'manuellement via WhatsApp', other_manual: 'manuellement' };
    setStatus(v.request_id, 'sent', user.id, `Version ${v.version_no} envoyée ${labels[channel] || channel}.`);
  });
}

function recordResponse(versionId, user, accepted, date, note) {
  const v = getVersion(versionId);
  if (!v || v.state !== 'sent') throw userError('La réponse du client ne peut être enregistrée que sur un devis envoyé.');
  if (accepted && !note) throw userError('Précisez comment le client a confirmé son acceptation (message, signature, appel…).');
  db.get().prepare('UPDATE quote_versions SET accepted_at = ?, acceptance_note = ? WHERE id = ?')
    .run(accepted ? (date || new Date().toISOString().slice(0, 10)) : null, note || null, versionId);
  setStatus(v.request_id, accepted ? 'accepted' : 'refused', user.id,
    `${accepted ? 'Acceptation' : 'Refus'} du client enregistré(e)${date ? ' le ' + date : ''}${note ? ' : ' + note : ''}.`);
}

// Passe en « expiré » les devis envoyés dont la validité est dépassée.
function expireOldQuotes() {
  const rows = db.get().prepare(`SELECT r.id, v.version_no FROM requests r JOIN quotes q ON q.request_id = r.id
    JOIN quote_versions v ON v.quote_id = q.id AND v.state = 'sent'
    WHERE r.status = 'sent' AND date(v.sent_at, '+' || v.validity_days || ' days') < date('now')`).all();
  for (const r of rows) setStatus(r.id, 'expired', null, `Validité du devis (version ${r.version_no}) dépassée.`);
  return rows.length;
}

function userError(msg) {
  const e = new Error(msg);
  e.userMessage = msg;
  return e;
}

module.exports = {
  newRequestReference, generateDraft, getQuoteBundle, getVersion, saveDraft, createNewVersion, approveAndSend, markSent,
  recordResponse, expireOldQuotes, sendByEmail, renderPdf, setStatus, addHistory, totals, estimateToLines, selectionInput, userError,
};
