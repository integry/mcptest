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

  try {
    if (window.localStorage.getItem('mcpSidebarCollapsed') === 'true') {
      document.documentElement.setAttribute('data-sidebar-collapsed', 'true');
    }
  } catch (error) { /* Storage may be blocked. */ }

  // Read the same legacy string[] / {url}[] formats as useConnection.
  // This runs before parsing the landing, so its new-user blocks never paint.
  var recent = [];
  try {
    var stored = JSON.parse(window.localStorage.getItem('mcpRecentServers') || 'null');
    if (Array.isArray(stored)) recent = stored.map(function (item) {
      return typeof item === 'string' ? item : item && typeof item.url === 'string' ? item.url : null;
    }).filter(Boolean).slice(0, 6);
  } catch (error) { /* Storage may be blocked or corrupt. */ }
  if (recent.length) {
    document.documentElement.setAttribute('data-returning-visitor', 'true');
    // Parser mutations are delivered before rendering. Clone only our static
    // template; storage is assigned through textContent/attributes, never HTML.
    var fillRecent = function () {
      var frame = document.querySelector('[data-prerendered-recent]');
      var template = document.querySelector('[data-recent-chip]');
      if (!frame || !template || !template.content.querySelector('.landing-recent-remove i')) return;
      var list = frame.querySelector('ul');
      recent.forEach(function (url) {
        var chip = template.content.cloneNode(true);
        var connect = chip.querySelector('.landing-recent-connect');
        var remove = chip.querySelector('.landing-recent-remove');
        var label = url;
        try { label = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).host || url; } catch (error) {}
        connect.setAttribute('data-recent-url', url);
        connect.title = url;
        chip.querySelector('.landing-recent-host').textContent = label;
        remove.title = 'Remove ' + url + ' from recent connections';
        remove.setAttribute('aria-label', remove.title);
        list.appendChild(chip);
      });
      observer.disconnect();
    };
    var observer = new MutationObserver(fillRecent);
    observer.observe(document, { childList: true, subtree: true });
  }

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
