'use strict';
const crypto = require('crypto');

function parseMoney(v) {
  // « 1 250,50 » ou « 1250.5 » → centimes ; vide → null
  if (v == null) return null;
  const s = String(v).replace(/[\s $]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100);
}

function centsToInput(c) {
  return c == null ? '' : (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
}

function fmtMoney(cents, currency = 'USD') {
  if (cents == null) return 'À confirmer';
  const v = cents / 100;
  const s = v.toLocaleString('fr-FR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return currency === 'USD' ? `${s} $` : `${s} ${currency}`;
}

function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(d) ? d.replace(' ', 'T') + 'Z' : d;
  const date = new Date(iso);
  if (isNaN(date)) return d;
  const opts = { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleString('fr-FR', opts);
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return s;
}

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'element';
}

function str(v, max = 2000) {
  if (v == null) return '';
  return String(v).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function lines(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

function bool(v) {
  return v === '1' || v === 'on' || v === true || v === 'true' || v === 1 ? 1 : 0;
}

function intOrNull(v, min = 0, max = 1_000_000) {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

function isEmail(v) {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(v);
}

function normalizePhone(v) {
  const s = String(v || '').replace(/[^\d+]/g, '');
  return s;
}

function isPhone(v) {
  const d = normalizePhone(v).replace(/^\+/, '');
  return d.length >= 8 && d.length <= 15;
}

function waLink(number, text) {
  const n = normalizePhone(number).replace(/^\+/, '').replace(/^0/, '243');
  return `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

function isHexColor(v) {
  return /^#[0-9a-f]{6}$/i.test(v);
}

function safeUrl(v) {
  const s = str(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch { return ''; }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  parseMoney, centsToInput, fmtMoney, fmtDate, randomCode, slugify, str, lines, bool, intOrNull,
  isEmail, isPhone, normalizePhone, waLink, isHexColor, safeUrl, today,
};
