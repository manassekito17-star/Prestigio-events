'use strict';
// Données initiales. Tous les tarifs sont marqués PROVISOIRES et NON PUBLICS :
// ce sont des ordres de grandeur à vérifier sur le marché de Kinshasa avant
// publication. Tant qu'un tarif est provisoire ou non public, le visiteur voit
// « À confirmer » dans son estimation.

const DEFAULT_SETTINGS = {
  agency_name: 'PRESTIGIO EVENTS',
  slogan: 'L’excellence au cœur de chaque événement',
  founder_name: 'Billy Kito',
  founder_title: 'Fondateur et Directeur général',
  founder_bio: '',
  founder_photo_media_id: '',
  city: 'Kinshasa, République démocratique du Congo',
  whatsapp: '+243813583732',
  phone_display: '+243 813 583 732',
  public_email: '',
  address: '',
  map_url: '',
  socials: JSON.stringify({ facebook: '', instagram: '', tiktok: '', linkedin: '', youtube: '' }),
  logo_media_id: '',
  hero_media_id: '',
  color_primary: '#0B1F3A',
  color_accent: '#D4AF37',
  home_hero_title: 'PRESTIGIO EVENTS',
  home_hero_text: 'Agence d’organisation d’événements à Kinshasa. Mariages, cérémonies, événements d’entreprise et réceptions : nous concevons, planifions et coordonnons votre événement avec soin.',
  home_intro: 'De la première idée au jour J, PRESTIGIO EVENTS vous accompagne pour organiser un événement à votre image, dans le respect de votre budget. Nous coordonnons les prestataires, le protocole et la logistique pour que vous puissiez profiter pleinement du moment.',
  why_items: JSON.stringify([
    { title: 'Un interlocuteur unique', text: 'Une seule équipe pour coordonner vos prestataires, vos invités et le déroulement de votre événement.' },
    { title: 'Des solutions adaptées à votre budget', text: 'Nous construisons une proposition claire, ligne par ligne, en fonction de vos priorités et de vos moyens.' },
    { title: 'Une organisation rigoureuse', text: 'Planning, listes de contrôle et coordination le jour J pour un déroulement maîtrisé.' },
    { title: 'Un devis transparent', text: 'Chaque devis est vérifié et validé par la direction avant de vous être transmis.' },
  ]),
  about_mission: 'Concevoir et organiser des événements élégants et bien coordonnés à Kinshasa, en accompagnant chaque client avec écoute, rigueur et transparence.',
  about_vision: 'Devenir une référence de l’organisation événementielle à Kinshasa, reconnue pour la qualité de son accompagnement et le soin apporté à chaque détail.',
  about_approach: JSON.stringify([
    { title: 'Écoute', text: 'Nous échangeons avec vous pour comprendre l’événement, vos invités, vos attentes et votre budget.' },
    { title: 'Proposition', text: 'Nous établissons un devis détaillé, vérifié et validé par la direction.' },
    { title: 'Préparation', text: 'Nous coordonnons les prestataires, le lieu, la décoration et la logistique.' },
    { title: 'Jour J', text: 'Notre équipe et nos agents de protocole veillent au bon déroulement de l’événement.' },
  ]),
  values: JSON.stringify([
    { title: 'Professionnalisme', text: 'Ponctualité, fiabilité et respect des engagements.' },
    { title: 'Créativité', text: 'Des ambiances et des mises en scène pensées pour chaque occasion.' },
    { title: 'Organisation', text: 'Une planification rigoureuse et une coordination précise.' },
    { title: 'Respect du budget', text: 'Des propositions claires et adaptées à vos moyens.' },
  ]),
  quote_payment_terms: 'Acompte de 50 % à la confirmation de la réservation. Solde à régler au plus tard 7 jours avant la date de l’événement.',
  quote_validity_days: '30',
  quote_legal_mentions: 'Ce devis est établi sur la base des informations communiquées par le client. Toute modification du nombre d’invités, de la date, du lieu ou des prestations pourra entraîner une révision du montant. La réservation n’est confirmée qu’après acceptation écrite du devis et réception de l’acompte.',
  show_partners_section: '1',
  seo_description: 'PRESTIGIO EVENTS, agence événementielle à Kinshasa (RDC) : organisation de mariages, cérémonies traditionnelles, anniversaires, conférences, événements d’entreprise, décoration, protocole et coordination. Demandez votre devis.',
  locale: 'fr',
};

