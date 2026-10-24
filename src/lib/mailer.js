'use strict';
// Envoi d'e-mails via SMTP (optionnel). Si SMTP n'est pas configuré, aucune
// fonction ne prétend avoir envoyé un message : isConfigured() renvoie false
// et l'interface propose l'envoi manuel (PDF + WhatsApp).
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
let testTransport = null; // utilisé par les tests automatisés uniquement

function isConfigured() {
  return !!testTransport || !!(config.smtp.host && config.smtp.from);
}

function getTransport() {
  if (testTransport) return testTransport;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

// Renvoie l'objet info de nodemailer ; lève une erreur si le serveur refuse.
async function send({ to, subject, text, attachments }) {
  if (!isConfigured()) throw new Error('SMTP non configuré');
  return getTransport().sendMail({ from: config.smtp.from || 'test@example.org', to, subject, text, attachments });
}

function setTestTransport(t) { testTransport = t; }

module.exports = { isConfigured, send, setTestTransport };
