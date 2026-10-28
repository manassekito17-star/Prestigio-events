# PRESTIGIO EVENTS — site web et administration

Site public, formulaire de devis intelligent avec estimation en direct, génération automatique de devis provisoires, **validation obligatoire par le directeur** avant tout envoi, PDF, CMS, répertoire privé des partenaires, calendrier, tâches et suivi des paiements.

> Agence événementielle à Kinshasa (RDC) — « L’excellence au cœur de chaque événement »

---

## 1. Technologies

| Élément | Choix | Pourquoi |
|---|---|---|
| Serveur | Node.js 20+ / Express 4 | simple à héberger, maintenable |
| Pages | rendu serveur (EJS), très peu de JavaScript | pages légères et rapides sur mobile (connexions 3G/4G de Kinshasa) |
| Base de données | SQLite (better-sqlite3), un seul fichier | aucune installation de serveur de base, sauvegarde facile |
| Fichiers | stockés hors du dossier public, servis par une route qui contrôle l’accès | aucun fichier privé accessible par URL directe |
| PDF | PDFKit | devis professionnels générés côté serveur |
| E-mail | Nodemailer (SMTP, facultatif) | envoi des devis et notifications si configuré |
| Polices | Cormorant Garamond + Inter, auto-hébergées | aucun appel externe |

Arborescence :

```
server.js                 démarrage
src/app.js                configuration Express (sécurité, sessions, routes)
src/config.js             variables d’environnement
src/db/schema.sql         schéma de la base
src/db/seed.js            données initiales (services, tarifs PROVISOIRES, textes)
src/lib/                  logique métier : quotes.js (workflow), catalog.js, pdf.js, auth.js, media.js…
public/js/pricing-core.js moteur de calcul partagé navigateur / serveur
src/routes/public.js      site public
src/routes/admin/         administration
src/views/                gabarits HTML
tests/                    tests automatisés
scripts/                  création de compte, réinitialisation, sauvegarde
```

## 2. Installation locale

```bash
npm install
npm run create-admin -- --email=vous@exemple.com --name="Billy Kito"   # demande le mot de passe
npm start                                                               # http://localhost:3000
```

- Site public : `http://localhost:3000`
- Administration : `http://localhost:3000/admin`

Aucun compte ni mot de passe n’est codé en dur : le premier compte propriétaire est créé avec la commande ci-dessus.

Tests : `npm test`.

## 3. Mise en ligne (déploiement)

L’application a besoin de Node.js 20+ et d’un **disque persistant** (la base SQLite et les fichiers téléversés y sont stockés). Une seule instance suffit.

### Option la plus simple — Render (quelques clics, ~7 $/mois)

Le fichier `render.yaml` contient toute la configuration (serveur Node, disque persistant de 1 Go, région Francfort, secret de session généré automatiquement).

1. Créez un compte sur https://render.com et connectez votre compte GitHub.
2. **New → Blueprint**, choisissez le dépôt `Prestigio-events` (et la branche qui contient le code).
3. Render demande trois valeurs :
   - `ADMIN_EMAIL` : votre e-mail de connexion ;
   - `ADMIN_INITIAL_PASSWORD` : un mot de passe provisoire (10 caractères minimum, lettres et chiffres) ;
   - `BASE_URL` : laissez vide pour l’instant (l’adresse `…onrender.com` est détectée automatiquement) ; renseignez-la plus tard avec votre nom de domaine.
4. Validez : le site est en ligne à l’adresse `https://<nom>.onrender.com`, l’administration à `/admin`.
5. Connectez-vous, changez le mot de passe dans « Mon compte », puis supprimez `ADMIN_INITIAL_PASSWORD` dans Render (Environment). Le compte initial n’est créé que si aucun compte n’existe : cette variable ne peut jamais écraser un compte.
6. Nom de domaine : Render → Settings → Custom Domains, puis mettre `BASE_URL=https://www.votre-domaine.cd`.

Le plan payant « Starter » est nécessaire pour le disque persistant (sans lui, les demandes seraient effacées à chaque redémarrage).

### Option A — VPS (recommandé : contrôle total, coût faible)

