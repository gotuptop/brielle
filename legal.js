// Brielle — idioma de las páginas legales. Usa el mismo idioma elegido en la app (brielle_lang).
(function () {
  var root = document.documentElement;
  function saved() {
    try { var v = localStorage.getItem('brielle_lang'); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function pick() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'es') return q;
    var s = saved();
    if (s === 'en' || s === 'es') return s;
    return /^es/i.test(navigator.language || '') ? 'es' : 'en';
  }
  function apply(lang) {
    root.setAttribute('data-lang', lang);
    root.lang = lang;
    var title = document.querySelector('h1[data-l="' + lang + '"]');
    if (title) document.title = title.textContent + ' — Brielle';
    var b = document.getElementById('langBtn');
    if (b) b.textContent = lang === 'es' ? 'EN' : 'ES';
  }
  // Los enlaces tipo terms.html#ai llevan a la sección del idioma que se está mostrando.
  function jump() {
    var id = (location.hash || '').slice(1);
    if (!/^[a-z0-9-]+$/.test(id)) return;
    var el = document.querySelector('[data-l="' + lang + '"] [data-anchor="' + id + '"]');
    if (el) el.scrollIntoView();
  }
  var lang = pick();
  apply(lang);
  document.addEventListener('DOMContentLoaded', function () {
    apply(lang);
    jump();
    window.addEventListener('hashchange', jump);
    var b = document.getElementById('langBtn');
    if (!b) return;
    b.addEventListener('click', function () {
      lang = lang === 'es' ? 'en' : 'es';
      try { localStorage.setItem('brielle_lang', JSON.stringify(lang)); } catch (e) {}
      apply(lang);
    });
  });
})();
