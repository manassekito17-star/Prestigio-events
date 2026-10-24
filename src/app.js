'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const config = require('./config');
const db = require('./db');
const auth = require('./lib/auth');
const settingsLib = require('./lib/settings');
const helpers = require('./lib/view-helpers');
const media = require('./lib/media');

function createApp() {
  db.get();
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'style-src-attr': ["'unsafe-inline'"], // attributs style uniquement (aucun script)
        'img-src': ["'self'", 'data:'],
        'media-src': ["'self'"],
        'font-src': ["'self'"],
        'frame-src': ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.google.com'],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd,
  }));

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/favicon.svg'));

  app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 2000 }));
  app.use(express.json({ limit: '100kb' }));

  app.use(session({
    name: config.isProd ? '__Host-prestigio' : 'prestigio.sid',
    secret: config.sessionSecret,
    store: new auth.SqliteStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 8 * 3600e3, path: '/' },
  }));
  app.use(auth.loadUser);

  // Variables communes aux vues
  app.use((req, res, next) => {
    res.locals.s = settingsLib.all();
    res.locals.h = helpers;
    res.locals.path = req.path;
    res.locals.baseUrl = config.baseUrl;
    res.locals.flash = req.session && req.session.flash ? req.session.flash : null;
    if (req.session && req.session.flash) delete req.session.flash;
    req.flash = (type, msg) => { req.session.flash = { type, msg }; };
    next();
  });

  // Couleurs personnalisables (CSS généré à partir des paramètres validés)
  app.get('/theme.css', (req, res) => {
    const s = res.locals.s;
    const ok = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
    res.type('text/css').set('Cache-Control', 'no-cache')
      .send(`:root{--navy:${ok(s.color_primary, '#0B1F3A')};--gold:${ok(s.color_accent, '#D4AF37')};}`);
  });

  // Fichiers : contrôle d'accès à chaque requête
  app.get('/media/:id', (req, res) => {
    const id = Number(req.params.id);
    const m = Number.isInteger(id) ? db.get().prepare('SELECT * FROM media WHERE id = ?').get(id) : null;
    const u = req.user;
    const allowed = m && (
      m.access === 'public' ||
      (m.access === 'staff' && u) ||
      (m.access === 'manager' && u && (u.role === 'owner' || u.role === 'ops')) ||
      (m.access === 'owner' && u && u.role === 'owner'));
    if (!allowed) return res.status(404).send('Fichier introuvable.');
    const file = media.filePath(m);
    if (!fs.existsSync(file)) return res.status(404).send('Fichier introuvable.');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', m.access === 'public' ? 'public, max-age=86400' : 'private, no-store');
    const inline = m.mime.startsWith('image/') || m.mime.startsWith('video/') || req.query.inline === '1';
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(m.original_name || 'fichier')}"`);
    res.type(m.mime).sendFile(file);
  });

  app.use('/', require('./routes/public'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith('/admin')) return res.render('admin/error', { title: 'Page introuvable', message: 'Cette page n’existe pas.' });
    res.render('public/error', { title: 'Page introuvable', message: 'La page demandée n’existe pas ou a été déplacée.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') err.userMessage = `Fichier trop volumineux (maximum ${config.maxUploadMb} Mo).`;
    if (!err.userMessage) console.error(err);
    res.status(err.userMessage ? 400 : 500);
    const message = err.userMessage || 'Une erreur inattendue s’est produite. Veuillez réessayer.';
    if (req.path.startsWith('/admin')) return res.render('admin/error', { title: 'Erreur', message });
    res.render('public/error', { title: 'Erreur', message });
  });

  return app;
}

module.exports = { createApp };
