'use strict';
// Réinitialise le mot de passe d'un compte depuis le serveur (récupération sans e-mail).
//   npm run reset-password -- --email=vous@exemple.com
const readline = require('readline');
const db = require('../src/db');
const auth = require('../src/lib/auth');

const email = (process.argv.find((a) => a.startsWith('--email=')) || '').slice(8).trim().toLowerCase();
const u = email && db.get().prepare('SELECT id, name FROM users WHERE email = ?').get(email);
if (!u) { console.error('Compte introuvable. Usage : npm run reset-password -- --email=adresse'); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = (s) => { if (s.includes('Nouveau')) rl.output.write(s); };
rl.question('Nouveau mot de passe : ', (pw) => {
  rl.close();
  process.stdout.write('\n');
  const problem = auth.passwordProblem(pw);
  if (problem) { console.error(problem); process.exit(1); }
  db.get().prepare("UPDATE users SET password_hash = ?, active = 1, reset_token_hash = NULL, updated_at = datetime('now') WHERE id = ?").run(auth.hashPassword(pw), u.id);
  new auth.SqliteStore().destroyUserSessions(u.id);
  console.log(`Mot de passe de ${u.name} réinitialisé ; ses sessions ont été fermées.`);
  process.exit(0);
});
