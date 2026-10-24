-- PRESTIGIO EVENTS — schéma de base de données (SQLite)
-- Montants stockés en centimes (entiers) pour éviter les erreurs d'arrondi.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

-- ---------------------------------------------------------------- Comptes
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','ops','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  reset_token_hash TEXT,
  reset_expires_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ---------------------------------------------------------------- Paramètres & contenu
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Fichiers (images, vidéos, documents). Aucun fichier n'est servi en statique :
-- la route /media/:id vérifie le niveau d'accès à chaque requête.
-- access : public | staff (tout compte connecté) | manager (owner + ops) | owner
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  stored_name TEXT NOT NULL UNIQUE,
  original_name TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  access TEXT NOT NULL DEFAULT 'owner' CHECK (access IN ('public','staff','manager','owner')),
  alt_text TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_blocks (
  id INTEGER PRIMARY KEY,
  page TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image_text','cta','highlight')),
  title TEXT,
  body TEXT,
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  button_label TEXT,
  button_url TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- Catalogue
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  form_label TEXT,             -- libellé dans le formulaire de devis
  category TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  includes TEXT,               -- une prestation par ligne
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  demo_image TEXT,             -- image d'illustration fournie par défaut (non une réalisation)
  is_protocol INTEGER NOT NULL DEFAULT 0,   -- déclenche la question « agents de protocole »
  published INTEGER NOT NULL DEFAULT 1,
  in_quote_form INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tarifs. Un tarif est rattaché à un service (scope=service) ou s'applique
-- globalement à toute estimation (scope=global : frais, transport, remises).
-- method :
--   fixed         montant forfaitaire
--   per_person    montant × nombre d'invités
--   per_agent     montant × nombre d'agents de protocole × unités (événement/heure/jour)
--   per_hour      montant × durée (heures)
--   per_day       montant × nombre de jours
--   rental        location (forfait par événement)
--   on_request    prix sur demande (toujours « À confirmer »)
--   discount_pct  remise en % du sous-total
--   discount_fixed remise d'un montant fixe
CREATE TABLE IF NOT EXISTS tariffs (
  id INTEGER PRIMARY KEY,
  service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'service' CHECK (scope IN ('service','global')),
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('fixed','per_person','per_agent','per_hour','per_day','rental','on_request','discount_pct','discount_fixed')),
  amount_cents INTEGER,          -- NULL = non renseigné → « À confirmer »
  percent REAL,                  -- pour discount_pct
  agent_unit TEXT CHECK (agent_unit IN ('event','hour','day')),
  included_hours REAL,           -- durée incluse (agents de protocole)
  extra_hour_cents INTEGER,      -- heure supplémentaire par agent
  optional INTEGER NOT NULL DEFAULT 0,      -- option cochable par le client
  min_guests INTEGER,            -- condition d'application (remises, etc.)
  valid_from TEXT,
  valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  public_price INTEGER NOT NULL DEFAULT 0,  -- prix visible par les visiteurs
  provisional INTEGER NOT NULL DEFAULT 1,   -- tarif provisoire / à confirmer
  conditions TEXT,               -- conditions publiques
  internal_note TEXT,            -- jamais affiché publiquement
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tariffs_service ON tariffs(service_id);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  event_type TEXT,
  summary TEXT,
  price_type TEXT NOT NULL DEFAULT 'on_request' CHECK (price_type IN ('fixed','from','per_person','on_request')),
  amount_cents INTEGER,
  includes TEXT,
  excludes TEXT,
  provisional INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gallery_items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video')),
  media_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
  video_url TEXT,
  caption TEXT,
  event_type TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_illustration INTEGER NOT NULL DEFAULT 0, -- 1 = image de démonstration, pas une réalisation
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- Partenaires (privé)
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY,
  trade_name TEXT NOT NULL,
  category TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  service_area TEXT,
  services_desc TEXT,
  negotiated_rates TEXT,
  booking_terms TEXT,
  commission TEXT,
  internal_notes TEXT,
  status TEXT NOT NULL DEFAULT 'to_verify' CHECK (status IN ('active','to_verify','inactive','archived')),
  last_verified_at TEXT,
  -- Publication sélective (désactivée par défaut)
  publish INTEGER NOT NULL DEFAULT 0,
  public_fields TEXT NOT NULL DEFAULT '[]',     -- liste blanche JSON
  public_description TEXT,
  public_phone TEXT,
  public_email TEXT,
  public_website TEXT,
  contact_publication_authorized INTEGER NOT NULL DEFAULT 0,
  image_publication_authorized INTEGER NOT NULL DEFAULT 0,
  logo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS partner_documents (
  id INTEGER PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------- Demandes & devis
-- status : new, draft_generated, pending_validation, editing, approved,
--          sent, accepted, refused, expired, cancelled, archived
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'new',
  event_type TEXT NOT NULL,
  event_type_other TEXT,
  event_date TEXT,
  start_time TEXT,
  duration_hours REAL,
  guests INTEGER,
  location_area TEXT,
  venue_booked INTEGER,
  wants_venue_search INTEGER,
  selections TEXT NOT NULL DEFAULT '{}',  -- JSON {services:[id], options:[tariffId]}
  protocol_agents INTEGER,
  protocol_unknown INTEGER NOT NULL DEFAULT 0,
  protocol_tasks TEXT,                     -- JSON
  budget_mode TEXT,                        -- exact | range | unknown
  budget_min_cents INTEGER,
  budget_max_cents INTEGER,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_email TEXT,
  client_notes TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  client_estimate TEXT,                    -- JSON : estimation affichée au client
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submit_token TEXT UNIQUE,                -- anti double soumission
  seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_date ON requests(event_date);

CREATE TABLE IF NOT EXISTS request_notes (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_history (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Une version approuvée (locked=1) n'est plus jamais modifiée : toute
-- correction crée une nouvelle version qui doit être revalidée.
-- state : draft | approved | sent | superseded
CREATE TABLE IF NOT EXISTS quote_versions (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  auto_generated INTEGER NOT NULL DEFAULT 0,
  lines TEXT NOT NULL DEFAULT '[]',        -- JSON figé
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  fees_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  has_unconfirmed INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_terms TEXT,
  validity_days INTEGER NOT NULL DEFAULT 30,
  client_message TEXT,
  conditions TEXT,
  internal_comment TEXT,                   -- jamais transmis au client
  locked INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  sent_at TEXT,
  sent_channel TEXT,                       -- email | whatsapp_manual | other_manual
  sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sent_note TEXT,
  pdf_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  accepted_at TEXT,
  acceptance_note TEXT,
  UNIQUE (quote_id, version_no)
);

-- ---------------------------------------------------------------- Opérations
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  paid_on TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','CDF')),
  method TEXT NOT NULL,
  reference TEXT,
  proof_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  message TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
