'use strict';
// Configuration lue depuis les variables d'environnement (voir .env.example).
// Aucun secret n'est codé en dur : en production, SESSION_SECRET est obligatoire.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv();

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const storageDir = path.resolve(env.STORAGE_DIR || path.join(__dirname, '..', 'storage'));
fs.mkdirSync(path.join(storageDir, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(storageDir, 'tmp'), { recursive: true });
fs.mkdirSync(path.join(storageDir, 'backups'), { recursive: true });

function sessionSecret() {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (isProd) throw new Error('SESSION_SECRET doit être défini en production.');
  // Développement : secret aléatoire persistant, stocké hors du dossier public.
  const f = path.join(storageDir, '.dev-session-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

module.exports = {
  isProd,
  port: Number(env.PORT || 3000),
  // RENDER_EXTERNAL_URL est fourni automatiquement par l'hébergeur Render.
  baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  storageDir,
  dbFile: env.DB_FILE ? path.resolve(env.DB_FILE) : path.join(storageDir, 'prestigio.db'),
  uploadsDir: path.join(storageDir, 'uploads'),
  tmpDir: path.join(storageDir, 'tmp'),
  backupsDir: path.join(storageDir, 'backups'),
  sessionSecret: sessionSecret(),
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) || env.TRUST_PROXY : 0,
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || '',
  },
  adminNotifyEmail: env.ADMIN_NOTIFY_EMAIL || '',
  publicFormLimit: Number(env.PUBLIC_FORM_LIMIT || 10), // envois par IP / 15 min
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 25),
};
