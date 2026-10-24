'use strict';
// Construction du catalogue de tarifs pour le calculateur.
//  - publicCatalog() : ce que reçoit le navigateur du visiteur. Les montants
//    non publics, provisoires ou non renseignés sont retirés et remplacés par
//    to_confirm = true. Les notes internes ne sont jamais incluses.
//  - internalCatalog() : utilisé côté serveur pour le devis provisoire, avec
//    tous les montants (les tarifs provisoires sont signalés).
const db = require('../db');
const { today } = require('./util');

function validTariffs(d) {
  return db.get().prepare(`SELECT * FROM tariffs
    WHERE active = 1 AND (valid_from IS NULL OR valid_from = '' OR valid_from <= @d)
      AND (valid_to IS NULL OR valid_to = '' OR valid_to >= @d)
    ORDER BY sort_order, id`).all({ d });
}

function formServices() {
  return db.get().prepare(`SELECT id, slug, name, form_label, is_protocol FROM services
    WHERE published = 1 AND in_quote_form = 1 ORDER BY sort_order, id`).all();
}

function publicTariff(t) {
  const priced = t.public_price === 1 && t.provisional === 0 && t.amount_cents != null && t.method !== 'on_request';
  const out = {
    id: t.id,
    name: t.name,
    method: t.method,
    agent_unit: t.agent_unit,
    included_hours: t.included_hours,
    optional: t.optional,
    min_guests: t.min_guests,
    conditions: t.conditions || '',
    to_confirm: !priced,
    amount_cents: priced ? t.amount_cents : null,
    extra_hour_cents: priced ? t.extra_hour_cents : null,
    percent: t.public_price === 1 && t.provisional === 0 ? t.percent : null,
  };
  if (t.method === 'discount_pct') out.to_confirm = !(t.public_price === 1 && t.provisional === 0 && t.percent != null);
  return out;
}

function internalTariff(t) {
  return {
    id: t.id, name: t.name, method: t.method, agent_unit: t.agent_unit, included_hours: t.included_hours,
    optional: t.optional, min_guests: t.min_guests, conditions: t.conditions || '',
    to_confirm: false, provisional: t.provisional === 1,
    amount_cents: t.amount_cents, extra_hour_cents: t.extra_hour_cents, percent: t.percent,
  };
}

function build(map, d = today()) {
  const tariffs = validTariffs(d);
  const services = formServices().map((s) => ({
    id: s.id, slug: s.slug, name: s.form_label || s.name, is_protocol: s.is_protocol,
    tariffs: tariffs.filter((t) => t.scope === 'service' && t.service_id === s.id).map(map),
  }));
  const globals = tariffs.filter((t) => t.scope === 'global').map(map);
  return { services, globals };
}

module.exports = {
  publicCatalog: (d) => build(publicTariff, d),
  internalCatalog: (d) => build(internalTariff, d),
  publicTariff,
  validTariffs,
};