1. Serveur Ubuntu avec Node.js 22, Nginx et un nom de domaine.
2. `git clone …`, puis `npm ci --omit=dev`.
3. `cp .env.example .env` et compléter (au minimum `NODE_ENV=production`, `BASE_URL`, `SESSION_SECRET`, `TRUST_PROXY=1`).
4. `npm run create-admin -- --email=… --name="Billy Kito"`.
5. Lancer en service (systemd ou `pm2 start server.js --name prestigio`).
6. Nginx en proxy vers le port 3000 + certificat HTTPS (Let’s Encrypt / certbot). Exemple :
   ```nginx
   server {
     server_name www.votre-domaine.cd;
     client_max_body_size 30m;
     location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host;
                  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
   }
   ```
   En production, le cookie de session est `Secure` : **le site doit être servi en HTTPS**.

### Option B — Docker / plate-forme (Render, Railway, Fly.io…)

```bash
docker build -t prestigio .
docker run -d -p 3000:3000 -v prestigio-data:/data --env-file .env prestigio
docker exec -it <conteneur> npm run create-admin -- --email=… --name="Billy Kito"
```
Sur une plate-forme, attachez un **volume persistant** monté sur `/data` (sinon les données sont perdues à chaque redéploiement).

### Sauvegardes et restauration

- Depuis l’administration (propriétaire) : **Système → Sauvegardes** → télécharge la base.
- En ligne de commande : `npm run backup` copie la base **et** les fichiers dans `storage/backups/full-<date>/`. À planifier (cron quotidien) et à copier hors du serveur.
- Restauration : arrêter le service, remplacer `storage/prestigio.db` (et supprimer `prestigio.db-wal` / `-shm` s’ils existent) et `storage/uploads/` par la sauvegarde, redémarrer.
- Les sauvegardes contiennent des données personnelles : stockez-les de façon sécurisée.

## 4. Ce qui reste à configurer (intégrations externes)

| Élément | État | Action |
|---|---|---|
| **Envoi d’e-mails** (devis au client, notifications, mot de passe oublié) | **Non configuré par défaut** | Renseigner `SMTP_*` et `MAIL_FROM` (fournisseur : Brevo, Mailjet, Gmail Workspace, OVH…). Tant que ce n’est pas fait : devis transmis manuellement (PDF + WhatsApp) puis « Enregistrer l’envoi » ; aucune notification e-mail. Le tableau de bord le signale. |
| Notification administrateur | dépend du SMTP | `ADMIN_NOTIFY_EMAIL`. Dans tous les cas, les nouvelles demandes apparaissent dans le tableau de bord (compteur). |
| **WhatsApp** | Liens `wa.me` uniquement | Le site ouvre une conversation WhatsApp ; **aucun message n’est envoyé automatiquement**. Une intégration WhatsApp Business API nécessiterait un compte Meta vérifié et un développement complémentaire. |
| **Paiement en ligne** | **Non intégré** | Les paiements sont saisis manuellement et ne sont pas des transactions vérifiées. Une intégration (mobile money, carte) serait un projet séparé. |
| Nom de domaine + HTTPS | à faire | voir § 3 |
| Logo officiel | **intégré** (en-tête, pied de page, accueil, favicon, administration, devis PDF, partage sur les réseaux) | remplaçable si besoin : Administration → Textes et paramètres → Logo, nom et couleurs |
| Photo et biographie du fondateur | contenu provisoire neutre | Administration → Textes et paramètres → À propos et fondateur |
| Adresse, e-mail public, réseaux sociaux | vides (rien n’est affiché) | Administration → Coordonnées et réseaux sociaux |
| **Tarifs** | **tous PROVISOIRES et non publics** | voir § 5 |
| Photos | photos d’illustration (Unsplash) marquées « Photo d’illustration » | remplacer par vos photos (services, image d’accueil, galerie) |
| Carte Google Maps | désactivée | coller un lien « intégrer » une fois l’adresse vérifiée |

## 5. Tarifs : important avant publication

À l’installation, des **tarifs de départ provisoires** (ordres de grandeur) sont créés pour que le calculateur et les devis provisoires soient opérationnels. Ils ne constituent pas des prix réels :

- ils sont tous marqués **provisoires** et **non publics** ;
- tant qu’un tarif est provisoire ou non public, **le visiteur voit « À confirmer »** dans son estimation ;
- dans les devis provisoires internes, ils sont utilisés mais signalés « ⚠ Tarif provisoire à vérifier ».

Pour publier un prix : Administration → Tarifs → ouvrir le tarif → vérifier le montant sur le marché de Kinshasa → décocher « provisoire » et cocher « Prix visible publiquement ».

Méthodes de calcul disponibles (une par tarif ; rien n’est multiplié par le nombre d’invités sans que ce soit la méthode choisie) : forfait, par personne, par agent de protocole (par événement / heure / jour, durée incluse, heures supplémentaires), par heure, par jour, location, sur demande, remise en % ou fixe (avec seuil d’invités), frais globaux (transport…), options cochables, dates de validité, activation.

