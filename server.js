'use strict';
const config = require('./src/config');
const { createApp } = require('./src/app');
const quotes = require('./src/lib/quotes');

const app = createApp();
app.listen(config.port, () => {
  console.log(`PRESTIGIO EVENTS — serveur démarré sur ${config.baseUrl} (port ${config.port})`);
});

// Maintenance périodique : expiration des devis dont la validité est dépassée.
setInterval(() => {
  try { quotes.expireOldQuotes(); } catch (e) { console.error(e); }
}, 60 * 60 * 1000).unref();