// [slug, name, form_label, category, summary, includes, demo_image, is_protocol, in_quote_form]
const SERVICES = [
  ['mariages-ceremonies', 'Mariages et cérémonies traditionnelles', null, 'Événements',
    'Mariage civil, religieux, coutumier ou dot : nous orchestrons chaque étape de votre union.',
    'Conception du déroulé\nCoordination des prestataires\nDécoration et mise en scène\nProtocole et accueil des invités\nCoordination le jour J', 'wedding.jpg', 0, 0],
  ['anniversaires-fetes-privees', 'Anniversaires et fêtes privées', null, 'Événements',
    'Des célébrations personnalisées pour marquer les moments importants de votre vie.',
    'Thème et décoration\nAnimation et musique\nRestauration\nCoordination', 'birthday.jpg', 0, 0],
  ['evenements-entreprise', 'Conférences, séminaires et événements d’entreprise', null, 'Événements',
    'Conférences, séminaires, réunions, lancements et soirées d’entreprise organisés avec rigueur.',
    'Recherche de salle\nSonorisation et matériel technique\nAccueil et enregistrement des participants\nPauses et restauration\nCoordination', 'conference.jpg', 0, 0],
  ['concerts-soirees', 'Concerts, soirées et événements festifs', null, 'Événements',
    'Soirées, concerts et événements festifs : ambiance, technique et logistique maîtrisées.',
    'Sonorisation et éclairage\nDJ et animation\nGestion des entrées\nCoordination', 'party.jpg', 0, 0],
  ['ceremonies-deuil', 'Cérémonies de deuil et réceptions funéraires', null, 'Événements',
    'Un accompagnement discret et respectueux pour organiser les cérémonies de deuil et les réceptions.',
    'Organisation de la veillée et de la réception\nDécoration sobre\nAccueil et placement des invités\nRestauration\nCoordination', null, 0, 0],
  ['conception-coordination', 'Conception, planification et coordination générale', 'Organisation complète', 'Prestations',
    'Nous prenons en charge l’organisation de A à Z : conception, budget, prestataires, planning et jour J.',
    'Rendez-vous de conception\nPlanning et budget prévisionnel\nSélection et coordination des prestataires\nCoordination le jour J', null, 0, 1],
  ['coordination-jour-j', 'Coordination le jour de l’événement', 'Coordination uniquement', 'Prestations',
    'Vous avez organisé votre événement ; nous coordonnons son déroulement le jour J.',
    'Réunion de préparation\nDéroulé minute par minute\nCoordination des prestataires sur place', null, 0, 1],
  ['decoration', 'Décoration de salles et espaces', 'Décoration', 'Prestations',
    'Mise en scène, décoration florale, nappage, centres de table et ambiance lumineuse.',
    'Proposition de thème\nInstallation et démontage\nCentres de table et nappage', 'decoration.jpg', 0, 1],
  ['salles-lieux', 'Recherche et location de salles ou lieux de réception', 'Salle ou lieu de réception', 'Prestations',
    'Nous identifions et réservons le lieu adapté à votre événement, à votre nombre d’invités et à votre budget.',
    'Recherche selon vos critères\nVisites\nNégociation et réservation', null, 0, 1],
  ['catering', 'Catering, repas, boissons et service', 'Catering et boissons', 'Prestations',
    'Repas, buffets, cocktails, boissons et personnel de service.',
    'Proposition de menu\nBoissons\nPersonnel de service', 'reception.jpg', 0, 1],
  ['sonorisation-eclairage', 'Sonorisation, éclairage et matériel technique', 'Sonorisation et éclairage', 'Prestations',
    'Matériel de sonorisation, micros, éclairage d’ambiance et technique pour conférences.',
    'Installation et réglages\nTechnicien sur place', null, 0, 1],
  ['dj-animation', 'DJ, animation et présentateur', 'DJ, animation ou présentateur', 'Prestations',
    'DJ, maître de cérémonie, présentateur et animations pour rythmer votre événement.',
    'Programme musical\nAnimation\nMaître de cérémonie', null, 0, 1],
  ['photo-video', 'Photographie et vidéo', 'Photo et vidéo', 'Prestations',
    'Photographes et vidéastes pour immortaliser votre événement.',
    'Couverture photo\nVidéo (en option)\nRetouche et livraison numérique', null, 0, 1],
  ['protocole-accueil', 'Protocole, accueil des invités et coordination', 'Protocole et accueil', 'Prestations',
    'Agents de protocole pour l’accueil, l’orientation, le placement des invités, la gestion des entrées et l’assistance aux VIP.',
    'Accueil et orientation\nPlacement des invités\nGestion des entrées\nAssistance aux VIP', null, 1, 1],
];

