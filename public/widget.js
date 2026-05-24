/**
 * Küa booking widget — embed snippet.
 *
 * Usage on a third-party site:
 *
 *   <div data-kua-widget="axum"></div>
 *   <script src="https://kua-coif.vercel.app/widget.js" async></script>
 *
 * Optional attributes on the placeholder div:
 *   data-kua-widget="<shop-alias>"   (required)
 *   data-kua-locale="fr"|"en"        (default: fr)
 *   data-kua-theme="dark"|"light"    (default: dark)
 *   data-kua-host="https://..."      (override origin — useful for staging)
 *
 * This file is plain JS (no transpile) so we can host it as a static asset
 * via `public/`. Keep dependencies zero.
 */
(function () {
  'use strict';

  // The origin that serves the iframe. `data-kua-host` overrides per-instance;
  // otherwise we infer from the <script src> tag (`new URL(script.src).origin`).
  function inferHostFromScript() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      var src = s.getAttribute('src') || '';
      if (/\/widget\.js(\?|$)/.test(src)) {
        try {
          return new URL(src, window.location.href).origin;
        } catch (e) {
          // ignore — fall through to next candidate
        }
      }
    }
    return window.location.origin;
  }

  var defaultHost = inferHostFromScript();

  function mountWidget(placeholder) {
    if (placeholder.getAttribute('data-kua-mounted') === '1') return;
    placeholder.setAttribute('data-kua-mounted', '1');

    var alias = (placeholder.getAttribute('data-kua-widget') || '').trim();
    if (!alias) return;

    var host = (placeholder.getAttribute('data-kua-host') || defaultHost).replace(/\/+$/, '');
    var locale = (placeholder.getAttribute('data-kua-locale') || 'fr').toLowerCase();
    if (locale !== 'fr' && locale !== 'en') locale = 'fr';

    var iframe = document.createElement('iframe');
    iframe.src = host + '/' + locale + '/embed/' + encodeURIComponent(alias);
    iframe.title = 'Küa booking widget';
    iframe.loading = 'lazy';
    iframe.style.cssText = [
      'border:0',
      'width:100%',
      'min-height:480px',
      'display:block',
      'background:transparent',
      'color-scheme:dark light',
    ].join(';');
    // Tight permissions; the widget itself only needs same-origin storage.
    iframe.setAttribute('allow', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

    placeholder.appendChild(iframe);

    // Bind a one-shot resize listener scoped to this iframe — we ignore
    // messages from any other origin to avoid cross-widget interference.
    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return;
      try {
        var origin = new URL(host).origin;
        if (event.origin !== origin) return;
      } catch (e) {
        return;
      }
      var data = event.data;
      if (!data || data.type !== 'kua-widget') return;
      if (data.kind === 'resize' && typeof data.height === 'number') {
        // Clamp to a sensible range to defend against runaway content.
        var h = Math.max(200, Math.min(4000, Math.ceil(data.height)));
        iframe.style.height = h + 'px';
      }
    }
    window.addEventListener('message', onMessage);
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-kua-widget]');
    for (var i = 0; i < nodes.length; i++) mountWidget(nodes[i]);
  }

  // Mount immediately if the DOM is already parsed, otherwise wait.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  } else {
    mountAll();
  }

  // Re-scan when a SPA (Next.js, etc.) adds new placeholders later.
  var mo = new MutationObserver(function () {
    mountAll();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
