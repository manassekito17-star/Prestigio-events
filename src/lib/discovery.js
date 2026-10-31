'use strict';
// Fiche de découverte « Organisation de mariage » (document de PRESTIGIO EVENTS),
// proposée au client dans le formulaire de devis lorsqu'il choisit « Mariage ».
// Cette définition unique sert au formulaire, à la validation serveur (liste
// blanche des réponses) et à l'affichage dans l'administration.
//
// type : radio (un choix) | checkbox (plusieurs) | text | textarea | number
// other : ajoute un champ libre « Autre » (affiché quand l'option `autre` est cochée)
// budget : réponse liée au budget (masquée aux collaborateurs sans accès aux devis)

const WEDDING_EVENT_TYPES = ['mariage'];

// Étapes propres au mariage, insérées dans le formulaire de devis.
const STEPS = {
  maries: { title: 'Les futurs mariés', intro: 'Faisons connaissance. Ces informations nous permettent de préparer un accompagnement personnalisé.' },
  ceremonies: { title: 'Vos cérémonies', intro: 'Dot, mariage civil, religieux, réception : dites-nous comment vous imaginez votre union.' },
  lieux: { title: 'Lieux et invités', intro: 'Les lieux et le nombre d’invités déterminent une grande partie de l’organisation.' },
  style: { title: 'Style et ambiance', intro: 'Votre vision guide nos propositions de décoration et de mise en scène.' },
  exigences: { title: 'Traditions et communication', intro: 'Les traditions familiales, vos exigences et la façon dont nous travaillerons ensemble.' },
  attentes: { title: 'Vos attentes', intro: 'Pour finir, ce qui compte le plus pour vous.' },
};