## 6. Fonctionnement du devis (validation obligatoire)

1. Le client remplit le formulaire en 7 étapes (type, infos, services, **agents de protocole**, budget, coordonnées, résumé) et voit une **estimation indicative** calculée uniquement avec les tarifs publics confirmés.
2. À l’envoi : la demande est enregistrée, une référence unique est attribuée, un **devis provisoire** (version 1, brouillon) est calculé avec le catalogue et enregistré ; statut « En attente de validation du directeur ». Le client voit seulement un accusé de réception.
3. Dans l’administration, le directeur vérifie et modifie les lignes, quantités (dont le nombre d’agents), prix, frais, remises, conditions, message ; **« Enregistrer sans envoyer »** ; prévisualisation PDF avec filigrane « BROUILLON ».
4. **« Valider et envoyer au client »** (réservé au rôle propriétaire) : la version est verrouillée, le PDF officiel est généré et conservé ;
   - si l’e-mail est configuré et que le client a donné une adresse : envoi, puis statut « Validé et envoyé » **seulement si le serveur e-mail a accepté le message** ;
   - sinon : statut « Validé — en attente d’envoi » ; télécharger le PDF, l’envoyer (WhatsApp…), puis **« J’ai envoyé le devis — enregistrer l’envoi »** avec la date.
5. Acceptation / refus : enregistrés manuellement avec une précision obligatoire (preuve de l’accord).
6. Correction d’un devis validé/envoyé : **nouvelle version** (brouillon) qui doit être revalidée ; l’ancienne reste intacte. Les devis conservent leurs lignes et montants même si le catalogue change.
7. Les devis envoyés dont la validité est dépassée passent automatiquement en « Devis expiré ».

## 7. Rôles et sécurité

| Rôle | Accès |
|---|---|
| Propriétaire / Administrateur principal | tout ; seul à valider et envoyer les devis, gérer tarifs, contenu, comptes, données confidentielles des partenaires, journal d’audit, sauvegardes |
| Responsable des opérations | demandes, préparation des devis (sans validation), calendrier, tâches, paiements, partenaires sans tarifs négociés / commissions / notes / documents |
| Collaborateur | uniquement les dossiers qui lui sont assignés (sans budget, devis ni paiements) et ses tâches |

Mesures en place : mots de passe hachés (scrypt), sessions côté serveur (cookie HttpOnly, SameSite, Secure en production, régénérées à la connexion, expiration 8 h), protection CSRF, limitation des tentatives de connexion et des envois de formulaires, pot de miel + délai minimal anti-robots, anti double soumission, en-têtes de sécurité (CSP stricte, nosniff, frame-ancestors none, HSTS en production), contrôle des permissions **côté serveur sur chaque route**, requêtes publiques limitées à des colonnes explicitement publiques, fichiers vérifiés par leur contenu réel et servis avec contrôle d’accès, pages admin `noindex` et non mises en cache, journal d’audit, export CSV protégé contre l’injection de formules.

Limite connue : SQLite n’a pas de sécurité au niveau des lignes (RLS) ; l’isolation est assurée par la couche serveur et par l’emplacement du fichier de base hors du dossier web (à protéger par les droits du système). Une migration vers PostgreSQL avec RLS reste possible si l’équipe grandit.

Récupération de compte : lien par e-mail (si SMTP configuré), réinitialisation par le propriétaire (Utilisateurs), ou sur le serveur : `npm run reset-password -- --email=…`.

## 8. Gestion du contenu sans développeur

Administration → **Services** (ajouter, modifier, masquer, réordonner, supprimer, photo, présence dans le formulaire), **Tarifs**, **Forfaits**, **Textes et paramètres** (accueil, à propos, fondateur, coordonnées, réseaux sociaux, logo, couleurs, conditions des devis, SEO), **Blocs de contenu** (sections réutilisables par page, brouillon / publication), **Galerie** (photos et vidéos, public / privé, type d’événement, mention « illustration »), **Partenaires** (répertoire privé, publication sélective champ par champ, désactivée par défaut). Le mode **Aperçu** (`?apercu=1`, visible seulement connecté) montre les éléments non publiés.

Langues : les libellés d’interface sont centralisés dans `src/i18n/fr.js` ; ajouter une langue consiste à créer un fichier équivalent (les contenus de la base resteraient à dupliquer par langue).

## 9. Tests réalisés

`npm test` — 32 tests automatisés, tous réussis :

