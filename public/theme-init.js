/*
 * Sets data-theme on <html> before the first paint, so dark-mode visitors
 * never see the light palette. Loaded synchronously from index.html ahead of
 * the stylesheets; the Content-Security-Policy allows same-origin scripts
 * only, so this cannot be inline. App.tsx reads the attribute back as its
 * initial theme. Its fallback (getInitialTheme) mirrors
 * this logic for environments where the script did not run, such as tests.
 */
(function () {
  var saved = null;
  try {
    saved = window.localStorage.getItem('theme');
  } catch (error) {
    // Storage can be unavailable (privacy modes, sandboxed frames).
  }
  var theme = 'light';
  if (saved === 'light' || saved === 'dark') {
    theme = saved;
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    theme = 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);

  /*
   * Prerendered pages inline their critical CSS and preload the full
   * stylesheet (scripts/critical-css.js) instead of blocking the first paint
   * on it. The CSP rules out an inline onload handler, so this capture-phase
   * listener, installed before the links are parsed, applies each preloaded
   * stylesheet once it has arrived, or after an error so the browser retries
   * it as a stylesheet.
   */
  if (typeof document.addEventListener === 'function') {
    var applyDeferredStylesheet = function (event) {
      var link = event.target;
      if (!link || link.tagName !== 'LINK' || link.rel !== 'preload' || !link.hasAttribute('data-deferred-stylesheet')) return;
      link.rel = 'stylesheet';
    };
    document.addEventListener('load', applyDeferredStylesheet, true);
    document.addEventListener('error', applyDeferredStylesheet, true);
  }
})();