const Q = [
  // ---------------------------------------------------------------- Les futurs mariés
  { key: 'groom_name', step: 'maries', type: 'text', label: 'Nom complet du futur marié', max: 120, autocomplete: 'off' },
  { key: 'bride_name', step: 'maries', type: 'text', label: 'Nom complet de la future mariée', max: 120, autocomplete: 'off' },
  { key: 'groom_phone', step: 'maries', type: 'tel', label: 'Téléphone du marié', max: 40, half: true },
  { key: 'bride_phone', step: 'maries', type: 'tel', label: 'Téléphone de la mariée', max: 40, half: true },
  { key: 'filled_by', step: 'maries', type: 'radio', label: 'Qui remplit ce formulaire ?', options: {
    groom: 'Le futur marié', bride: 'La future mariée', both: 'Les deux futurs mariés',
    groom_parents: 'Parents du marié', bride_parents: 'Parents de la mariée', family_rep: 'Autre représentant des familles',
  } },

  // ---------------------------------------------------------------- Cérémonies
  { key: 'ceremonies', step: 'ceremonies', type: 'checkbox', label: 'Quelles cérémonies prévoyez-vous ?', help: 'Plusieurs choix possibles.', options: {
    dot: 'Mariage coutumier (dot)', civil: 'Mariage civil', religious: 'Mariage religieux', reception: 'Réception festive',
  } },
  { key: 'schedule', step: 'ceremonies', type: 'radio', label: 'Comment souhaitez-vous organiser ces cérémonies ?', options: {
    same_day: 'Toutes le même jour', several_days: 'Sur plusieurs jours', several_weeks: 'Sur plusieurs semaines', undecided: 'Pas encore décidé',
  } },
  { key: 'date_status', step: 'ceremonies', type: 'radio', label: 'Avez-vous déjà fixé la date du mariage ?', options: {
    yes: 'Oui', provisional: 'Date provisoire', no: 'Non',
  } },
  { key: 'progress', step: 'ceremonies', type: 'radio', label: 'Où en êtes-vous dans les préparatifs ?', options: {
    none: 'Aucun préparatif commencé', some_vendors: 'Quelques prestataires déjà sélectionnés', some_bookings: 'Plusieurs réservations déjà effectuées',
    almost_done: 'Organisation presque terminée', restructure: 'Besoin de reprendre et restructurer l’organisation',
  } },

  // ---------------------------------------------------------------- Lieux et invités
  { key: 'venues', step: 'lieux', type: 'radio', label: 'Avez-vous déjà choisi les lieux ?', options: {
    all_booked: 'Oui, tous les lieux sont réservés', some_booked: 'Certains lieux sont réservés', none: 'Aucun lieu n’est encore choisi',
    agency: 'Nous souhaitons que PRESTIGIO EVENTS s’en charge',
  } },
  { key: 'venues_text', step: 'lieux', type: 'text', label: 'Lieux envisagés', max: 300, placeholder: 'Salle, église, résidence familiale…' },
  { key: 'guests_groom', step: 'lieux', type: 'number', label: 'Invités côté marié (estimation)', min: 0, max: 50000, half: true },
  { key: 'guests_bride', step: 'lieux', type: 'number', label: 'Invités côté mariée (estimation)', min: 0, max: 50000, half: true },
  { key: 'special_guests', step: 'lieux', type: 'checkbox', label: 'Aurez-vous des invités particuliers ?', other: true, options: {
    authorities: 'Autorités politiques ou administratives', public_figures: 'Personnalités publiques', family_vip: 'Membres importants des familles',
    abroad: 'Invités venant de l’étranger', none: 'Aucun besoin particulier', autre: 'Autres',
  } },

  // ---------------------------------------------------------------- Style et ambiance
  { key: 'style', step: 'style', type: 'radio', label: 'Quel style de mariage souhaitez-vous ?', other: true, options: {
    classic: 'Classique et élégant', modern: 'Moderne et sophistiqué', luxury: 'Luxueux et prestigieux', traditional: 'Traditionnel et culturel',
    intimate: 'Intimiste et familial', country: 'Champêtre et naturel', autre: 'Autre',
  } },
  { key: 'theme', step: 'style', type: 'radio', label: 'Avez-vous déjà choisi un thème ou des couleurs ?', options: {
    yes: 'Oui', no: 'Non', proposals: 'Nous souhaitons des propositions',
  } },
  { key: 'colors', step: 'style', type: 'text', label: 'Couleurs ou thème souhaités', max: 200, placeholder: 'ex. or et ivoire, bleu nuit…' },
  { key: 'ambiance', step: 'style', type: 'radio', label: 'Quelle ambiance souhaitez-vous offrir à vos invités ?', options: {
    refined: 'Élégante et raffinée', festive: 'Festive et animée', solemn: 'Religieuse et solennelle', family: 'Familiale et chaleureuse', mix: 'Un mélange de plusieurs ambiances',
  } },

  // ---------------------------------------------------------------- Prestations (étape « Services »)
  { key: 'support_level', step: 'services', type: 'radio', label: 'Quel niveau d’accompagnement souhaitez-vous de PRESTIGIO EVENTS ?', options: {
    full: 'Organisation complète de A à Z', partial: 'Organisation partielle', day_of: 'Coordination uniquement le jour J',
    advice: 'Conseil et accompagnement', some_services: 'Gestion de certains services uniquement',
  } },
  { key: 'extra_needs', step: 'services', type: 'checkbox', label: 'Autres besoins à nous confier', help: 'En complément des prestations cochées ci-dessus.', options: {
    vendors: 'Recherche et gestion des fournisseurs', transport: 'Transport et logistique', guest_mgmt: 'Gestion des invités et placement à table',
  } },

  // ---------------------------------------------------------------- Budget (étape « Budget »)
  { key: 'payer', step: 'budget', type: 'radio', budget: true, label: 'Qui prend principalement en charge les dépenses ?', options: {
    groom: 'Le futur marié', bride: 'La future mariée', both: 'Les deux futurs mariés', families: 'Les deux familles', several: 'Plusieurs personnes contribuent',
  } },
  { key: 'reserve', step: 'budget', type: 'radio', budget: true, label: 'Avez-vous prévu une réserve pour les imprévus ?', options: {
    yes: 'Oui', no: 'Non', tbd: 'À déterminer',
  } },

  // ---------------------------------------------------------------- Traditions et communication
  { key: 'traditions', step: 'exigences', type: 'radio', label: 'Existe-t-il des traditions familiales à respecter ?', options: {
    yes: 'Oui', no: 'Non', tbd: 'À préciser avec les familles',
  } },
  { key: 'traditions_text', step: 'exigences', type: 'textarea', label: 'Précisions sur les traditions', max: 1000 },
  { key: 'requirements', step: 'exigences', type: 'checkbox', label: 'Avez-vous des exigences particulières ?', other: true, options: {
    family_protocol: 'Respect d’un protocole familial', vip: 'Accueil spécial des VIP', religious: 'Contraintes religieuses',
    dietary: 'Contraintes alimentaires', accessibility: 'Accessibilité pour certains invités', autre: 'Autres',
  } },
  { key: 'refusals', step: 'exigences', type: 'textarea', label: 'Y a-t-il des choses que vous refusez absolument dans votre mariage ?', max: 1000 },
  { key: 'main_contact', step: 'exigences', type: 'radio', label: 'Qui sera notre interlocuteur principal pendant l’organisation ?', options: {
    groom: 'Le futur marié', bride: 'La future mariée', both: 'Les deux futurs mariés', family_reps: 'Un représentant de chaque famille', other_person: 'Une autre personne désignée',
  } },
  { key: 'main_contact_details', step: 'exigences', type: 'text', label: 'Nom et contact de l’interlocuteur', max: 200 },
  { key: 'decision_maker', step: 'exigences', type: 'radio', label: 'Qui validera les décisions financières et organisationnelles ?', options: {
    groom: 'Le futur marié', bride: 'La future mariée', both: 'Les deux futurs mariés', parents: 'Les parents', collective: 'Décision collective',
  } },
  { key: 'channels', step: 'exigences', type: 'checkbox', label: 'Quels moyens de communication préférez-vous ?', options: {
    whatsapp: 'WhatsApp', calls: 'Appels téléphoniques', email: 'E-mail', meetings: 'Réunions physiques', whatsapp_group: 'Groupe WhatsApp dédié au projet',
  } },

  // ---------------------------------------------------------------- Attentes
  { key: 'main_expectation', step: 'attentes', type: 'radio', label: 'Quelle est votre principale attente envers PRESTIGIO EVENTS ?', options: {
    stress_free: 'Une organisation sans stress', budget_control: 'Une maîtrise rigoureuse du budget', decoration: 'Une décoration exceptionnelle',
    coordination: 'Une coordination professionnelle', guests: 'Une excellente gestion des invités', full_care: 'Une prise en charge complète',
  } },
  { key: 'success', step: 'attentes', type: 'textarea', label: 'Qu’est-ce qui fera de votre mariage une réussite à vos yeux ?', max: 1500 },
  { key: 'concerns', step: 'attentes', type: 'textarea', label: 'Avez-vous des préoccupations ou des difficultés particulières concernant l’organisation ?', max: 1500 },
  { key: 'readiness', step: 'attentes', type: 'radio', label: 'Êtes-vous prêts à avancer avec une proposition professionnelle de PRESTIGIO EVENTS ?', options: {
    yes: 'Oui', study: 'Nous souhaitons d’abord étudier la proposition', families: 'Nous devons consulter les familles', undecided: 'Nous ne sommes pas encore décidés',
  } },
];

