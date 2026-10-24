'use strict';
// Génération du PDF de devis (PDFKit, polices standard).
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../db');
const media = require('./media');
const util = require('./util');

// Les polices PDF standard (WinAnsi) n'ont pas l'espace fine insécable : on la remplace.
const plain = (v) => String(v == null ? '' : v).replace(/[\u202f\u00a0]/g, ' ');
const fmtMoney = (c, cur) => plain(util.fmtMoney(c, cur));
const fmtDate = (d, t) => plain(util.fmtDate(d, t));
const { EVENT_TYPES } = require('./constants');

const NAVY = '#0B1F3A';
const GOLD = '#B8962E'; // or légèrement assombri pour la lisibilité à l'impression
const SLATE = '#4A5568';

function logoPath(settings) {
  const id = Number(settings.logo_media_id);
  if (!id) return null;
  const m = db.get().prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!m || !['image/jpeg', 'image/png'].includes(m.mime)) return null;
  const p = media.filePath(m);
  return fs.existsSync(p) ? p : null;
}

function quotePdf({ settings, request, quote, version, draft }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Devis ${quote.reference}`, Author: settings.agency_name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 96;
    const left = 48;

    // En-tête
    doc.rect(0, 0, doc.page.width, 6).fill(GOLD);
    const lp = logoPath(settings);
    let y = 36;
    if (lp) {
      try { doc.image(lp, left, y, { fit: [120, 60] }); } catch { /* logo illisible : ignoré */ }
    } else {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18).text(settings.agency_name, left, y);
    }
    doc.fillColor(GOLD).font('Helvetica-Oblique').fontSize(9).text(settings.slogan || '', left, y + 64, { width: 260 });

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text('DEVIS', left, y, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(SLATE);
    const meta = [
      `Référence : ${quote.reference}${version.version_no > 1 ? ' — version ' + version.version_no : ''}`,
      `Date : ${fmtDate(version.approved_at || version.updated_at)}`,
      `Validité : ${version.validity_days} jours`,
      `Demande : ${request.reference}`,
    ];
    doc.text(meta.join('\n'), left, y + 26, { width: W, align: 'right' });

    y = 128;
    doc.moveTo(left, y).lineTo(left + W, y).lineWidth(0.5).strokeColor('#D9D4C7').stroke();

    // Agence / client
    y += 12;
    const colW = W / 2 - 10;
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text('ÉMETTEUR', left, y);
    doc.text('CLIENT', left + colW + 20, y);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(settings.agency_name, left, y + 12, { width: colW });
    const agencyLines = [settings.city, settings.address, `WhatsApp : ${settings.phone_display}`, settings.public_email].filter(Boolean);
    doc.font('Helvetica').fillColor(SLATE).fontSize(9).text(agencyLines.join('\n'), left, doc.y + 2, { width: colW });
    const yAfterAgency = doc.y;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(request.client_name, left + colW + 20, y + 12, { width: colW });
    doc.font('Helvetica').fillColor(SLATE).fontSize(9)
      .text([request.client_phone, request.client_email].filter(Boolean).join('\n'), left + colW + 20, doc.y + 2, { width: colW });
    y = Math.max(yAfterAgency, doc.y) + 16;

    // Événement
    doc.roundedRect(left, y, W, 58, 4).fill('#F8F5EF');
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text('ÉVÉNEMENT', left + 12, y + 9);
    const evType = request.event_type === 'autre' && request.event_type_other ? request.event_type_other : (EVENT_TYPES[request.event_type] || request.event_type);
    const evParts = [
      evType,
      request.event_date ? fmtDate(request.event_date) : 'Date à confirmer',
      request.start_time ? `à ${request.start_time}` : null,
      request.duration_hours ? `durée estimée ${request.duration_hours} h` : null,
    ].filter(Boolean).join(' · ');
    const evParts2 = [
      request.guests ? `${request.guests} invités (approx.)` : null,
      request.location_area ? `Lieu : ${request.location_area}` : null,
      request.protocol_agents ? `${request.protocol_agents} agent(s) de protocole` : null,
    ].filter(Boolean).join(' · ');
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text(evParts, left + 12, y + 21, { width: W - 24 });
    doc.font('Helvetica').fillColor(SLATE).fontSize(9).text(evParts2 || ' ', left + 12, y + 37, { width: W - 24 });
    y += 72;

    // Tableau des prestations
    const cols = [
      { k: 'label', t: 'Prestation', w: W * 0.46, a: 'left' },
      { k: 'qty', t: 'Qté', w: W * 0.09, a: 'right' },
      { k: 'unit', t: 'Unité', w: W * 0.15, a: 'left' },
      { k: 'pu', t: 'Prix unit.', w: W * 0.14, a: 'right' },
      { k: 'amount', t: 'Montant', w: W * 0.16, a: 'right' },
    ];
    function header() {
      doc.rect(left, y, W, 20).fill(NAVY);
      let x = left;
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
      for (const c of cols) { doc.text(c.t, x + 6, y + 6, { width: c.w - 12, align: c.a }); x += c.w; }
      y += 20;
    }
    header();

    const lines = JSON.parse(version.lines || '[]');
    lines.forEach((l, i) => {
      const desc = l.description ? String(l.description) : '';
      doc.font('Helvetica-Bold').fontSize(9);
      const hLabel = doc.heightOfString(l.label, { width: cols[0].w - 12 });
      doc.font('Helvetica').fontSize(7.5);
      const hDesc = desc ? doc.heightOfString(desc, { width: cols[0].w - 12 }) : 0;
      const h = Math.max(20, hLabel + hDesc + 10);
      if (y + h > doc.page.height - 120) { doc.addPage(); y = 48; header(); }
      if (i % 2 === 1) doc.rect(left, y, W, h).fill('#FBFAF6');
      let x = left;
      const isDiscount = l.kind === 'discount';
      const amount = l.amount_cents == null ? 'À confirmer' : (isDiscount ? '− ' : '') + fmtMoney(l.amount_cents);
      const pu = l.unit_price_cents == null ? '—' : fmtMoney(l.unit_price_cents);
      const vals = { label: l.label, qty: String(l.qty ?? ''), unit: l.unit || '', pu, amount };
      for (const c of cols) {
        if (c.k === 'label') {
          doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(l.label, x + 6, y + 5, { width: c.w - 12 });
          if (desc) doc.fillColor(SLATE).font('Helvetica').fontSize(7.5).text(desc, x + 6, doc.y + 1, { width: c.w - 12 });
        } else {
          doc.fillColor(c.k === 'amount' && l.amount_cents == null ? GOLD : NAVY).font('Helvetica').fontSize(9)
            .text(vals[c.k], x + 6, y + 5, { width: c.w - 12, align: c.a });
        }
        x += c.w;
      }
      y += h;
      doc.moveTo(left, y).lineTo(left + W, y).lineWidth(0.3).strokeColor('#E5E0D3').stroke();
    });

    // Totaux
    if (y > doc.page.height - 220) { doc.addPage(); y = 48; }
    y += 10;
    const tx = left + W * 0.55;
    const tw = W * 0.45;
    function totalRow(label, value, bold) {
      doc.fillColor(bold ? NAVY : SLATE).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5);
      doc.text(label, tx, y, { width: tw * 0.55 });
      const below = doc.y;
      doc.text(value, tx + tw * 0.55, y, { width: tw * 0.45, align: 'right' });
      y = Math.max(y + (bold ? 20 : 15), below + 6);
    }
    totalRow('Sous-total prestations', fmtMoney(version.subtotal_cents));
    if (version.fees_cents) totalRow('Frais', fmtMoney(version.fees_cents));
    if (version.discount_cents) totalRow('Remises', '− ' + fmtMoney(version.discount_cents));
    doc.moveTo(tx, y).lineTo(tx + tw, y).lineWidth(1).strokeColor(GOLD).stroke();
    y += 6;
    totalRow(version.has_unconfirmed ? 'TOTAL (hors éléments à confirmer)' : 'TOTAL', fmtMoney(version.total_cents) + ' ' + (version.currency || 'USD'), true);

    // Textes
    y += 8;
    function block(title, text) {
      if (!text) return;
      if (y > doc.page.height - 110) { doc.addPage(); y = 48; }
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), left, y);
      doc.fillColor(SLATE).font('Helvetica').fontSize(8.5).text(text, left, doc.y + 3, { width: W });
      y = doc.y + 10;
    }
    if (version.has_unconfirmed) block('Éléments à confirmer', 'Les lignes marquées « À confirmer » dépendent de la disponibilité ou des conditions des prestataires. Leur montant vous sera communiqué avant toute confirmation.');
    block('Message', version.client_message);
    block('Conditions particulières', version.conditions);
    block('Conditions de paiement', version.payment_terms);
    block('Validité', `Ce devis est valable ${version.validity_days} jours à compter de sa date d’émission.`);
    block('Mentions', settings.quote_legal_mentions);

    if (draft) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
          .fillColor('#C53030').opacity(0.12).font('Helvetica-Bold').fontSize(64)
          .text('BROUILLON — NON VALIDÉ', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' })
          .restore();
      }
    }

    doc.end();
  });
}

module.exports = { quotePdf };
