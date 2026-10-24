'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimate } = require('../public/js/pricing-core');

const T = (o) => ({ optional: 0, to_confirm: false, provisional: false, ...o });
const catalog = {
  services: [
    { id: 1, name: 'Décoration', tariffs: [T({ id: 10, name: 'Déco', method: 'per_person', amount_cents: 800 }), T({ id: 11, name: 'Arche', method: 'fixed', amount_cents: 25000, optional: 1 })] },
    { id: 2, name: 'DJ', tariffs: [T({ id: 20, name: 'DJ', method: 'fixed', amount_cents: 25000 })] },
    { id: 3, name: 'Protocole', is_protocol: 1, tariffs: [T({ id: 30, name: 'Agent', method: 'per_agent', agent_unit: 'event', included_hours: 6, amount_cents: 3000, extra_hour_cents: 500 })] },
    { id: 4, name: 'Salle', tariffs: [T({ id: 40, name: 'Location', method: 'on_request', amount_cents: null })] },
    { id: 5, name: 'Sono horaire', tariffs: [T({ id: 50, name: 'Technicien', method: 'per_hour', amount_cents: 2000 })] },
    { id: 6, name: 'Photo', tariffs: [T({ id: 60, name: 'Photographe', method: 'fixed', amount_cents: null, to_confirm: true })] },
  ],
  globals: [T({ id: 90, name: 'Transport', method: 'fixed', amount_cents: 3000 }), T({ id: 91, name: 'Remise 5 %', method: 'discount_pct', percent: 5, min_guests: 300 })],
};

test('per-person prices use the guest count; fixed prices do not', () => {
  const e = estimate(catalog, { services: [1, 2], guests: 100, hours: 5 });
  const deco = e.lines.find((l) => l.tariff_id === 10);
  const dj = e.lines.find((l) => l.tariff_id === 20);
  assert.equal(deco.amount_cents, 100 * 800);
  assert.equal(dj.amount_cents, 25000, 'a fixed price is never multiplied by guests');
  assert.equal(e.subtotal_cents, 80000 + 25000);
  assert.equal(e.fees_cents, 3000);
  assert.equal(e.total_cents, 108000);
});

test('optional extras only apply when ticked', () => {
  assert.equal(estimate(catalog, { services: [1], guests: 10 }).lines.length, 1);
  assert.equal(estimate(catalog, { services: [1], options: [11], guests: 10 }).lines.length, 2);
});

test('protocol agents: rate × agents, plus overtime beyond included hours', () => {
  const e = estimate(catalog, { services: [3], agents: 6, hours: 8 });
  const base = e.lines.find((l) => l.method === 'per_agent');
  const extra = e.lines.find((l) => l.method === 'per_agent_extra');
  assert.equal(base.qty, 6);
  assert.equal(base.amount_cents, 6 * 3000);
  assert.equal(extra.qty, 6 * 2);
  assert.equal(extra.amount_cents, 6 * 2 * 500);
});

test('unknown number of agents → "À confirmer" instead of an invented amount', () => {
  const e = estimate(catalog, { services: [3], agents: 'unknown', hours: 4 });
  assert.equal(e.lines[0].amount_cents, null);
  assert.equal(e.lines[0].to_confirm, true);
  assert.equal(e.has_unconfirmed, true);
});

test('on-request and unconfirmed tariffs are never priced', () => {
  const e = estimate(catalog, { services: [4, 6], guests: 50 });
  assert.ok(e.lines.every((l) => l.amount_cents === null && l.to_confirm));
  assert.equal(e.subtotal_cents, 0);
});

test('hourly price needs a duration', () => {
  assert.equal(estimate(catalog, { services: [5] }).lines[0].to_confirm, true);
  assert.equal(estimate(catalog, { services: [5], hours: 3.5 }).lines[0].amount_cents, 4 * 2000);
});

test('conditional discount applies only above the guest threshold', () => {
  assert.equal(estimate(catalog, { services: [2], guests: 100 }).discount_cents, 0);
  const e = estimate(catalog, { services: [2], guests: 300 });
  assert.equal(e.discount_cents, Math.round(25000 * 0.05));
  assert.equal(e.total_cents, 25000 + 3000 - 1250);
});

test('no services → no fees, empty estimate', () => {
  const e = estimate(catalog, { services: [] });
  assert.equal(e.total_cents, 0);
  assert.equal(e.fees.length, 0);
});