const BY_KEY = Object.fromEntries(Q.map((q) => [q.key, q]));

// Partie interne « Observations de PRESTIGIO EVENTS » (jamais visible du client)
const NEXT_STEPS = {
  proposal: 'Préparer une proposition commerciale',
  estimate: 'Préparer un devis estimatif',
  site_visit: 'Organiser une visite technique',
  second_meeting: 'Organiser un deuxième rendez-vous',
  wait_info: 'Attendre des informations complémentaires',
};

function isWedding(eventType) {
  return WEDDING_EVENT_TYPES.includes(eventType);
}

function questionsFor(step) {
  return Q.filter((q) => q.step === step);
}

const str = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

// Lit les réponses du formulaire (champs `w_<clé>`) en n'acceptant que les
// options prévues. Renvoie uniquement les réponses renseignées.
function parse(body) {
  const out = {};
  for (const q of Q) {
    const name = 'w_' + q.key;
    let v;
    if (q.type === 'radio') {
      v = q.options[body[name]] ? body[name] : null;
    } else if (q.type === 'checkbox') {
      v = [...new Set(arr(body[name]).filter((k) => q.options[k]))];
      if (!v.length) v = null;
    } else if (q.type === 'number') {
      const n = parseInt(body[name], 10);
      v = Number.isInteger(n) && n >= (q.min || 0) && n <= (q.max || 1e6) ? n : null;
    } else {
      v = str(body[name], q.max || 500) || null;
    }
    if (v != null) out[q.key] = v;
    if (q.other) {
      const chosen = q.type === 'radio' ? v === 'autre' : Array.isArray(v) && v.includes('autre');
      const o = chosen ? str(body[name + '_other'], 200) : '';
      if (o) out[q.key + '_other'] = o;
    }
  }
  return out;
}

// Texte lisible d'une réponse.
function answerText(q, data) {
  const v = data[q.key];
  if (v == null) return null;
  const other = data[q.key + '_other'];
  const label = (k) => (k === 'autre' && other ? `Autre : ${other}` : q.options[k] || k);
  if (q.type === 'radio') return label(v);
  if (q.type === 'checkbox') return v.map(label).join(', ');
  return String(v);
}

// Réponses regroupées par étape, pour l'administration.
function display(data, { hideBudget = false } = {}) {
  if (!data) return [];
  const order = ['maries', 'ceremonies', 'lieux', 'style', 'services', 'budget', 'exigences', 'attentes'];
  const titles = { ...Object.fromEntries(Object.entries(STEPS).map(([k, s]) => [k, s.title])), services: 'Prestations attendues', budget: 'Budget' };
  return order.map((step) => ({
    title: titles[step],
    items: questionsFor(step)
      .filter((q) => !(hideBudget && q.budget))
      .map((q) => ({ label: q.label, value: answerText(q, data) }))
      .filter((x) => x.value),
  })).filter((s) => s.items.length);
}

// Correspondance avec les champs généraux de la demande (lieu réservé, recherche de lieu).
function venueFlags(data) {
  switch (data.venues) {
    case 'all_booked': return { venue_booked: 1, wants_venue_search: null };
    case 'some_booked': return { venue_booked: 0, wants_venue_search: null };
    case 'none': return { venue_booked: 0, wants_venue_search: 0 };
    case 'agency': return { venue_booked: 0, wants_venue_search: 1 };
    default: return null;
  }
}

module.exports = { WEDDING_EVENT_TYPES, STEPS, QUESTIONS: Q, BY_KEY, NEXT_STEPS, isWedding, questionsFor, parse, answerText, display, venueFlags };
