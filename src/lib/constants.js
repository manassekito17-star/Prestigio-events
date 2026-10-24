'use strict';

const EVENT_TYPES = {
  mariage: 'Mariage',
  traditionnel: 'Cérémonie traditionnelle',
  anniversaire: 'Anniversaire',
  conference: 'Conférence ou séminaire',
  entreprise: 'Événement d’entreprise',
  concert: 'Concert ou soirée',
  deuil: 'Cérémonie de deuil',
  autre: 'Autre',
};

const STATUSES = {
  new: { label: 'Nouvelle demande', tone: 'info' },
  draft_generated: { label: 'Devis provisoire généré', tone: 'info' },
  pending_validation: { label: 'En attente de validation du directeur', tone: 'warn' },
  editing: { label: 'En cours de modification', tone: 'warn' },
  approved: { label: 'Validé — en attente d’envoi', tone: 'warn' },
  sent: { label: 'Validé et envoyé au client', tone: 'ok' },
  accepted: { label: 'Devis accepté par le client', tone: 'ok' },
  refused: { label: 'Devis refusé', tone: 'muted' },
  expired: { label: 'Devis expiré', tone: 'muted' },
  cancelled: { label: 'Demande annulée', tone: 'muted' },
  archived: { label: 'Archivée', tone: 'muted' },
};

// Statuts qu'un utilisateur peut choisir manuellement. Les autres (approved,
// sent, accepted, refused) ne s'obtiennent que par les actions dédiées du devis.
const MANUAL_STATUSES = ['new', 'pending_validation', 'editing', 'expired', 'cancelled', 'archived'];

const VERSION_STATES = {
  draft: 'Brouillon (non validé)',
  approved: 'Validé — non envoyé',
  sent: 'Envoyé',
  superseded: 'Remplacé par une version plus récente',
};

const PROTOCOL_TASKS = {
  accueil: 'Accueil des invités',
  orientation: 'Orientation',
  placement: 'Placement des invités',
  entrees: 'Gestion des entrées',
  vip: 'Assistance aux VIP',
  autre: 'Autre',
};

const BUDGET_RANGES = [
  [0, 500], [500, 1000], [1000, 2500], [2500, 5000], [5000, 10000], [10000, 25000], [25000, null],
];

const PAYMENT_METHODS = {
  cash: 'Espèces',
  mobile_money: 'Mobile money',
  bank: 'Virement bancaire',
  card: 'Carte',
  other: 'Autre',
};

const PARTNER_CATEGORIES = {
  salle: 'Salle', decorateur: 'Décorateur', traiteur: 'Traiteur', photographe: 'Photographe', videaste: 'Vidéaste',
  dj: 'DJ', sonorisation: 'Sonorisation', eclairage: 'Éclairage', transport: 'Transport', personnel: 'Personnel de service', autre: 'Autre',
};

const PARTNER_STATUSES = { active: 'Actif', to_verify: 'À vérifier', inactive: 'Inactif', archived: 'Archivé' };

// Champs d'un partenaire qu'il est POSSIBLE de publier (liste blanche).
const PARTNER_PUBLIC_FIELDS = {
  category: 'Catégorie',
  description: 'Description publique',
  logo: 'Logo ou photo',
  phone: 'Téléphone public',
  email: 'E-mail public',
  website: 'Site web',
  area: 'Zone d’intervention',
};

const TARIFF_METHODS = {
  fixed: 'Forfait',
  per_person: 'Par personne (invité)',
  per_agent: 'Par agent de protocole',
  per_hour: 'Par heure',
  per_day: 'Par jour',
  rental: 'Location (forfait)',
  on_request: 'Sur demande (à confirmer)',
  discount_pct: 'Remise en %',
  discount_fixed: 'Remise fixe',
};

const PACKAGE_PRICE_TYPES = { fixed: 'Prix fixe', from: 'À partir de', per_person: 'Par personne', on_request: 'Sur demande' };

const TASK_STATUSES = { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' };

const DEFAULT_CHECKLIST = [
  'Confirmer le lieu et les horaires d’accès',
  'Confirmer les prestataires (décoration, traiteur, sonorisation…)',
  'Valider le plan de table et la liste des invités',
  'Briefer les agents de protocole',
  'Préparer le déroulé minute par minute',
  'Vérifier le matériel la veille',
  'Encaisser le solde avant l’événement',
];

module.exports = {
  EVENT_TYPES, STATUSES, MANUAL_STATUSES, VERSION_STATES, PROTOCOL_TASKS, BUDGET_RANGES, PAYMENT_METHODS,
  PARTNER_CATEGORIES, PARTNER_STATUSES, PARTNER_PUBLIC_FIELDS, TARIFF_METHODS, PACKAGE_PRICE_TYPES, TASK_STATUSES, DEFAULT_CHECKLIST,
};
