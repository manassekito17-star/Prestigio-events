'use strict';
// Environnement de test isolé : base et fichiers dans un dossier temporaire.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prestigio-test-'));
process.env.STORAGE_DIR = dir;
process.env.SESSION_SECRET = 'test-secret-' + Math.random();
process.env.NODE_ENV = 'test';
process.env.PUBLIC_FORM_LIMIT = '1000';

const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db');
const auth = require('../src/lib/auth');
const formguard = require('../src/lib/formguard');
const mailer = require('../src/lib/mailer');

const app = createApp();

function createUser(email, role, name = role) {
  return Number(db.get().prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)')
    .run(email, name, auth.hashPassword('Password12345'), role).lastInsertRowid);
}

function csrfFrom(html) {
  const m = /name="_csrf" value="([^"]+)"/.exec(html);
  return m && m[1];
}

async function login(email) {
  const agent = request.agent(app);
  const page = await agent.get('/admin/connexion');
  const res = await agent.post('/admin/connexion').type('form').send({ _csrf: csrfFrom(page.text), email, password: 'Password12345', next: '/admin' });
  if (res.status !== 302 || res.headers.location !== '/admin') throw new Error('login failed for ' + email + ' ' + res.status);
  const dash = await agent.get('/admin/compte');
  agent.csrf = csrfFrom(dash.text);
  return agent;
}

// Formulaire de devis valide (jeton antidaté pour passer le délai anti-robot)
function quoteForm(extra = {}) {
  const svc = (slug) => db.get().prepare('SELECT id FROM services WHERE slug = ?').get(slug).id;
  return {
    _ft: formguard.issue('quote', 10),
    website: '',
    event_type: 'mariage',
    event_date: '2099-06-12',
    start_time: '14:00',
    duration_hours: '8',
    guests: '200',
    location_area: 'Gombe',
    venue_booked: 'oui',
    services: [String(svc('decoration')), String(svc('protocole-accueil'))],
    protocol_agents_n: '6',
    protocol_tasks: ['accueil', 'vip'],
    budget_mode: 'unknown',
    client_name: 'Client Test',
    client_phone: '+243 812 000 000',
    client_email: 'client@example.org',
    consent: 'oui',
    ...extra,
  };
}

async function submitQuote(extra) {
  const res = await request(app).post('/devis').type('form').send(quoteForm(extra));
  const m = /Référence : <strong>([A-Z0-9-]+)<\/strong>/.exec(res.text);
  return { res, reference: m && m[1] };
}

// Capture des e-mails (aucun envoi réel)
const sentMails = [];
function enableTestMail() {
  mailer.setTestTransport({ sendMail: async (msg) => { sentMails.push(msg); return { messageId: 'test' }; } });
}
function disableMail() { mailer.setTestTransport(null); }

module.exports = { app, db, request, createUser, login, csrfFrom, quoteForm, submitQuote, sentMails, enableTestMail, disableMail, formguard, dir };
