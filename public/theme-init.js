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

  // Read the same persisted formats as App and useConnection before paint.
  var recent = [];
  var tabs = [];
  try {
    var stored = JSON.parse(window.localStorage.getItem('mcpRecentServers') || 'null');
    if (Array.isArray(stored)) recent = stored.map(function (item) {
      return typeof item === 'string' ? item : item && typeof item.url === 'string' ? item.url : null;
    }).filter(Boolean);
  } catch (error) { /* Storage may be blocked or corrupt. */ }
  try {
    var savedTabs = JSON.parse(window.localStorage.getItem('mcpConnectionTabs') || 'null');
    if (Array.isArray(savedTabs) && savedTabs.every(function (tab) {
      return tab && typeof tab.id === 'string' && typeof tab.title === 'string';
    })) tabs = savedTabs;
  } catch (error) { /* Storage may be blocked or corrupt. */ }
  if (recent.length || tabs.some(function (tab) { return tab.serverUrl || tab.autoConnect || tab.resultShareData; })) {
    document.documentElement.setAttribute('data-returning-visitor', 'true');
    // Parser mutations run before rendering. Assign storage only via textContent
    // and attributes, never HTML. Wait for the whole workspace to be parsed.
    var fillWorkspace = function () {
      var workspace = document.querySelector('.seo-returning-workspace');
      var strip = document.querySelector('.seo-shell-fallback .playground-tabs');
      if (!workspace || !workspace.querySelector('.suggested-server-grid') || !strip) return;
      if (tabs.length) {
        var template = strip.firstElementChild.cloneNode(true);
        strip.textContent = '';
        tabs.forEach(function (tab, index) {
          var item = template.cloneNode(true);
          var button = item.querySelector('button');
          button.classList.toggle('active', index === 0);
          button.classList.toggle('active-tab-override', index === 0);
          button.setAttribute('aria-selected', String(index === 0));
          button.title = tab.title;
          var label = tab.title;
          var match = label.match(/^(?:Server|Result):\s*(.+)$/i);
          var candidate = (match ? match[1] : label).trim();
          if (/^(https?:\/\/)?[^\s/]+\.[^\s/]+(\/|$)/i.test(candidate)) {
            try {
              var endpoint = new URL(/^https?:\/\//i.test(candidate) ? candidate : 'https://' + candidate);
              label = endpoint.host + endpoint.pathname.replace(/\/+$/, '');
            } catch (error) {}
          }
          item.querySelector('.playground-tab-label').textContent = label;
          if (tabs.length > 1) {
            button.classList.add('pe-5');
            var close = document.createElement('button');
            close.className = 'btn-close btn-close-sm position-absolute top-50 end-0 translate-middle-y me-2';
            close.style.zIndex = '2';
            close.setAttribute('aria-label', 'Close ' + tab.title + ' tab');
            item.appendChild(close);
          }
          strip.appendChild(item);
        });
        workspace.querySelector('input').value = tabs[0].serverUrl || '';
      }
      var panel = workspace.querySelector('[data-workspace-recent]');
      if (!recent.length) {
        panel.remove();
        workspace.querySelector('[data-workspace-suggested]').className = 'col-12';
      } else {
        var list = panel.querySelector('ul');
        recent.slice(0, 5).forEach(function (url) {
          var item = document.createElement('li');
          item.className = 'list-group-item recent-server-item d-flex justify-content-between align-items-center p-2';
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'recent-server-link';
          button.title = url;
          button.textContent = url;
          item.appendChild(button);
          var remove = document.createElement('button');
          remove.className = 'btn btn-sm btn-outline-secondary recent-server-remove';
          remove.setAttribute('aria-label', 'Remove ' + url + ' from recent connections');
          var icon = document.createElement('i');
          icon.className = 'bi bi-x-lg';
          remove.appendChild(icon);
          item.appendChild(remove);
          list.appendChild(item);
        });
      }
      observer.disconnect();
    };
    var observer = new MutationObserver(fillWorkspace);
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
