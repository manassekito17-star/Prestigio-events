/* Aperçu statique : navigation entre les pages par #ancre et formulaires en mode démonstration. */
(function () {
  'use strict';
  var pages = [].slice.call(document.querySelectorAll('.pg'));
  var navLinks = [].slice.call(document.querySelectorAll('.nav a'));

  function show(id, scroll) {
    var target = document.getElementById('pg-' + id) || document.getElementById('pg-accueil');
    pages.forEach(function (p) { p.hidden = p !== target; });
    var page = target.getAttribute('data-page');
    document.title = (page === 'accueil' ? '' : target.getAttribute('data-title') + ' — ') + 'PRESTIGIO EVENTS';
    navLinks.forEach(function (a) {
      var h = (a.getAttribute('href') || '').slice(1);
      var on = h === page || (page.indexOf('service-') === 0 && h === 'services');
      if (on && !a.classList.contains('btn')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.classList.remove('nav-open');
    if (scroll !== false) window.scrollTo(0, 0);
  }

  function current() { return (location.hash || '#accueil').slice(1) || 'accueil'; }
  window.addEventListener('hashchange', function () { show(current()); });
  show(current(), false);

  // Lien « Demander un devis » depuis un service : présélectionne ce service.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-service]');
    if (!a) return;
    var cb = document.querySelector('#quote-form input[name="services"][value="' + a.getAttribute('data-service') + '"]');
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  function demoRef() {
    var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)];
    return 'PE-DEMO-' + s;
  }

  // Formulaire de devis : après la validation des étapes, on affiche l'accusé de réception sans rien envoyer.
  var qf = document.getElementById('quote-form');
  if (qf) {
    var note = document.createElement('p');
    note.className = 'demo-note';
    note.textContent = 'Démonstration : les prix affichés sont les tarifs de départ provisoires, à vérifier. Sur le site réel, ils apparaissent « À confirmer » tant que vous ne les avez pas validés dans l’administration.';
    qf.insertBefore(note, qf.firstChild);
    qf.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      e.preventDefault();
      var name = (qf.elements.client_name.value || '').trim();
      var box = document.createElement('div');
      box.className = 'narrow center';
      box.innerHTML = '<div class="success-mark" aria-hidden="true">✓</div><h2 class="h1">Demande reçue</h2>' +
        '<p class="ref">Référence : <strong></strong></p>' +
        '<p class="lead">Nous avons bien reçu votre demande de devis pour votre événement. Notre équipe va vérifier les informations et vous transmettre une proposition après validation. Votre demande ne constitue pas encore une réservation confirmée.</p>' +
        '<p class="demo-note">Démonstration : rien n’a été envoyé. Sur le site réel, la demande et son devis provisoire seraient enregistrés dans l’administration, en attente de validation par le directeur.</p>' +
        '<div class="btn-row center-row"><a href="#accueil" class="btn btn-outline">Retour à l’accueil</a><a href="#administration" class="btn btn-navy">Voir l’administration</a></div>';
      box.querySelector('.ref strong').textContent = demoRef();
      if (name) box.querySelector('.lead').textContent = name + ', ' + box.querySelector('.lead').textContent.charAt(0).toLowerCase() + box.querySelector('.lead').textContent.slice(1);
      var layout = qf.closest('.quote-layout');
      layout.innerHTML = '';
      layout.appendChild(box);
      layout.style.display = 'block';
      window.scrollTo(0, 0);
    });
  }

  // Formulaire de contact : confirmation de démonstration.
  [].forEach.call(document.querySelectorAll('form[action="/contact"]'), function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = document.createElement('div');
      msg.className = 'alert alert-ok';
      msg.setAttribute('role', 'status');
      msg.textContent = 'Démonstration : sur le site réel, votre message serait enregistré et visible dans l’administration (Messages).';
      f.parentNode.insertBefore(msg, f);
      f.reset();
    }, true);
  });
})();
