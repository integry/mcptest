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
})();
