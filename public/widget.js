/**
 * Küa booking widget — embed snippet (Phase H+13).
 *
 * Three integration modes:
 *
 *   1. INLINE (default) — mount the iframe directly where the
 *      placeholder div is dropped.
 *
 *      <div data-kua-widget="axum"></div>
 *      <script src="https://kua-coif.vercel.app/widget.js" async></script>
 *
 *   2. FLOATING-BUTTON — inject a fixed bottom-right pill that
 *      opens a modal containing the iframe. Calendly-style.
 *
 *      <div data-kua-widget="axum" data-kua-mode="floating-button"></div>
 *      <script src="https://kua-coif.vercel.app/widget.js" async></script>
 *
 *   3. MODAL (API) — expose `Kua.open(alias)` so the salon's own
 *      "Book" button (or any link) can trigger the modal. No
 *      placeholder div needed.
 *
 *      <button onclick="Kua.open('axum')">Book now</button>
 *      <script src="https://kua-coif.vercel.app/widget.js" async></script>
 *
 * Optional attributes on the placeholder div (or matching opts on
 * `Kua.open(alias, opts)`):
 *
 *   data-kua-locale="fr"|"en"          → wizard language (default: fr)
 *   data-kua-theme="dark"|"light"|"auto" → override saved theme mode
 *   data-kua-host="https://..."        → override origin (staging, etc.)
 *   data-kua-button-text="..."         → custom floating button label
 *   data-kua-button-position="br"|"bl"|"tr"|"tl" → corner (default: br)
 *
 * This file is plain JS (no transpile) so we can host it as a static
 * asset via `public/`. Zero dependencies. Self-contained CSS.
 */
