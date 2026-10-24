/* Administration : recalcul instantané de l'éditeur de devis, ajout de lignes. */
(function () {
  'use strict';
  var form = document.querySelector('[data-quote-editor]');
  if (!form) return;
  var tbody = form.querySelector('[data-lines]');
  function money(c) {
    if (c == null) return 'À confirmer';
    return (Math.round(c) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' $';
  }
  function parse(v) {
    var s = String(v || '').replace(/[\s $]/g, '').replace(',', '.');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
  }
  function recompute() {
    var sub = 0, fees = 0, disc = 0, unconf = false;
    [].forEach.call(tbody.querySelectorAll('tr'), function (tr) {
      var label = tr.querySelector('[name=l_label]').value.trim();
      var qty = Number(String(tr.querySelector('[name=l_qty]').value || '1').replace(',', '.')) || 0;
      var pu = parse(tr.querySelector('[name=l_price]').value);
      var conf = tr.querySelector('[name=l_confirm]').value === '1' || pu == null;
      var kind = tr.querySelector('[name=l_kind]').value;
      var amt = conf ? null : Math.round(qty * pu);
      tr.querySelector('[data-amt]').textContent = label ? (kind === 'discount' && amt != null ? '− ' : '') + money(amt) : '';
      tr.classList.toggle('flag-conf', !!label && conf);
      if (!label) return;
      if (amt == null) { unconf = true; return; }
      if (kind === 'fee') fees += amt; else if (kind === 'discount') disc += amt; else sub += amt;
    });
    disc = Math.min(disc, sub + fees);
    form.querySelector('[data-t-sub]').textContent = money(sub);
    form.querySelector('[data-t-fees]').textContent = money(fees);
    form.querySelector('[data-t-disc]').textContent = '− ' + money(disc);
    form.querySelector('[data-t-total]').textContent = money(sub + fees - disc) + (unconf ? ' + à confirmer' : '');
  }
  form.addEventListener('input', recompute);
  form.addEventListener('change', recompute);
  form.addEventListener('click', function (e) {
    if (e.target.closest('[data-add-line]')) {
      e.preventDefault();
      var tpl = form.querySelector('[data-line-template]');
      var row = tpl.content.firstElementChild.cloneNode(true);
      tbody.appendChild(row);
      row.querySelector('[name=l_label]').focus();
    }
    if (e.target.closest('[data-del-line]')) {
      e.preventDefault();
      e.target.closest('tr').remove();
      recompute();
    }
    if (e.target.closest('[data-add-tariff]')) {
      e.preventDefault();
      var sel = form.querySelector('[data-tariff-select]');
      var opt = sel.selectedOptions[0];
      if (!opt || !opt.value) return;
      var tpl2 = form.querySelector('[data-line-template]');
      var r = tpl2.content.firstElementChild.cloneNode(true);
      r.querySelector('[name=l_label]').value = opt.getAttribute('data-label');
      r.querySelector('[name=l_price]').value = opt.getAttribute('data-price') || '';
      r.querySelector('[name=l_unit]').value = opt.getAttribute('data-unit') || 'forfait';
      r.querySelector('[name=l_tariff]').value = opt.value;
      r.querySelector('[name=l_prov]').value = opt.getAttribute('data-prov') || '0';
      if (!opt.getAttribute('data-price')) r.querySelector('[name=l_confirm]').value = '1';
      tbody.appendChild(r);
      recompute();
    }
  });
  recompute();
})();
