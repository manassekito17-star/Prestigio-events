'use strict';
// Sauvegarde à chaud de la base + copie des fichiers téléversés.
//   npm run backup            → storage/backups/AAAA-MM-JJ.../
// Planifiez-la (cron) et copiez le dossier produit hors du serveur.
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const db = require('../src/db');

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(config.backupsDir, `full-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  await db.get().backup(path.join(dir, 'prestigio.db'));
  fs.cpSync(config.uploadsDir, path.join(dir, 'uploads'), { recursive: true });
  console.log('Sauvegarde créée :', dir);
})().catch((e) => { console.error(e); process.exit(1); });