// Tarifs provisoires (USD) — ORDRES DE GRANDEUR À VÉRIFIER, non publics.
// [slug | null (global), name, method, amountUSD, extra]
const TARIFFS = [
  ['conception-coordination', 'Organisation complète — honoraires de conception et coordination', 'fixed', 800, {}],
  ['coordination-jour-j', 'Coordination le jour J', 'fixed', 300, {}],
  ['decoration', 'Décoration (par invité)', 'per_person', 8, {}],
  ['decoration', 'Arche ou décor de scène', 'fixed', 250, { optional: 1 }],
  ['salles-lieux', 'Location de salle', 'on_request', null, { conditions: 'Selon le lieu, la date et la capacité.' }],
  ['salles-lieux', 'Frais de recherche et de réservation du lieu', 'fixed', 100, {}],
  ['catering', 'Repas (par invité)', 'per_person', 20, {}],
  ['catering', 'Boissons (par invité)', 'per_person', 6, { optional: 1 }],
  ['sonorisation-eclairage', 'Location sonorisation', 'rental', 350, {}],
  ['sonorisation-eclairage', 'Éclairage d’ambiance', 'rental', 200, { optional: 1 }],
  ['dj-animation', 'DJ (prestation)', 'fixed', 250, {}],
  ['dj-animation', 'Maître de cérémonie / présentateur', 'fixed', 200, { optional: 1 }],
  ['photo-video', 'Photographe', 'fixed', 300, {}],
  ['photo-video', 'Vidéaste', 'fixed', 400, { optional: 1 }],
  ['protocole-accueil', 'Agent de protocole', 'per_agent', 30, { agent_unit: 'event', included_hours: 6, extra_hour_cents: 500 }],
  ['protocole-accueil', 'Repas des agents de protocole', 'per_agent', 5, { agent_unit: 'event', optional: 1 }],
  [null, 'Frais de déplacement et logistique (Kinshasa)', 'fixed', 30, {}],
];

function seed(db) {
  const setS = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setS.run(k, v);

  const insSvc = db.prepare(`INSERT INTO services (slug, name, form_label, category, summary, description, includes, demo_image, is_protocol, in_quote_form, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const ids = {};
  SERVICES.forEach((s, i) => {
    const [slug, name, formLabel, cat, summary, includes, img, proto, inForm] = s;
    ids[slug] = insSvc.run(slug, name, formLabel, cat, summary, summary, includes, img, proto, inForm, (i + 1) * 10).lastInsertRowid;
  });

  const insT = db.prepare(`INSERT INTO tariffs (service_id, scope, name, method, amount_cents, agent_unit, included_hours, extra_hour_cents, optional, conditions, internal_note, public_price, provisional, sort_order)
    VALUES (@service_id, @scope, @name, @method, @amount_cents, @agent_unit, @included_hours, @extra_hour_cents, @optional, @conditions, @internal_note, 0, 1, @sort_order)`);
  TARIFFS.forEach(([slug, name, method, usd, extra], i) => {
    insT.run({
      service_id: slug ? ids[slug] : null,
      scope: slug ? 'service' : 'global',
      name, method,
      amount_cents: usd == null ? null : Math.round(usd * 100),
      agent_unit: extra.agent_unit || null,
      included_hours: extra.included_hours || null,
      extra_hour_cents: extra.extra_hour_cents || null,
      optional: extra.optional || 0,
      conditions: extra.conditions || null,
      internal_note: 'Tarif de départ provisoire proposé à l’installation : à vérifier sur le marché de Kinshasa avant publication.',
      sort_order: (i + 1) * 10,
    });
  });

  const insP = db.prepare(`INSERT INTO packages (name, event_type, summary, price_type, amount_cents, includes, excludes, provisional, featured, published, sort_order)
    VALUES (?,?,?,?,?,?,?,1,?,1,?)`);
  insP.run('Formule Essentielle', 'Tous événements', 'Coordination le jour J et protocole pour un événement déjà préparé.', 'from', null,
    'Réunion de préparation\nCoordination le jour J\nAgents de protocole (nombre à définir)', 'Salle\nRestauration\nDécoration', 0, 10);
  insP.run('Formule Prestige', 'Mariages et réceptions', 'Organisation complète avec décoration, protocole et coordination.', 'from', null,
    'Conception et planification\nDécoration\nProtocole et accueil\nCoordination le jour J', 'Location de salle (sur devis)\nRestauration (sur devis)', 1, 20);
  insP.run('Formule Entreprise', 'Conférences et séminaires', 'Logistique, technique et accueil pour vos événements professionnels.', 'on_request', null,
    'Recherche de salle\nSonorisation\nAccueil des participants\nCoordination', 'Restauration (sur devis)', 0, 30);
}

module.exports = { seed, DEFAULT_SETTINGS };
