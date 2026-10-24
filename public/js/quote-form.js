/* Formulaire de devis en plusieurs étapes + estimation en direct. */
(function () {
  'use strict';
  var form = document.getElementById('quote-form');
  if (!form || !window.PricingCore) return;
  var catalog = JSON.parse(document.getElementById('catalog-data').textContent);
  var fmt = PricingCore.fmt;
  var steps = [].slice.call(form.querySelectorAll('[data-step]'));
  var stepper = form.querySelector('[data-stepper]');
  var stepCount = form.querySelector('[data-step-count]');
  var btnPrev = form.querySelector('[data-prev]');
  var btnNext = form.querySelector('[data-next]');
  var btnSubmit = form.querySelector('[data-submit]');
  var current = 1;
  var TOTAL = steps.length;

  function $(sel) { return form.querySelector(sel); }
  function $$(sel) { return [].slice.call(form.querySelectorAll(sel)); }
  function val(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.length && el[0] && (el[0].type === 'radio')) {
      for (var i = 0; i < el.length; i++) if (el[i].checked) return el[i].value;
      return '';
    }
    return (el.value || '').trim();
  }
  function checked(name) {
    return $$('input[name="' + name + '"]:checked').map(function (i) { return i.value; });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // --------------------------------------------------- Protocole
  function protocolSelected() {
    return $$('input[name="services"][data-protocol="1"]:checked').length > 0;
  }
  function agentsValue() {
    if ($('input[name="protocol_unknown_cb"]').checked) return 'unknown';
    var n = parseInt($('#q-agents').value, 10);
    return isNaN(n) ? null : n;
  }
  function protocolTariffText() {
    var svc = catalog.services.filter(function (s) { return s.is_protocol; })[0];
    if (!svc) return '';
    var t = svc.tariffs.filter(function (x) { return x.method === 'per_agent' && !x.optional; })[0];
    if (!t) return '';
    if (t.to_confirm || t.amount_cents == null) return 'Tarif par agent : à confirmer par notre équipe.';
    var u = { event: 'événement', hour: 'heure', day: 'jour' }[t.agent_unit || 'event'];
    return 'Tarif indicatif : ' + fmt(t.amount_cents) + ' par agent et par ' + u + (t.included_hours ? ' (' + t.included_hours + ' h incluses)' : '') + '.';
  }

  // --------------------------------------------------- Affichage conditionnel
  function refreshConditional() {
    $$('[data-show-if]').forEach(function (el) {
      var parts = el.getAttribute('data-show-if').split('=');
      var name = parts[0], v = parts[1];
      var on = checked(name).indexOf(v) !== -1 || val(name) === v;
      el.hidden = !on;
    });
    $$('[data-options-for]').forEach(function (box) {
      var id = box.getAttribute('data-options-for');
      var cb = $('input[name="services"][value="' + id + '"]');
      box.hidden = !cb.checked;
      if (!cb.checked) box.querySelectorAll('input').forEach(function (i) { i.checked = false; });
    });
    var proto = protocolSelected();
    $('[data-protocol-fields]').hidden = !proto;
    $('[data-no-protocol]').hidden = proto;
    var agentsInput = $('#q-agents');
    agentsInput.disabled = $('input[name="protocol_unknown_cb"]').checked;
    $('[data-protocol-tariff]').textContent = protocolTariffText();
    if (stepper) {
      var li = stepper.querySelector('[data-for="4"]');
      li.classList.toggle('is-skipped', !proto);
    }
  }

  // --------------------------------------------------- Estimation
  function input() {
    return {
      services: checked('services'),
      options: checked('options'),
      guests: val('guests'),
      hours: val('duration_hours'),
      agents: protocolSelected() ? agentsValue() : null,
    };
  }

  function lineHtml(l, sign) {
    var amount = l.amount_cents == null ? '<span class="tc">À confirmer</span>' : (sign || '') + fmt(l.amount_cents);
    var detail = [];
    if (l.amount_cents != null && l.qty > 1 && l.unit_price_cents != null) detail.push(l.qty + ' × ' + fmt(l.unit_price_cents) + ' (' + l.unit + ')');
    else if (l.basis) detail.push(l.basis);
    if (l.reason) detail.push(l.reason);
    var label = l.service && l.label !== l.service ? l.service + ' — ' + l.label : l.label;
    return '<li><div><span class="l-label">' + esc(label) + '</span>' + (detail.length ? '<small>' + esc(detail.join(' · ')) + '</small>' : '') +
      '</div><span class="l-amt">' + amount + '</span></li>';
  }

  var lastEst = null;
  function renderEstimate() {
    var est = PricingCore.estimate(catalog, input());
    lastEst = est;
    var box = document.querySelector('[data-est-lines]');
    var totalEl = document.querySelector('[data-est-total]');
    if (!est.lines.length) {
      box.innerHTML = '<p class="muted small">Sélectionnez des services pour voir l’estimation.</p>';
      totalEl.textContent = '—';
      return est;
    }
    var html = '<ul class="est-lines">' + est.lines.map(function (l) { return lineHtml(l); }).join('') + '</ul>';
    html += '<div class="est-row"><span>Sous-total</span><span>' + fmt(est.subtotal_cents) + '</span></div>';
    if (est.fees.length) html += '<ul class="est-lines fees">' + est.fees.map(function (l) { return lineHtml(l); }).join('') + '</ul>';
    if (est.discounts.length) html += '<ul class="est-lines disc">' + est.discounts.map(function (l) { return lineHtml(l, '− '); }).join('') + '</ul>';
    if (est.agents) html += '<p class="small">Agents de protocole : <strong>' + est.agents + '</strong></p>';
    var anyKnown = est.total_cents > 0;
    html += '<div class="est-total"><span>Total estimatif</span><strong>' + (anyKnown ? fmt(est.total_cents) : 'À confirmer') + '</strong></div>';
    if (est.has_unconfirmed && anyKnown) html += '<p class="small tc">+ éléments à confirmer</p>';
    box.innerHTML = html;
    totalEl.textContent = anyKnown ? fmt(est.total_cents) + (est.has_unconfirmed ? ' +' : '') : 'À confirmer';
    return est;
  }

  // --------------------------------------------------- Validation par étape
  function setErr(name, msg) {
    var p = form.querySelector('[data-err="' + name + '"]');
    if (p) p.textContent = msg || '';
    return !msg;
  }
  function validate(step) {
    var ok = true;
    function check(name, msg) { if (!setErr(name, msg)) ok = false; }
    if (step === 1) {
      var t = val('event_type');
      check('event_type', !t ? 'Choisissez un type d’événement.' : (t === 'autre' && !val('event_type_other') ? 'Précisez le type d’événement.' : ''));
    }
    if (step === 2) {
      var d = val('event_date');
      var today = new Date().toISOString().slice(0, 10);
      check('event_date', d && d < today ? 'La date doit être dans le futur.' : '');
      var h = val('duration_hours');
      check('duration_hours', h && (isNaN(parseFloat(h)) || parseFloat(h) <= 0 || parseFloat(h) > 240) ? 'Durée invalide.' : '');
      var g = val('guests');
      check('guests', g && !(parseInt(g, 10) >= 1) ? 'Nombre d’invités invalide.' : '');
    }
    if (step === 4 && protocolSelected()) {
      var a = agentsValue();
      check('protocol_agents', a === null || (a !== 'unknown' && (a < 1 || a > 500)) ? 'Indiquez le nombre d’agents ou cochez « Je ne sais pas encore ».' : '');
    }
    if (step === 5) {
      var m = val('budget_mode');
      check('budget', m === 'range' && !val('budget_range') ? 'Choisissez une fourchette.' : m === 'exact' && !(parseFloat(val('budget_amount').replace(',', '.')) > 0) ? 'Indiquez un montant valide.' : '');
    }
    if (step === 6) {
      check('client_name', !val('client_name') ? 'Indiquez votre nom.' : '');
      var digits = val('client_phone').replace(/[^\d]/g, '');
      check('client_phone', digits.length < 8 || digits.length > 15 ? 'Indiquez un numéro de téléphone ou WhatsApp valide.' : '');
      var e = val('client_email');
      check('client_email', e && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? 'Adresse e-mail invalide.' : '');
      check('consent', !$('input[name="consent"]').checked ? 'Votre accord est nécessaire pour que nous puissions vous recontacter.' : '');
    }
    return ok;
  }

  // --------------------------------------------------- Résumé
  function labelOf(name) {
    var i = $('input[name="' + name + '"]:checked');
    return i ? i.parentNode.textContent.trim() : '';
  }
  function renderSummary() {
    var est = renderEstimate();
    var rows = [];
    var type = val('event_type') === 'autre' ? val('event_type_other') : labelOf('event_type');
    rows.push(['Type d’événement', type]);
    rows.push(['Date', val('event_date') ? new Date(val('event_date') + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'À préciser']);
    if (val('start_time')) rows.push(['Heure de début', val('start_time')]);
    if (val('duration_hours')) rows.push(['Durée estimée', val('duration_hours') + ' h']);
    rows.push(['Invités', val('guests') || 'À préciser']);
    if (val('location_area')) rows.push(['Commune / quartier', val('location_area')]);
    var vb = val('venue_booked');
    if (vb) rows.push(['Lieu réservé', vb === 'oui' ? 'Oui' : 'Non' + (val('wants_venue_search') === 'oui' ? ' — recherche de lieu souhaitée' : '')]);
    var svcs = $$('input[name="services"]:checked').map(function (i) { return i.parentNode.textContent.trim(); });
    rows.push(['Services', svcs.length ? svcs.join(', ') : 'Aucun service sélectionné']);
    var opts = $$('input[name="options"]:checked').map(function (i) { return i.parentNode.textContent.replace('(option)', '').trim(); });
    if (opts.length) rows.push(['Options', opts.join(', ')]);
    if (protocolSelected()) {
      var a = agentsValue();
      rows.push(['Agents de protocole', a === 'unknown' ? 'Je ne sais pas encore' : a]);
      var tasks = $$('input[name="protocol_tasks"]:checked').map(function (i) { return i.parentNode.textContent.trim(); });
      if (tasks.length) rows.push(['Tâches du protocole', tasks.join(', ') + (val('protocol_tasks_other') ? ' (' + val('protocol_tasks_other') + ')' : '')]);
    }
    var bm = val('budget_mode');
    rows.push(['Budget', bm === 'unknown' ? 'Non défini' : bm === 'range' ? (form.elements.budget_range.selectedOptions[0] || {}).textContent : val('budget_amount') + ' $']);
    rows.push(['Nom', val('client_name')]);
    rows.push(['Téléphone / WhatsApp', val('client_phone')]);
    if (val('client_email')) rows.push(['E-mail', val('client_email')]);
    if (val('client_notes')) rows.push(['Notes', val('client_notes')]);
    var html = '<dl class="sum-list">' + rows.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';
    if (est.lines.length) {
      html += '<h3 class="h4">Estimation indicative</h3><div class="est-copy">' + document.querySelector('[data-est-lines]').innerHTML + '</div>';
    }
    html += '<p class="small"><a href="#" data-goto="1">Modifier mes réponses</a></p>';
    $('[data-summary]').innerHTML = html;
  }

  // --------------------------------------------------- Navigation
  function next(from) {
    var n = from + 1;
    if (n === 4 && !protocolSelected()) n = 5;
    return Math.min(n, TOTAL);
  }
  function prev(from) {
    var n = from - 1;
    if (n === 4 && !protocolSelected()) n = 3;
    return Math.max(n, 1);
  }
  function show(n, focus) {
    current = n;
    steps.forEach(function (s) { s.hidden = Number(s.getAttribute('data-step')) !== n; });
    btnPrev.hidden = n === 1;
    btnNext.hidden = n === TOTAL;
    btnSubmit.hidden = n !== TOTAL;
    if (stepper) {
      [].forEach.call(stepper.children, function (li) {
        var k = Number(li.getAttribute('data-for'));
        li.classList.toggle('is-current', k === n);
        li.classList.toggle('is-done', k < n);
        li.setAttribute('aria-current', k === n ? 'step' : 'false');
      });
    }
    stepCount.textContent = 'Étape ' + n + ' sur ' + TOTAL;
    if (n === TOTAL) renderSummary();
    if (focus) {
      var legend = steps[n - 1].querySelector('legend');
      legend.setAttribute('tabindex', '-1');
      legend.focus({ preventScroll: true });
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  btnNext.addEventListener('click', function () {
    if (!validate(current)) return;
    show(next(current), true);
  });
  btnPrev.addEventListener('click', function () { show(prev(current), true); });
  form.addEventListener('click', function (e) {
    var g = e.target.closest('[data-goto]');
    if (g) { e.preventDefault(); show(Number(g.getAttribute('data-goto')), true); }
    var q = e.target.closest('[data-qty]');
    if (q) {
      var inp = $('#q-agents');
      var v = parseInt(inp.value, 10) || 0;
      inp.value = Math.max(1, Math.min(500, v + Number(q.getAttribute('data-qty'))));
      update();
    }
  });
  if (stepper) {
    stepper.addEventListener('click', function (e) {
      var li = e.target.closest('[data-for]');
      if (!li) return;
      var k = Number(li.getAttribute('data-for'));
      if (k < current) show(k === 4 && !protocolSelected() ? 3 : k, true);
    });
  }

  form.addEventListener('submit', function (e) {
    for (var i = 1; i <= TOTAL; i++) {
      if (!validate(i)) { e.preventDefault(); show(i, true); form.removeAttribute('data-submitting'); return; }
    }
  });

  function update() { refreshConditional(); renderEstimate(); }
  form.addEventListener('change', update);
  form.addEventListener('input', function (e) {
    if (['guests', 'duration_hours', 'protocol_agents_n'].indexOf(e.target.name) !== -1) update();
  });

  // Estimation repliable sur mobile
  var toggle = document.querySelector('[data-estimate-toggle]');
  if (toggle) toggle.addEventListener('click', function () {
    document.querySelector('[data-estimate]').classList.toggle('is-open');
  });

  // Activation du mode « étapes »
  form.classList.add('is-stepped');
  stepper.hidden = false;
  stepCount.hidden = false;
  update();
  var firstErr = form.querySelector('.alert-err') ? 1 : 1;
  show(firstErr, false);
})();
