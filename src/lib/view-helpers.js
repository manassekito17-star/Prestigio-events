'use strict';
const util = require('./util');
const C = require('./constants');
const settingsLib = require('./settings');
const D = require('./discovery');

const locales = { fr: require('../i18n/fr') };

function t(key) {
  const lang = settingsLib.get('locale') || 'fr';
  return (locales[lang] && locales[lang][key]) || locales.fr[key] || key;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Texte multiligne → paragraphes HTML échappés
function paras(s) {
  return String(s || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function nl2br(s) {
  return esc(s).replace(/\n/g, '<br>');
}

// JSON sûr pour <script type="application/json">
function jsonScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function mediaUrl(id) {
  return id ? `/media/${Number(id)}` : null;
}

function videoEmbed(url) {
  if (!url) return null;
  let m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = url.match(/vimeo\.com\/(\d{5,12})/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
}

function packagePrice(p) {
  if (p.price_type === 'on_request' || p.amount_cents == null || p.provisional) return 'Tarif sur demande';
  const a = util.fmtMoney(p.amount_cents);
  if (p.price_type === 'from') return `À partir de ${a}`;
  if (p.price_type === 'per_person') return `${a} par personne`;
  return a;
}

// Affichage public d'un tarif (catalogue public uniquement)
function tariffPrice(t) {
  if (t.to_confirm || t.amount_cents == null) return 'Sur devis';
  const a = util.fmtMoney(t.amount_cents);
  switch (t.method) {
    case 'per_person': return `${a} / invité`;
    case 'per_agent': return `${a} / agent / ${{ event: 'événement', hour: 'heure', day: 'jour' }[t.agent_unit || 'event']}` + (t.included_hours ? ` (${t.included_hours} h incluses)` : '');
    case 'per_hour': return `${a} / heure`;
    case 'per_day': return `${a} / jour`;
    case 'rental': return `${a} (location)`;
    default: return a;
  }
}

function statusLabel(st) {
  return (C.STATUSES[st] || { label: st }).label;
}
function statusTone(st) {
  return (C.STATUSES[st] || { tone: 'muted' }).tone;
}

module.exports = {
  ...util, C, D, t, esc, paras, nl2br, jsonScript, mediaUrl, videoEmbed, packagePrice, tariffPrice, statusLabel, statusTone,
  eventType: (k, other) => (k === 'autre' && other ? other : C.EVENT_TYPES[k] || k || '—'),
};
