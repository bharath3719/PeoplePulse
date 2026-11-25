// Runs before the app, so a dark-mode user never sees a white flash on load.
// An external file rather than an inline script, so a strict CSP (script-src
// 'self') does not have to allow inline code for it. Mirrors lib/theme.ts.
(function () {
  try {
    var pref = localStorage.getItem('pp.theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* storage blocked: light it is */
  }
})();
