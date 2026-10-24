'use strict';
// Crée un compte administrateur. Usage :
//   npm run create-admin -- --email=vous@exemple.com --name="Billy Kito" [--role=owner]
// Le mot de passe est demandé de façon interactive (ou via la variable ADMIN_PASSWORD).
const readline = require('readline');
const db = require('../src/db');
const auth = require('../src/lib/auth');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, ...v]) => [k, v.join('=')]));

function ask(q, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const email = (args.email || await ask('E-mail : ')).trim().toLowerCase();
  const name = (args.name || await ask('Nom : ')).trim();
  const role = ['owner', 'ops', 'staff'].includes(args.role) ? args.role : 'owner';
  const password = process.env.ADMIN_PASSWORD || await ask('Mot de passe (10 caractères min., lettres et chiffres) : ', true);
  const problem = auth.passwordProblem(password);
  if (problem) { console.error(problem); process.exit(1); }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) || !name) { console.error('E-mail ou nom invalide.'); process.exit(1); }
  if (db.get().prepare('SELECT 1 FROM users WHERE email = ?').get(email)) { console.error('Un compte existe déjà avec cet e-mail.'); process.exit(1); }
  db.get().prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)').run(email, name, auth.hashPassword(password), role);
  console.log(`Compte « ${role} » créé pour ${name} <${email}>.`);
})();