- **Calcul** : prix par personne vs forfait (aucune multiplication abusive), options, agents de protocole × tarif + heures supplémentaires, « À confirmer » si nombre d’agents inconnu, prix sur demande jamais inventés, prix horaire, remise conditionnelle, frais.
- **Workflow** : enregistrement de la demande + référence unique ; devis provisoire généré et **jamais envoyé** au client ; anti double soumission ; anti-spam ; le responsable des opérations ne peut pas valider ; validation directeur → version verrouillée + PDF + envoi uniquement après acceptation SMTP ; commentaires internes absents de l’e-mail ; version envoyée non modifiable, correction = nouvelle version ; sans e-mail : « validé » mais pas « envoyé » jusqu’à l’enregistrement manuel ; acceptation impossible avant envoi et exigeant une preuve ; **modification d’un tarif sans effet sur les devis existants** ; paiements et solde.
- **Sécurité** : aucune page admin accessible sans connexion ; CSRF ; échec de connexion journalisé ; aucune fuite de tarifs négociés, commissions, notes internes, coordonnées privées ou prix provisoires dans les pages publiques et l’API publique ; tarif visible seulement si public **et** confirmé et valide ; seuls les partenaires publiés et les champs autorisés apparaissent ; fichiers privés inaccessibles par URL directe selon le rôle ; collaborateur limité à ses dossiers ; responsable des opérations sans données confidentielles ; partenaires privés par défaut ; fichiers déguisés refusés ; galerie privée non publique ; en-têtes de sécurité ; limitation des tentatives de connexion ; impossible de rétrograder le dernier propriétaire.

Vérifications manuelles (navigateur, mobile 390 px et ordinateur) : parcours complet du formulaire de devis, estimation en direct, résumé, envoi ; connexion admin ; tableau de bord ; dossier ; éditeur de devis ; PDF brouillon et final ; ouverture de toutes les pages d’administration sans erreur.

Non testé ici (dépend de vos comptes) : envoi réel par un serveur SMTP, déploiement sur votre hébergeur et votre domaine.

## 10. Logo

Le logo officiel fourni (doré sur fond noir) est décliné dans `public/img/logo/` :

| Fichier | Usage |
|---|---|
| `logo-original.jpg` | fichier d’origine (aperçu sur les réseaux sociaux, données structurées) |
| `logo-horizontal.png` | en-tête du site et de l’administration (emblème à gauche, nom à droite), fond transparent |
| `logo-full.png` | logo empilé : pied de page, page de connexion |
| `logo-emblem.png` | couronne + « P » : page d’accueil, services sans photo |
| `logo-horizontal-print.png` | version plus opaque pour le PDF des devis (papier blanc) |
| `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png` | icônes du navigateur et du téléphone |

Les versions transparentes sont extraites du fond noir de l’original. La ligne du slogan du fichier d’origine n’est pas reprise : le slogan est affiché en texte sur le site (« L’excellence au cœur de chaque événement »). Un logo téléversé dans l’administration remplace ces fichiers partout.

## 11. Firebase Hosting (version de démonstration)

Projet Firebase : `prestigioevent-1bdde` — adresse : https://prestigioevent-1bdde.web.app

Firebase Hosting ne sert que des fichiers statiques : on y publie la **démonstration** (`firebase/public/`), qui montre les pages et le calculateur mais **n’enregistre aucune demande**. Elle n’est pas indexée par les moteurs de recherche (les tarifs affichés sont provisoires). Le vrai site, avec base de données, se déploie sur Render (voir § 3).

**Publication automatique depuis GitHub (aucune commande à taper)** — à faire une seule fois :
1. Console Firebase → roue dentée → **Paramètres du projet** → onglet **Comptes de service** → **Générer une nouvelle clé privée** → un fichier `.json` est téléchargé. Ce fichier donne accès au projet : ne le partagez avec personne et ne l’envoyez pas par message.
2. GitHub → dépôt `Prestigio-events` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Nom : `FIREBASE_SERVICE_ACCOUNT` ; valeur : tout le contenu du fichier `.json` (ouvert avec le Bloc-notes, copier-coller). Enregistrer, puis supprimer le fichier de l’ordinateur.
3. GitHub → onglet **Actions** → « Firebase Hosting (démonstration) » → **Run workflow**. Après 1 à 2 minutes, le site est en ligne.

**Ou en ligne de commande** (ordinateur avec Node.js) : `npm install -g firebase-tools`, `firebase login`, puis `firebase deploy --only hosting` dans le dossier du projet.
