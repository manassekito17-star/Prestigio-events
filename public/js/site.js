/* Comportements communs : menu mobile, filtres de galerie, protection contre les doubles envois. */
(function () {
  'use strict';
  var toggle = document.querySelector('[data-nav-toggle]');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var filters = document.querySelector('[data-filters]');
  if (filters) {
    filters.addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]');
      if (!b) return;
      var f = b.getAttribute('data-filter');
      [].forEach.call(filters.children, function (c) { c.classList.toggle('is-active', c === b); });
      [].forEach.call(document.querySelectorAll('[data-gallery] .g-item'), function (it) {
        it.hidden = f !== '*' && it.getAttribute('data-type') !== f;
      });
    });
  }

  // Empêche les soumissions répétées (double clic, réseau lent).
  [].forEach.call(document.querySelectorAll('form[data-once]'), function (form) {
    form.addEventListener('submit', function (e) {
      if (form.getAttribute('data-submitting')) { e.preventDefault(); return; }
      setTimeout(function () {
        if (e.defaultPrevented) return;
        form.setAttribute('data-submitting', '1');
        [].forEach.call(form.querySelectorAll('[type=submit]'), function (b) {
          b.disabled = true;
          b.setAttribute('data-label', b.textContent);
          b.textContent = 'Envoi en cours…';
        });
      }, 0);
    });
  });

  // Confirmation avant les actions sensibles (administration)
  document.addEventListener('submit', function (e) {
    var msg = (e.submitter && e.submitter.getAttribute('data-confirm')) || e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  }, true);
})();