(function () {
  'use strict';

  // ─── Host inference ────────────────────────────────────────────────
  function inferHostFromScript() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      var src = s.getAttribute('src') || '';
      if (/\/widget\.js(\?|$)/.test(src)) {
        try {
          return new URL(src, window.location.href).origin;
        } catch (e) {
          // fall through
        }
      }
    }
    return window.location.origin;
  }

  var defaultHost = inferHostFromScript();
  var modalContainer = null;

  // ─── Embed URL builder ────────────────────────────────────────────
  // `?theme=` lets the salon override the saved widget_config.mode
  // per-instance. Useful when the same widget is embedded on pages
  // with different visual themes (dark landing page vs. light blog).
  // Phase H+14 — `?source=` tags the iframe load with which mode
  // mounted it (inline / floating-button / modal) so the analytics
  // funnel can break down conversion by surface.
  function buildEmbedUrl(host, alias, locale, theme, source) {
    var url = host + '/' + locale + '/embed/' + encodeURIComponent(alias);
    var qs = [];
    if (theme === 'dark' || theme === 'light' || theme === 'auto') qs.push('theme=' + theme);
    if (source === 'inline' || source === 'floating-button' || source === 'modal') {
      qs.push('source=' + source);
    }
    if (qs.length) url += '?' + qs.join('&');
    return url;
  }

  // ─── Skeleton loader ──────────────────────────────────────────────
  // Shown for the ~200-500ms between iframe attach + the embed page's
  // first paint. Pure inline styles + a one-shot keyframe injection
  // so the shimmer works without external CSS.
  function injectSkeletonStyles() {
    if (document.getElementById('kua-skeleton-style')) return;
    var style = document.createElement('style');
    style.id = 'kua-skeleton-style';
    style.textContent =
      '@keyframes kuaShimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}' +
      '.kua-skel{background:linear-gradient(90deg,rgba(120,120,120,0.08) 0%,rgba(120,120,120,0.18) 50%,rgba(120,120,120,0.08) 100%);' +
      'background-size:800px 100%;animation:kuaShimmer 1.5s ease infinite;border-radius:8px}';
    document.head.appendChild(style);
  }

  function createSkeleton() {
    injectSkeletonStyles();
    var wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'padding:24px;min-height:480px;box-sizing:border-box';
    var rows = [
      'height:56px;width:56px;border-radius:9999px;margin:0 auto 16px',
      'height:24px;width:60%;margin:8px auto',
      'height:14px;width:40%;margin:0 auto 24px',
      'height:48px;width:100%;margin:8px 0',
      'height:48px;width:100%;margin:8px 0',
      'height:48px;width:100%;margin:8px 0',
    ];
    for (var i = 0; i < rows.length; i++) {
      var bar = document.createElement('div');
      bar.className = 'kua-skel';
      bar.style.cssText = rows[i];
      wrap.appendChild(bar);
    }
    return wrap;
  }

  // ─── Iframe factory + resize binding ──────────────────────────────
  function createIframe(host, alias, locale, theme, source) {
    var iframe = document.createElement('iframe');
    iframe.src = buildEmbedUrl(host, alias, locale, theme, source);
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
    iframe.setAttribute('allow', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    return iframe;
  }

  function bindResize(iframe, host) {
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
        var h = Math.max(200, Math.min(4000, Math.ceil(data.height)));
        iframe.style.height = h + 'px';
      }
    }
    window.addEventListener('message', onMessage);
  }

  // ─── Mode 1: inline ───────────────────────────────────────────────
  function mountInline(placeholder, host, alias, locale, theme) {
    var skeleton = createSkeleton();
    placeholder.appendChild(skeleton);

    var iframe = createIframe(host, alias, locale, theme, 'inline');
    var removed = false;
    function removeSkeleton() {
      if (removed) return;
      removed = true;
      if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
    }
    iframe.addEventListener('load', removeSkeleton);
    // Safety: kill the skeleton after 8s even if `load` never fires.
    setTimeout(removeSkeleton, 8000);

    placeholder.appendChild(iframe);
    bindResize(iframe, host);
  }

  // ─── Mode 2: floating button ──────────────────────────────────────
  function injectFloatingButtonStyles() {
    if (document.getElementById('kua-floating-style')) return;
    var style = document.createElement('style');
    style.id = 'kua-floating-style';
    style.textContent =
      '.kua-fab{position:fixed;z-index:2147483646;padding:14px 22px;font:600 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'color:#fff;background:#111;border:0;border-radius:9999px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.25),0 2px 6px rgba(0,0,0,0.15);' +
      'transition:transform .15s ease,box-shadow .15s ease}' +
      '.kua-fab:hover{transform:translateY(-1px);box-shadow:0 12px 32px rgba(0,0,0,0.3),0 4px 8px rgba(0,0,0,0.2)}' +
      '.kua-fab-br{right:24px;bottom:24px}.kua-fab-bl{left:24px;bottom:24px}' +
      '.kua-fab-tr{right:24px;top:24px}.kua-fab-tl{left:24px;top:24px}';
    document.head.appendChild(style);
  }

  function mountFloatingButton(host, alias, locale, theme, opts) {
    injectFloatingButtonStyles();
    var existing = document.querySelector('[data-kua-fab-alias="' + alias + '"]');
    if (existing) return;

    var btn = document.createElement('button');
    var pos = (opts && opts.position) || 'br';
    btn.className = 'kua-fab kua-fab-' + pos;
    btn.setAttribute('data-kua-fab-alias', alias);
    btn.setAttribute('type', 'button');
    btn.textContent = (opts && opts.text) || (locale === 'en' ? 'Book' : 'Réserver');
    btn.addEventListener('click', function () {
      openModal(host, alias, locale, theme, 'floating-button');
    });
    document.body.appendChild(btn);
  }

  // ─── Mode 3: modal (API + shared modal infra) ─────────────────────
  function injectModalStyles() {
    if (document.getElementById('kua-modal-style')) return;
    var style = document.createElement('style');
    style.id = 'kua-modal-style';
    style.textContent =
      '.kua-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);' +
      'z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;animation:kuaFade .15s ease}' +
      '.kua-modal-inner{position:relative;background:#1b1b1b;border-radius:16px;width:100%;max-width:520px;max-height:92vh;' +
      'overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);animation:kuaPop .2s cubic-bezier(0.22,1,0.36,1)}' +
      '.kua-modal-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:9999px;border:0;cursor:pointer;' +
      'background:rgba(255,255,255,0.1);color:#fff;font:600 18px/1 system-ui;z-index:1;display:flex;align-items:center;justify-content:center}' +
      '.kua-modal-close:hover{background:rgba(255,255,255,0.2)}' +
      '.kua-modal-scroll{max-height:92vh;overflow-y:auto}' +
      '@keyframes kuaFade{from{opacity:0}to{opacity:1}}' +
      '@keyframes kuaPop{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}';
    document.head.appendChild(style);
  }

  function openModal(host, alias, locale, theme, source) {
    if (modalContainer) return;
    injectModalStyles();
    var sourceTag = source || 'modal';

    modalContainer = document.createElement('div');
    modalContainer.className = 'kua-modal-overlay';
    modalContainer.setAttribute('role', 'dialog');
    modalContainer.setAttribute('aria-modal', 'true');
    modalContainer.setAttribute('aria-label', 'Booking widget');

    var inner = document.createElement('div');
    inner.className = 'kua-modal-inner';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'kua-modal-close';
    closeBtn.setAttribute('aria-label', locale === 'en' ? 'Close' : 'Fermer');
    closeBtn.setAttribute('type', 'button');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', closeModal);
    inner.appendChild(closeBtn);

    var scroll = document.createElement('div');
    scroll.className = 'kua-modal-scroll';

    var skeleton = createSkeleton();
    scroll.appendChild(skeleton);

    var iframe = createIframe(host, alias, locale, theme, sourceTag);
    iframe.style.minHeight = '600px';
    var removed = false;
    function removeSkeleton() {
      if (removed) return;
      removed = true;
      if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
    }
    iframe.addEventListener('load', removeSkeleton);
    setTimeout(removeSkeleton, 8000);

    scroll.appendChild(iframe);
    inner.appendChild(scroll);
    modalContainer.appendChild(inner);

    modalContainer.addEventListener('click', function (e) {
      if (e.target === modalContainer) closeModal();
    });

    function onEsc(e) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', onEsc);
    modalContainer.setAttribute('data-kua-esc-bound', '1');
    modalContainer._kuaEsc = onEsc;

    document.body.appendChild(modalContainer);
    bindResize(iframe, host);
  }

  function closeModal() {
    if (!modalContainer) return;
    if (modalContainer._kuaEsc) {
      document.removeEventListener('keydown', modalContainer._kuaEsc);
    }
    modalContainer.remove();
    modalContainer = null;
  }

  // ─── Public API ───────────────────────────────────────────────────
  window.Kua = window.Kua || {};
  window.Kua.open = function (alias, opts) {
    opts = opts || {};
    var host = (opts.host || defaultHost).replace(/\/+$/, '');
    var locale = (opts.locale || 'fr').toLowerCase();
    if (locale !== 'fr' && locale !== 'en') locale = 'fr';
    var theme = opts.theme;
    openModal(host, alias, locale, theme);
  };
  window.Kua.close = closeModal;

  // ─── Auto-mount from `[data-kua-widget]` placeholders ────────────
  function mountWidget(placeholder) {
    if (placeholder.getAttribute('data-kua-mounted') === '1') return;
    placeholder.setAttribute('data-kua-mounted', '1');

    var alias = (placeholder.getAttribute('data-kua-widget') || '').trim();
    if (!alias) return;

    var host = (placeholder.getAttribute('data-kua-host') || defaultHost).replace(/\/+$/, '');
    var locale = (placeholder.getAttribute('data-kua-locale') || 'fr').toLowerCase();
    if (locale !== 'fr' && locale !== 'en') locale = 'fr';
    var theme = placeholder.getAttribute('data-kua-theme') || undefined;
    var mode = placeholder.getAttribute('data-kua-mode') || 'inline';

    if (mode === 'floating-button') {
      var text = placeholder.getAttribute('data-kua-button-text');
      var position = placeholder.getAttribute('data-kua-button-position') || 'br';
      mountFloatingButton(host, alias, locale, theme, { text: text, position: position });
    } else if (mode === 'modal') {
      // Modal mode: the placeholder div doesn't mount anything visible.
      // The salon's own button is expected to call Kua.open(alias).
      // We register intent here but it's effectively a no-op.
    } else {
      mountInline(placeholder, host, alias, locale, theme);
    }
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-kua-widget]');
    for (var i = 0; i < nodes.length; i++) mountWidget(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  } else {
    mountAll();
  }

  // Re-scan when a SPA adds new placeholders later.
  var mo = new MutationObserver(function () {
    mountAll();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
