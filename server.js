'use strict';
const config = require('./src/config');
const { createApp } = require('./src/app');
const quotes = require('./src/lib/quotes');
const { bootstrapOwner } = require('./src/lib/bootstrap');

const app = createApp();
bootstrapOwner(process.env);

// Premier démarrage sans compte : lien d'installation à usage unique.
const setupLink = require('./src/lib/setup').prepare();
if (setupLink) {
  console.log('\n=== Aucun compte administrateur ===');
  console.log('Lien à usage unique pour créer le compte propriétaire :');
  console.log(setupLink);
  console.log('Ce lien est désactivé dès que le compte est créé.\n');
}
app.listen(config.port, () => {
  console.log(`PRESTIGIO EVENTS — serveur démarré sur ${config.baseUrl} (port ${config.port})`);
});

// Maintenance périodique : expiration des devis dont la validité est dépassée.
setInterval(() => {
  try { quotes.expireOldQuotes(); } catch (e) { console.error(e); }
}, 60 * 60 * 1000).unref();
