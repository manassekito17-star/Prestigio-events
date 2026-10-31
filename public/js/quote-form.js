/* Formulaire de devis en plusieurs étapes + estimation en direct.
 * Les étapes marquées data-when="wedding" (fiche de découverte mariage) ou
 * data-when="protocol" ne s'affichent que lorsque leur condition est remplie. */
(function () {
  'use strict';
  var form = document.getElementById('quote-form');
  if (!form || !window.PricingCore) return;
  var catalog = JSON.parse(document.getElementById('catalog-data').textContent);
  var fmt = PricingCore.fmt;
  var steps = [].slice.call(form.querySelectorAll('[data-step]'));
  var btnPrev = form.querySelector('[data-prev]');
  var btnNext = form.querySelector('[data-next]');
  var btnSubmit = form.querySelector('[data-submit]');
  var progress = form.querySelector('[data-progress]');
  var WEDDING_TYPES = ['mariage'];
  var current = steps[0];

  function $(sel) { return form.querySelector(sel); }
  function $$(sel) { return [].slice.call(form.querySelectorAll(sel)); }
  function val(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.length && el[0] && el[0].type === 'radio') {
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
  function labelText(input) {
    var span = input.parentNode.querySelector('span');
    return (span ? span.textContent : input.parentNode.textContent).replace('(option)', '').trim();
  }

  // --------------------------------------------------- Conditions
  function isWedding() { return WEDDING_TYPES.indexOf(val('event_type')) !== -1; }
  function protocolSelected() { return $$('input[name="services"][data-protocol="1"]:checked').length > 0; }
  function isActive(step) {
    var w = step.getAttribute('data-when');
    if (w === 'wedding') return isWedding();
    if (w === 'protocol') return protocolSelected();
    return true;
  }
  function activeSteps() { return steps.filter(isActive); }

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
    var wedding = isWedding();
    form.classList.toggle('is-wedding', wedding);
    $$('[data-when-block="wedding"]').forEach(function (el) { el.hidden = !wedding; });
    $$('[data-unless="wedding"]').forEach(function (el) { el.hidden = wedding; });
    $$('[data-show-if]').forEach(function (el) {
      var parts = el.getAttribute('data-show-if').split('=');
      el.hidden = !(checked(parts[0]).indexOf(parts[1]) !== -1 || val(parts[0]) === parts[1]);
    });
    $$('[data-options-for]').forEach(function (box) {
      var cb = $('input[name="services"][value="' + box.getAttribute('data-options-for') + '"]');
      box.hidden = !cb.checked;
      if (!cb.checked) box.querySelectorAll('input').forEach(function (i) { i.checked = false; });
    });
    $('#q-agents').disabled = $('input[name="protocol_unknown_cb"]').checked;
    $('[data-protocol-tariff]').textContent = protocolTariffText();
    // Fourchettes exprimées en USD uniquement
    var cdf = val('budget_currency') === 'CDF';
    var rangeChoice = $('[data-range-choice]');
    rangeChoice.hidden = cdf;
    if (cdf && val('budget_mode') === 'range') $('input[name="budget_mode"][value="exact"]').checked = true;
    $('[data-cur-label]').textContent = cdf ? 'CDF' : 'USD';
    updateProgress();
  }

  // Niveau d'accompagnement → présélection de la prestation correspondante.
  var SUPPORT_TO_SERVICE = { full: 'conception-coordination', day_of: 'coordination-jour-j' };
  function applySupportLevel() {
    var wanted = SUPPORT_TO_SERVICE[val('w_support_level')];
    $$('input[name="services"][data-auto]').forEach(function (cb) {
      if (cb.getAttribute('data-slug') !== wanted) { cb.checked = false; cb.removeAttribute('data-auto'); }
    });
    if (!wanted) return;
    var cb = $('input[name="services"][data-slug="' + wanted + '"]');
    if (cb && !cb.checked) { cb.checked = true; cb.setAttribute('data-auto', '1'); }
  }

  // Invités côté marié + côté mariée → nombre total (si non saisi à la main).
  var guestsInput = $('#q-guests');
  function applyGuestSum() {
    if (guestsInput.getAttribute('data-manual')) return;
    var g = parseInt(val('w_guests_groom'), 10) || 0;
    var b = parseInt(val('w_guests_bride'), 10) || 0;
    if (g + b > 0) guestsInput.value = g + b;
  }

  // --------------------------------------------------- Estimation
  function input() {
    return {
      services: checked('services'), options: checked('options'),
      guests: val('guests'), hours: val('duration_hours'),
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
  function renderEstimate() {
    var est = PricingCore.estimate(catalog, input());
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

  // --------------------------------------------------- Validation
  function setErr(name, msg) {
    var p = form.querySelector('[data-err="' + name + '"]');
    if (p) p.textContent = msg || '';
    return !msg;
  }
  function validate(step) {
    var id = step.getAttribute('data-step');
    var ok = true;
    function check(name, msg) { if (!setErr(name, msg)) ok = false; }
    if (id === 'type') {
      var t = val('event_type');
      check('event_type', !t ? 'Choisissez un type d’événement.' : (t === 'autre' && !val('event_type_other') ? 'Précisez le type d’événement.' : ''));
    }
    if (id === 'infos') {
      var d = val('event_date');
      check('event_date', d && d < new Date().toISOString().slice(0, 10) ? 'La date doit être dans le futur.' : '');
      var h = val('duration_hours');
      check('duration_hours', h && (isNaN(parseFloat(h)) || parseFloat(h) <= 0 || parseFloat(h) > 240) ? 'Durée invalide.' : '');
      var g = val('guests');
      check('guests', g && !(parseInt(g, 10) >= 1) ? 'Nombre d’invités invalide.' : '');
    }
    if (id === 'lieux') {
      ['w_guests_groom', 'w_guests_bride'].forEach(function (n) {
        var v = val(n);
        check(n, v && !(parseInt(v, 10) >= 0) ? 'Nombre invalide.' : '');
      });
    }
    if (id === 'protocol') {
      var a = agentsValue();
      check('protocol_agents', a === null || (a !== 'unknown' && (a < 1 || a > 500)) ? 'Indiquez le nombre d’agents ou cochez « Je ne sais pas encore ».' : '');
    }
    if (id === 'budget') {
      var m = val('budget_mode');
      check('budget', m === 'range' && !val('budget_range') ? 'Choisissez une fourchette.' : m === 'exact' && !(parseFloat(val('budget_amount').replace(/\s/g, '').replace(',', '.')) > 0) ? 'Indiquez un montant valide.' : '');
    }
    if (id === 'contact') {
      check('client_name', !val('client_name') ? 'Indiquez votre nom.' : '');
      var digits = val('client_phone').replace(/[^\d]/g, '');
      check('client_phone', digits.length < 8 || digits.length > 15 ? 'Indiquez un numéro de téléphone ou WhatsApp valide.' : '');
      var e = val('client_email');
      check('client_email', e && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? 'Adresse e-mail invalide.' : '');
      check('consent', !$('input[name="consent"]').checked ? 'Votre accord est nécessaire pour que nous puissions vous recontacter.' : '');
    }
    return ok;
  }

  // --------------------------------------------------- Résumé (par étape, avec « Modifier »)
  // Visible dans son étape (les étapes elles-mêmes sont masquées hors de l'étape courante).
  function isShown(el) {
    for (var n = el; n && n !== form && !n.hasAttribute('data-step'); n = n.parentNode) if (n.hidden) return false;
    return true;
  }
  function answerOf(wrap) {
    if (wrap.getAttribute('data-sum-kind') === 'agents') {
      var a = agentsValue();
      return a === 'unknown' ? 'Je ne sais pas encore' : a ? String(a) : '';
    }
    var choices = [].slice.call(wrap.querySelectorAll('input[type=radio]:checked, input[type=checkbox]:checked'))
      .filter(function (i) { return !i.closest('.q-other'); });
    var parts = choices.map(function (i) {
      if (i.value === 'autre') {
        var o = wrap.querySelector('.q-other input');
        if (o && o.value.trim()) return 'Autre : ' + o.value.trim();
      }
      return labelText(i);
    });
    if (wrap.getAttribute('data-q') === 'services') {
      $$('input[name="options"]:checked').forEach(function (i) { parts.push(labelText(i) + ' (option)'); });
    }
    var sel = wrap.querySelector('select');
    if (sel && sel.value) parts.push(sel.selectedOptions[0].textContent.trim());
    var txt = wrap.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=button]), textarea');
    if (!choices.length && txt && !txt.closest('.q-other') && txt.value.trim()) {
      var v = txt.value.trim();
      if (txt.type === 'date') v = new Date(v + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      parts.push(v);
    }
    return parts.join(', ');
  }
  function renderSummary() {
    renderEstimate();
    var html = '';
    activeSteps().forEach(function (step) {
      var id = step.getAttribute('data-step');
      if (id === 'summary') return;
      var rows = [].slice.call(step.querySelectorAll('[data-q]')).filter(isShown).map(function (w) {
        var a = answerOf(w);
        return a ? '<div><dt>' + esc(w.getAttribute('data-label')) + '</dt><dd>' + esc(a) + '</dd></div>' : '';
      }).join('');
      if (!rows) return;
      html += '<section class="sum-sec"><header><h3 class="h4">' + esc(step.querySelector('legend').textContent) +
        '</h3><a href="#" class="sum-edit" data-goto="' + id + '">Modifier</a></header><dl class="sum-list">' + rows + '</dl></section>';
    });
    var est = document.querySelector('[data-est-lines]');
    if (est && est.querySelector('.est-lines')) {
      html += '<section class="sum-sec"><header><h3 class="h4">Estimation indicative</h3></header><div class="est-copy">' + est.innerHTML + '</div></section>';
    }
    $('[data-summary]').innerHTML = html || '<p class="muted">Aucune information saisie.</p>';
  }

  // --------------------------------------------------- Navigation
  function updateProgress() {
    var list = activeSteps();
    var i = list.indexOf(current);
    if (i < 0) return;
    $('[data-progress-fill]').style.width = Math.round(((i + 1) / list.length) * 100) + '%';
    $('[data-progress-count]').textContent = 'Étape ' + (i + 1) + ' sur ' + list.length;
    $('[data-progress-title]').textContent = current.querySelector('legend').textContent;
  }
  function show(step, focus) {
    current = step;
    var estBox = document.querySelector('[data-estimate]');
    if (estBox) estBox.classList.remove('is-open');
    steps.forEach(function (s) { s.hidden = s !== step; });
    var list = activeSteps();
    var i = list.indexOf(step);
    btnPrev.hidden = i <= 0;
    btnNext.hidden = i === list.length - 1;
    btnSubmit.hidden = i !== list.length - 1;
    if (step.getAttribute('data-step') === 'summary') renderSummary();
    updateProgress();
    if (focus) {
      var legend = step.querySelector('legend');
      legend.setAttribute('tabindex', '-1');
      legend.focus({ preventScroll: true });
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  function move(delta) {
    var list = activeSteps();
    var i = list.indexOf(current);
    show(list[Math.max(0, Math.min(list.length - 1, i + delta))], true);
  }

  btnNext.addEventListener('click', function () { if (validate(current)) move(1); });
  btnPrev.addEventListener('click', function () { move(-1); });
  form.addEventListener('click', function (e) {
    var g = e.target.closest('[data-goto]');
    if (g) {
      e.preventDefault();
      var target = steps.filter(function (s) { return s.getAttribute('data-step') === g.getAttribute('data-goto'); })[0];
      if (target) show(target, true);
    }
    var q = e.target.closest('[data-qty]');
    if (q) {
      var inp = $('#q-agents');
      inp.value = Math.max(1, Math.min(500, (parseInt(inp.value, 10) || 0) + Number(q.getAttribute('data-qty'))));
      update();
    }
  });

  form.addEventListener('submit', function (e) {
    var list = activeSteps();
    for (var i = 0; i < list.length; i++) {
      if (!validate(list[i])) { e.preventDefault(); show(list[i], true); return; }
    }
  });

  function update() { refreshConditional(); renderEstimate(); }
  form.addEventListener('change', function (e) {
    var n = e.target.name;
    if (n === 'w_support_level') applySupportLevel();
    if (n === 'services') e.target.removeAttribute('data-auto');
    update();
  });
  form.addEventListener('input', function (e) {
    var n = e.target.name;
    if (n === 'guests') guestsInput.setAttribute('data-manual', '1');
    if (n === 'w_guests_groom' || n === 'w_guests_bride') applyGuestSum();
    if (['guests', 'duration_hours', 'protocol_agents_n', 'w_guests_groom', 'w_guests_bride'].indexOf(n) !== -1) update();
  });
  if (guestsInput.value) guestsInput.setAttribute('data-manual', '1');

  // Estimation repliable sur mobile
  var toggle = document.querySelector('[data-estimate-toggle]');
  if (toggle) toggle.addEventListener('click', function () {
    document.querySelector('[data-estimate]').classList.toggle('is-open');
  });

  // Activation du mode « étapes »
  form.classList.add('is-stepped');
  progress.hidden = false;
  update();
  show(steps[0], false);
})();
