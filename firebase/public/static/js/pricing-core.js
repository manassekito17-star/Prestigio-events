/*
 * Moteur de calcul des estimations — partagé entre le navigateur (estimation
 * en direct) et le serveur (devis provisoire). Il n'utilise QUE les tarifs
 * qu'on lui fournit : côté visiteur, le catalogue public ne contient pas les
 * montants non publics ou provisoires (ils apparaissent « À confirmer »).
 *
 * Tous les montants sont en centimes (USD).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PricingCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UNIT_LABELS = { event: 'événement', hour: 'heure', day: 'jour' };

  function toInt(v) {
    var n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? null : n;
  }
  function toNum(v) {
    var n = parseFloat(v);
    return isNaN(n) || n < 0 ? null : n;
  }

  function fmt(cents) {
    if (cents == null) return 'À confirmer';
    var v = Math.round(cents) / 100;
    var s = v.toFixed(v % 1 === 0 ? 0 : 2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return s.replace('.', ',') + ' $';
  }

  function hasAmount(t) {
    return t.amount_cents != null && !t.to_confirm;
  }

  // Calcule une ligne pour un tarif donné. Renvoie un tableau (0, 1 ou 2 lignes).
  function linesForTariff(t, ctx, serviceName) {
    var base = {
      tariff_id: t.id,
      service: serviceName || null,
      label: t.name,
      method: t.method,
      qty: 1,
      unit: 'forfait',
      unit_price_cents: hasAmount(t) ? t.amount_cents : null,
      amount_cents: null,
      to_confirm: false,
      provisional: !!t.provisional,
      basis: '',
      reason: '',
    };
    var lines = [base];
    var known = hasAmount(t);

    switch (t.method) {
      case 'fixed':
        base.basis = 'Forfait';
        break;
      case 'rental':
        base.basis = 'Location (forfait)';
        base.unit = 'location';
        break;
      case 'per_person':
        base.unit = 'invité';
        if (ctx.guests == null) { base.to_confirm = true; base.reason = 'Nombre d’invités à préciser'; }
        else { base.qty = ctx.guests; }
        base.basis = 'Prix par invité × nombre d’invités';
        break;
      case 'per_hour':
        base.unit = 'heure';
        if (ctx.hours == null) { base.to_confirm = true; base.reason = 'Durée à préciser'; }
        else { base.qty = Math.max(1, Math.ceil(ctx.hours)); }
        base.basis = 'Prix horaire × durée';
        break;
      case 'per_day':
        base.unit = 'jour';
        base.qty = ctx.hours == null ? 1 : Math.max(1, Math.ceil(ctx.hours / 24));
        base.basis = 'Prix par jour × nombre de jours';
        break;
      case 'per_agent': {
        var unit = t.agent_unit || 'event';
        base.unit = 'agent' + (unit !== 'event' ? ' × ' + UNIT_LABELS[unit] : '');
        base.basis = 'Prix par agent et par ' + UNIT_LABELS[unit] + (t.included_hours ? ' (' + t.included_hours + ' h incluses)' : '');
        if (ctx.agents == null) {
          base.to_confirm = true;
          base.reason = 'Nombre d’agents de protocole à définir';
          break;
        }
        var units = 1;
        if (unit === 'hour') {
          if (ctx.hours == null) { base.to_confirm = true; base.reason = 'Durée à préciser'; break; }
          units = Math.max(1, Math.ceil(ctx.hours));
        } else if (unit === 'day') {
          units = ctx.hours == null ? 1 : Math.max(1, Math.ceil(ctx.hours / 24));
        }
        base.qty = ctx.agents * units;
        base.agents = ctx.agents;
        // Heures supplémentaires au-delà de la durée incluse
        if (unit === 'event' && t.included_hours && t.extra_hour_cents != null && ctx.hours != null && ctx.hours > t.included_hours && ctx.agents > 0) {
          var extraH = Math.ceil(ctx.hours - t.included_hours);
          var extraKnown = !t.to_confirm;
          lines.push({
            tariff_id: t.id,
            service: serviceName || null,
            label: t.name + ' — heures supplémentaires',
            method: 'per_agent_extra',
            qty: ctx.agents * extraH,
            unit: 'agent × heure',
            unit_price_cents: extraKnown ? t.extra_hour_cents : null,
            amount_cents: extraKnown ? ctx.agents * extraH * t.extra_hour_cents : null,
            to_confirm: !extraKnown,
            provisional: !!t.provisional,
            basis: ctx.agents + ' agent(s) × ' + extraH + ' h au-delà des ' + t.included_hours + ' h incluses',
            reason: extraKnown ? '' : 'Tarif à confirmer',
          });
        }
        break;
      }
      case 'on_request':
        base.basis = 'Sur demande';
        base.to_confirm = true;
        base.reason = 'Prix selon disponibilité et conditions du prestataire';
        known = false;
        base.unit_price_cents = null;
        break;
      default:
        return [];
    }

    if (!base.to_confirm) {
      if (known) base.amount_cents = base.qty * base.unit_price_cents;
      else { base.to_confirm = true; base.reason = base.reason || 'Tarif à confirmer'; }
    }
    return lines;
  }

  /*
   * catalog = { services: [{id, name, is_protocol, tariffs: [...]}], globals: [...] }
   * input   = { services: [id], options: [tariffId], guests, hours, agents }
   */
  function estimate(catalog, input) {
    var selected = (input.services || []).map(Number);
    var options = (input.options || []).map(Number);
    var ctx = {
      guests: toInt(input.guests),
      hours: toNum(input.hours),
      agents: input.agents === 'unknown' ? null : toInt(input.agents),
    };
    var lines = [];
    var fees = [];
    var discounts = [];

    (catalog.services || []).forEach(function (s) {
      if (selected.indexOf(Number(s.id)) === -1) return;
      var tariffs = (s.tariffs || []).filter(function (t) {
        return !t.optional || options.indexOf(Number(t.id)) !== -1;
      });
      if (!tariffs.length) {
        lines.push({ tariff_id: null, service: s.name, label: s.name, method: 'on_request', qty: 1, unit: 'forfait',
          unit_price_cents: null, amount_cents: null, to_confirm: true, provisional: false, basis: 'Sur demande', reason: 'Tarif à définir' });
        return;
      }
      tariffs.forEach(function (t) {
        Array.prototype.push.apply(lines, linesForTariff(t, ctx, s.name));
      });
    });

    var subtotal = 0;
    var hasUnconfirmed = false;
    lines.forEach(function (l) {
      if (l.amount_cents != null) subtotal += l.amount_cents;
      if (l.to_confirm) hasUnconfirmed = true;
    });

    if (lines.length) {
      (catalog.globals || []).forEach(function (t) {
        if (t.min_guests && (ctx.guests == null || ctx.guests < t.min_guests)) return;
        if (t.method === 'discount_pct' || t.method === 'discount_fixed') {
          var d = {
            tariff_id: t.id, service: null, label: t.name, method: t.method, qty: 1, unit: 'remise',
            unit_price_cents: null, amount_cents: null, to_confirm: false, provisional: !!t.provisional, basis: '', reason: '',
          };
          if (t.to_confirm) { d.to_confirm = true; d.reason = 'Remise à confirmer'; }
          else if (t.method === 'discount_pct' && t.percent != null) {
            d.basis = t.percent + ' % du sous-total';
            d.amount_cents = Math.round(subtotal * t.percent / 100);
          } else if (t.method === 'discount_fixed' && t.amount_cents != null) {
            d.basis = 'Remise forfaitaire';
            d.amount_cents = t.amount_cents;
          } else { d.to_confirm = true; d.reason = 'Remise à confirmer'; }
          discounts.push(d);
        } else {
          Array.prototype.push.apply(fees, linesForTariff(t, ctx, null));
        }
      });
    }

    var feesTotal = 0;
    fees.forEach(function (l) {
      if (l.amount_cents != null) feesTotal += l.amount_cents;
      if (l.to_confirm) hasUnconfirmed = true;
    });
    var discountTotal = 0;
    discounts.forEach(function (l) {
      if (l.amount_cents != null) discountTotal += l.amount_cents;
    });
    discountTotal = Math.min(discountTotal, subtotal + feesTotal);

    return {
      lines: lines,
      fees: fees,
      discounts: discounts,
      subtotal_cents: subtotal,
      fees_cents: feesTotal,
      discount_cents: discountTotal,
      total_cents: subtotal + feesTotal - discountTotal,
      has_unconfirmed: hasUnconfirmed,
      agents: ctx.agents,
      guests: ctx.guests,
      hours: ctx.hours,
    };
  }

  return { estimate: estimate, fmt: fmt, UNIT_LABELS: UNIT_LABELS };
});
