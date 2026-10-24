'use strict';
// Gestion des fichiers téléversés. Les fichiers sont stockés hors du dossier
// public sous un nom aléatoire et ne sont servis que par /media/:id, qui
// vérifie le niveau d'accès (public, staff, manager, owner).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const db = require('../db');

const KINDS = {
  image: { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' },
  video: { 'video/mp4': '.mp4', 'video/webm': '.webm' },
  document: { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' },
};

// Détection du type réel par signature (on ne se fie pas à l'extension).
function sniff(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(16);
  fs.readSync(fd, b, 0, 16, 0);
  fs.closeSync(fd);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (b.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (b.slice(4, 8).toString() === 'ftyp') return 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  return null;
}

const upload = multer({
  dest: config.tmpDir,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10, fields: 300 },
});

function cleanup(files) {
  for (const f of files || []) fs.promises.unlink(f.path).catch(() => {});
}

// Enregistre un fichier téléversé. kind : image | video | document | image_or_video
function store(file, { kind = 'image', access = 'owner', userId = null, alt = null } = {}) {
  if (!file) return null;
  const mime = sniff(file.path);
  const allowed = kind === 'image_or_video' ? { ...KINDS.image, ...KINDS.video } : KINDS[kind];
  if (!mime || !allowed[mime]) {
    fs.promises.unlink(file.path).catch(() => {});
    const err = new Error('Type de fichier non autorisé.');
    err.userMessage = 'Type de fichier non autorisé. Formats acceptés : ' + Object.values(allowed).join(', ');
    throw err;
  }
  const stored = crypto.randomBytes(16).toString('hex') + allowed[mime];
  fs.renameSync(file.path, path.join(config.uploadsDir, stored));
  const info = db.get().prepare('INSERT INTO media (stored_name, original_name, mime, size, access, alt_text, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(stored, String(file.originalname || '').slice(0, 200), mime, file.size, access, alt, userId);
  return Number(info.lastInsertRowid);
}

function storeBuffer(buf, { mime, ext, access = 'owner', name, userId = null }) {
  const stored = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(config.uploadsDir, stored), buf);
  const info = db.get().prepare('INSERT INTO media (stored_name, original_name, mime, size, access, created_by) VALUES (?,?,?,?,?,?)')
    .run(stored, name, mime, buf.length, access, userId);
  return Number(info.lastInsertRowid);
}

function setAccess(id, access) {
  if (id) db.get().prepare('UPDATE media SET access = ? WHERE id = ?').run(access, id);
}

function setAlt(id, alt) {
  if (id) db.get().prepare('UPDATE media SET alt_text = ? WHERE id = ?').run(alt || null, id);
}

function remove(id) {
  if (!id) return;
  const m = db.get().prepare('SELECT stored_name FROM media WHERE id = ?').get(id);
  if (!m) return;
  db.get().prepare('DELETE FROM media WHERE id = ?').run(id);
  fs.promises.unlink(path.join(config.uploadsDir, m.stored_name)).catch(() => {});
}

function filePath(m) {
  return path.join(config.uploadsDir, m.stored_name);
}

function url(id) {
  return id ? `/media/${id}` : null;
}

module.exports = { upload, store, storeBuffer, setAccess, setAlt, remove, filePath, url, cleanup, sniff };
