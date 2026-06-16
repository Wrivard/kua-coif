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
 *      placeholder div needed. Because this script loads `async`,
 *      pair the button with the command-queue stub so an early click
 *      queues instead of throwing (drained when the script evaluates):
 *
 *      <script>window.Kua=window.Kua||{q:[],open:function(){this.q.push(arguments)}};</script>
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
 *   data-kua-button-color="#rrggbb"    → floating button brand color
 *                                        (text flips light/dark for contrast)
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
      'background-size:800px 100%;animation:kuaShimmer 1.5s ease infinite;border-radius:8px}' +
      '@media (prefers-reduced-motion: reduce){.kua-skel{animation:none}}';
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
    iframe.title = locale === 'en' ? 'Küa booking widget' : 'Widget de réservation Küa';
    iframe.loading = 'lazy';
    iframe.style.cssText = [
      'border:0',
      'width:100%',
      'min-height:480px',
      'display:block',
      'background:transparent',
      'color-scheme:dark light',
    ].join(';');
    // Plan 038 (DIRECTION-04) — delegate the Payment Request permission so
    // Apple/Google Pay can surface in the embed payment step (Stripe's
    // PaymentElement needs it inside a cross-origin iframe). An empty
    // allowlist silently blocked wallets that work fine on direct /book.
    iframe.setAttribute('allow', 'payment');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    return iframe;
  }

  // Returns the bound handler so callers with a finite lifecycle (the
  // modal) can remove it on teardown. Inline mounts ignore the return
  // value — their iframe lives for the whole page, so the listener is
  // meant to persist.
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
      // Plan 038 (UX-06) — the wizard advanced a step. If the visitor has
      // scrolled past the top of the iframe (mid-page on mobile), bring it
      // back into view so the new step isn't rendered "nowhere". Guarded so
      // we never yank a page the user hasn't scrolled into yet.
      if (data.kind === 'step-change') {
        var rect = iframe.getBoundingClientRect();
        if (rect.top < 0) {
          var behavior =
            window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'auto'
              : 'smooth';
          try {
            iframe.scrollIntoView({ block: 'start', behavior: behavior });
          } catch (e) {
            iframe.scrollIntoView();
          }
        }
      }
    }
    window.addEventListener('message', onMessage);
    return onMessage;
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
  // Plan 038 (UX-05) — pick a readable label color for a branded FAB.
  // Cheap perceived-luminance cut: light brand colors get near-black
  // text, dark ones keep white. Returns null on a malformed hex so the
  // caller falls back to the stock dark pill.
  function readableTextOn(hex) {
    var m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return null;
    var raw = m[1];
    if (raw.length === 3) {
      raw =
        raw.charAt(0) +
        raw.charAt(0) +
        raw.charAt(1) +
        raw.charAt(1) +
        raw.charAt(2) +
        raw.charAt(2);
    }
    var r = parseInt(raw.slice(0, 2), 16);
    var g = parseInt(raw.slice(2, 4), 16);
    var b = parseInt(raw.slice(4, 6), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#111111' : '#ffffff';
  }

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
      '.kua-fab-tr{right:24px;top:24px}.kua-fab-tl{left:24px;top:24px}' +
      '@media (prefers-reduced-motion: reduce){.kua-fab{transition:none}.kua-fab:hover{transform:none}}';
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
    // Plan 038 (UX-05) — brand the pill from data-kua-button-color (the
    // generated snippet bakes in the shop's saved accent) instead of the
    // hardcoded dark default that ignored the salon's identity.
    var labelColor = readableTextOn(opts && opts.color);
    if (labelColor) {
      btn.style.background = opts.color;
      btn.style.color = labelColor;
    }
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
      '@keyframes kuaPop{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}' +
      '@media (prefers-reduced-motion: reduce){.kua-modal-overlay,.kua-modal-inner{animation:none}}';
    document.head.appendChild(style);
  }

  // Plan 038 (UX-05) — resolve whether the modal CHROME (surface + close
  // button) should be dark. `theme` is the per-instance override the salon
  // passed; without one we follow the visitor's OS so the frame matches
  // what the embed page inside will pick for `mode:'auto'` shops.
  function modalIsDark(theme) {
    if (theme === 'light') return false;
    if (theme === 'dark') return true;
    return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function openModal(host, alias, locale, theme, source) {
    if (modalContainer) return;
    injectModalStyles();
    var sourceTag = source || 'modal';

    modalContainer = document.createElement('div');
    modalContainer.className = 'kua-modal-overlay';
    modalContainer.setAttribute('role', 'dialog');
    modalContainer.setAttribute('aria-modal', 'true');
    modalContainer.setAttribute(
      'aria-label',
      locale === 'en' ? 'Booking widget' : 'Widget de réservation',
    );

    var inner = document.createElement('div');
    inner.className = 'kua-modal-inner';
    // Plan 038 (UX-05) — the modal chrome follows the resolved theme
    // instead of hardcoding the dark surface around a light widget.
    var dark = modalIsDark(theme);
    if (!dark) inner.style.background = '#ffffff';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'kua-modal-close';
    closeBtn.setAttribute('aria-label', locale === 'en' ? 'Close' : 'Fermer');
    closeBtn.setAttribute('type', 'button');
    closeBtn.textContent = '×';
    if (!dark) {
      closeBtn.style.background = 'rgba(0,0,0,0.08)';
      closeBtn.style.color = '#111111';
    }
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

    // Plan 038 (UX-05) — focus management: Esc closes, Tab is trapped
    // between the close button and the iframe (the only two focusables in
    // the host document — focus inside the iframe is the iframe's own),
    // and the opener regains focus on close.
    function onKeydown(e) {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key !== 'Tab' || !modalContainer) return;
      var focusables = [closeBtn, iframe];
      var idx = focusables.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          focusables[focusables.length - 1].focus();
        }
      } else if (idx === focusables.length - 1 || idx === -1) {
        e.preventDefault();
        focusables[0].focus();
      }
    }
    document.addEventListener('keydown', onKeydown);
    modalContainer.setAttribute('data-kua-esc-bound', '1');
    modalContainer._kuaEsc = onKeydown;
    modalContainer._kuaOpener = document.activeElement;

    document.body.appendChild(modalContainer);
    closeBtn.focus();
    // Stash the resize handler so closeModal can detach it — otherwise
    // every open/close cycle leaks a window `message` listener (the
    // modal iframe is destroyed on close, but its listener lived on).
    modalContainer._kuaResize = bindResize(iframe, host);
  }

  function closeModal() {
    if (!modalContainer) return;
    if (modalContainer._kuaEsc) {
      document.removeEventListener('keydown', modalContainer._kuaEsc);
    }
    if (modalContainer._kuaResize) {
      window.removeEventListener('message', modalContainer._kuaResize);
    }
    var opener = modalContainer._kuaOpener;
    modalContainer.remove();
    modalContainer = null;
    // Restore focus to whatever opened the modal (a11y: the keyboard user
    // continues where they left off instead of being dumped at <body>).
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
      opener.focus();
    }
  }

  // ─── Public API ───────────────────────────────────────────────────
  // Plan 038 (UX-05) — command-queue stub support. This script loads
  // `async`, so a visitor can click the salon's own "Book now" button
  // before we evaluate; the documented snippet predefines
  //   window.Kua = window.Kua || {q:[],open:function(){this.q.push(arguments)}};
  // We capture that stub, install the real API, then drain the queued
  // open() calls in order.
  var stub = window.Kua;
  window.Kua = {
    open: function (alias, opts) {
      opts = opts || {};
      var host = (opts.host || defaultHost).replace(/\/+$/, '');
      var locale = (opts.locale || 'fr').toLowerCase();
      if (locale !== 'fr' && locale !== 'en') locale = 'fr';
      var theme = opts.theme;
      openModal(host, alias, locale, theme);
    },
    close: closeModal,
  };
  if (stub && stub.q && stub.q.length) {
    for (var qi = 0; qi < stub.q.length; qi++) {
      try {
        window.Kua.open.apply(window.Kua, stub.q[qi]);
      } catch (e) {
        // A malformed queued call must not break the drain loop.
      }
    }
  }

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
      var color = placeholder.getAttribute('data-kua-button-color');
      mountFloatingButton(host, alias, locale, theme, {
        text: text,
        position: position,
        color: color,
      });
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

  // Re-scan when a SPA adds new placeholders later — cheaply (plan 038,
  // PERF-04): the old observer ran a full-document querySelectorAll on
  // EVERY DOM mutation, forever. Now we scan only when an added element IS
  // or CONTAINS a placeholder, and coalesce bursts behind a 150ms trailing
  // debounce, so a chatty SPA host costs nothing between real mounts.
  var moTimer = 0;
  var mo = new MutationObserver(function (mutations) {
    var relevant = false;
    outer: for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType !== 1) continue;
        if (
          (n.hasAttribute && n.hasAttribute('data-kua-widget')) ||
          (n.querySelector && n.querySelector('[data-kua-widget]'))
        ) {
          relevant = true;
          break outer;
        }
      }
    }
    if (!relevant) return;
    if (moTimer) clearTimeout(moTimer);
    moTimer = setTimeout(function () {
      moTimer = 0;
      mountAll();
    }, 150);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
