// Runs on allowed sites: selection toolbar, comment box, page highlights, and the
// prompts and toasts for each save. Saving itself happens in the background.
(() => {
  if (window.__selectiophileLoaded) return;
  window.__selectiophileLoaded = true;

  const { t, setLang } = globalThis.SelectiophileI18n;
  const { evaluateProfile } = globalThis.SelectiophileProfiles;
  const { comboFromEvent, shortcutsOf } = globalThis.SelectiophileCombo;

  // Same tokens and shapes as Phrase Collector's panel.
  const STYLE = `
:host{all:initial}
*{box-sizing:border-box}
.lp{
  --c1:#e6b8b5;--c2:#b8cbda;--c3:#d7cee7;--c4:#c0ccae;--c5:#a9cdc6;--c6:#ebc86c;
  --bg:#fffdfb;--bg-2:#f7f5f4;--fg:#30374b;--fg-2:#555b70;--muted:#8a8ea0;--line:#e7e4eb;--line-2:#f0eef2;--input-line:#dddee7;
  --accent:#5d6a8f;--accent-soft:#eceef6;--accent-line:#cfd3e4;
  --btn:#68769b;--btn-hover:#515d82;--btn-fg:#ffffff;
  --ok:#4f7d68;--dot-ok:#8fb59f;--dot-warn:#ebc86c;--dot-err:#d9908c;
  --danger:#a64d59;--danger-soft:#f8eaeb;--danger-line:#efd2d5;
  --focus:#838cac;--ring:#a9a7cf;
  --serif:Georgia,"Noto Serif SC","Songti SC",serif;
  --shadow:0 22px 60px -18px rgba(45,48,79,.30),0 4px 14px -6px rgba(45,48,79,.10);
  font:14px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
  color:var(--fg);-webkit-font-smoothing:antialiased;
}
.lp[data-theme="lagoon"]{
  --c1:#82afa0;--c2:#b7c9a0;--c3:#ebc86c;--c4:#aacbdc;--c5:#e3c4ae;--c6:#a3bea7;
  --bg:#ffffff;--bg-2:#f7faf5;--fg:#314940;--fg-2:#587165;--muted:#7b9386;--line:#e0e8de;--line-2:#edf1ea;--input-line:#d9e4d9;
  --accent:#416c58;--accent-soft:#edf5ed;--accent-line:#c9dccd;
  --btn:#608b77;--btn-hover:#477864;--btn-fg:#ffffff;
  --ok:#416c58;--dot-ok:#82afa0;--dot-err:#c98f7c;
  --danger:#a0695b;--danger-soft:#f9f0e9;--danger-line:#ecd7c9;
  --focus:#91b8a1;--ring:#91b8a1;
  --shadow:0 22px 60px -18px rgba(48,78,64,.28),0 4px 14px -6px rgba(48,78,64,.10);
}
button{font:inherit;color:inherit;cursor:pointer;border:none;background:none;padding:0}
button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
kbd{font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.3px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:3px 5px;background:var(--bg)}
input,textarea{width:100%;display:block;padding:9px 12px;border:1px solid var(--input-line);border-radius:12px;background:var(--bg);color:var(--fg);font:inherit;font-size:13px;outline:none;transition:border-color .15s,box-shadow .15s}
input::placeholder,textarea::placeholder{color:var(--muted)}
input:hover,textarea:hover{border-color:var(--accent-line)}
input:focus,textarea:focus{border-color:var(--focus);box-shadow:0 0 0 3px color-mix(in srgb,var(--focus) 18%,transparent)}
textarea{resize:vertical;min-height:92px;line-height:1.65}

.box{position:absolute;background:var(--bg);color:var(--fg);border:1px solid var(--line);box-shadow:var(--shadow)}
.fixed{position:fixed}
.dots{display:flex;align-items:center;gap:4px;padding:0 6px 0 4px}
.toolbar .dot-btn{width:20px;height:20px;padding:0;border-radius:50%;background:var(--dot);box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);transition:transform .12s,box-shadow .12s}
.toolbar .dot-btn:hover{background:var(--dot);transform:scale(1.18)}
.dot-btn.on{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--dot)}
.divider{width:1px;height:18px;background:var(--line);flex:none}
.swatches{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.swatch{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px 0 8px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--fg-2);transition:border-color .15s,background .15s}
.swatch::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--dot);flex:none}
.swatch:hover{border-color:var(--accent-line)}
.swatch.on{border-color:var(--dot);background:color-mix(in srgb,var(--dot) 18%,var(--bg));color:var(--fg);font-weight:600}
.fab{z-index:1}
.toast{z-index:2}
.panel{z-index:3}
.toolbar{z-index:4}

.toolbar{display:flex;gap:2px;padding:4px;border-radius:14px;animation:lp-pop .16s ease-out}
.toolbar button{display:flex;align-items:center;gap:7px;height:32px;padding:0 10px;border-radius:10px;white-space:nowrap;font-size:13px;font-weight:550;color:var(--fg-2);transition:background .15s,color .15s}
.toolbar button:hover{background:var(--accent-soft);color:var(--fg)}
.toolbar svg{color:var(--accent)}
.toolbar.lite .comment-btn{width:32px;padding:0;justify-content:center}
.toolbar.lite .label,.toolbar.lite kbd{display:none}
.toolbar.lite .dots{padding:0 4px}
.toolbar.lite .dot-btn{width:18px;height:18px}

.panel{width:400px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;border-radius:21px;overflow:hidden;animation:lp-pop .2s ease-out}
.head{display:flex;align-items:center;gap:12px;padding:13px 10px 12px 14px;border-bottom:1px solid var(--line-2);background:linear-gradient(115deg,color-mix(in srgb,var(--c1) 24%,var(--bg)) 0%,color-mix(in srgb,var(--c3) 22%,var(--bg)) 55%,color-mix(in srgb,var(--c2) 26%,var(--bg)) 100%)}
.badge{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;color:var(--accent);background:var(--bg);box-shadow:0 2px 8px -2px rgba(45,48,79,.18);flex:none}
.titles{flex:1;min-width:0}
.eyebrow{font-size:10px;line-height:1.5;letter-spacing:1.6px;font-weight:700;color:var(--muted)}
.title{font:500 16px/1.35 var(--serif);letter-spacing:-.2px;overflow-wrap:anywhere}
.close{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;color:var(--muted);flex:none;align-self:flex-start;transition:background .15s,color .15s}
.close:hover{background:color-mix(in srgb,var(--bg) 70%,transparent);color:var(--fg)}
.sel{margin:14px 18px 0;padding:0 0 0 12px;font:italic 13px/1.6 var(--serif);color:var(--fg-2);border-left:2px solid var(--c1);max-height:calc(4.8em + 2px);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word}
.content{padding:12px 16px 14px}
.note-line{font-size:12.5px;color:var(--fg-2);overflow-wrap:anywhere;margin:0 2px 8px}
.note-line.bad{color:var(--danger);background:var(--danger-soft);border:1px solid var(--danger-line);border-radius:12px;padding:8px 12px;margin:0 0 10px}
.list{display:flex;flex-direction:column;gap:2px;max-height:300px;overflow:auto;margin:0 -4px;padding:0 4px}
.content input+.list{margin-top:8px}
.list::-webkit-scrollbar{width:10px}
.list::-webkit-scrollbar-track{background:transparent}
.list::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:10px;background:linear-gradient(180deg,color-mix(in srgb,var(--c1) 85%,var(--bg)),color-mix(in srgb,var(--c3) 85%,var(--bg)),color-mix(in srgb,var(--c2) 85%,var(--bg))) padding-box}
.list button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:7px 10px;border-radius:11px;font-size:13px;color:var(--fg-2);background:linear-gradient(90deg,var(--accent-soft) var(--p,0%),transparent var(--p,0%));transition:color .15s,box-shadow .15s}
.list button:hover{color:var(--fg);box-shadow:inset 0 0 0 1px var(--accent-line)}
.list .num{min-width:18px;text-align:center}
.list .num:empty{visibility:hidden}
.list .label{flex:1;min-width:0;overflow-wrap:anywhere}
.list .pct{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.empty{padding:6px 2px;font-size:12.5px;color:var(--muted)}

.foot{display:flex;align-items:center;gap:8px;padding:11px 14px;border-top:1px solid var(--line-2);background:var(--bg-2)}
.foot .hint{margin-right:auto;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
.foot input{flex:1;min-width:0;width:auto;height:36px;padding:0 12px}
.btn{height:36px;padding:0 14px;border-radius:12px;font-size:13px;font-weight:600;color:var(--fg-2);background:var(--bg);border:1px solid var(--input-line);white-space:nowrap;transition:background .2s,border-color .2s,color .2s,transform .15s}
.btn:hover{border-color:var(--focus);color:var(--fg)}
.btn:active{transform:scale(.98)}
.btn.primary{background:var(--btn);border-color:var(--btn);color:var(--btn-fg);font-weight:650;letter-spacing:.3px}
.btn.primary:hover{background:var(--btn-hover);border-color:var(--btn-hover);color:var(--btn-fg)}

.card{width:340px}
.tag{display:inline-flex;width:fit-content;max-width:100%;align-items:center;gap:6px;padding:2px 10px 2px 8px;border-radius:999px;background:color-mix(in srgb,var(--c2) 30%,var(--bg));font-size:12px;font-weight:600;color:var(--fg-2);overflow-wrap:anywhere}
.tag::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--c2);flex:none}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:2px}
.actions button,.actions a{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:9px;font-size:12px;font-weight:600;color:var(--accent);text-decoration:none;transition:background .15s,color .15s}
.actions button:hover,.actions a:hover{background:var(--accent-soft)}
.actions button.primary{background:var(--btn);color:var(--btn-fg)}
.actions button.primary:hover{background:var(--btn-hover)}
.actions button.danger{color:var(--danger)}
.actions button.danger:hover{background:var(--danger-soft)}
.actions button.confirming,.actions button.confirming:hover{background:var(--danger);color:#fff}

.toast{right:16px;bottom:16px;width:360px;max-width:calc(100vw - 32px);display:flex;gap:12px;align-items:flex-start;padding:13px 14px 10px 16px;border-radius:17px;animation:lp-pop .2s ease-out}
.toast .status-dot{width:8px;height:8px;margin-top:6px;border-radius:50%;flex:none;background:var(--dot-ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--dot-ok) 28%,transparent)}
.toast.warn .status-dot{background:var(--dot-warn);box-shadow:0 0 0 4px color-mix(in srgb,var(--dot-warn) 28%,transparent)}
.toast.err .status-dot{background:var(--dot-err);box-shadow:0 0 0 4px color-mix(in srgb,var(--dot-err) 28%,transparent)}
.toast .t-body{flex:1;min-width:0}
.toast .t-status{font-size:12px;color:var(--muted)}
.toast .t-title{font:500 15px/1.35 var(--serif);letter-spacing:-.2px;overflow-wrap:anywhere;margin:1px 0 5px}
.toast .t-msg{font-size:13px;line-height:1.6;color:var(--fg-2);overflow-wrap:anywhere}
.toast.err .t-msg{color:var(--danger)}
.toast .t-clip{white-space:pre-line}
.review{width:min(420px,calc(100vw - 32px))}
.review textarea{min-height:120px}
.review-where{margin-top:8px;font-size:12px;line-height:1.5;color:var(--muted)}
.toast .actions{margin:6px 0 0 -10px}
.toast .actions:empty{display:none}

.fab{right:16px;bottom:16px;width:38px;height:38px;padding:0;display:grid;place-items:center;border-radius:50%;color:var(--muted);cursor:grab;touch-action:none;user-select:none;transition:background .15s,color .15s,border-color .15s,bottom .15s}
.fab:hover{color:var(--accent);border-color:var(--accent-line)}
.fab.on{background:var(--danger);border-color:var(--danger);color:#fff}
.fab.on:hover{color:#fff}
.fab.on svg{fill:currentColor}
.fab.dragging{cursor:grabbing;transition:none}
.comment-text{margin:10px 2px 0;padding-left:10px;border-left:2px solid var(--c2);font-size:13px;line-height:1.6;color:var(--fg-2);white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}
.comment-text.none{border:0;padding:0;color:var(--muted);font-size:12px}

@keyframes lp-pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition:none!important}}
`;

  const themeName = (value) => (value === 'lagoon' ? 'lagoon' : 'dusk');

  const ICONS = {
    mark: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  };

  const HIGHLIGHT_NAME = 'selectiophile';
  const TOAST_MS = 7000;
  const REPAIR_DEBOUNCE_MS = 800;
  const CARD_DELAY_MS = 250;
  const MESSAGE_CHARS = 1500;
  const TOOLBAR_DODGE_DELAYS = [30, 200];
  const DRAG_THRESHOLD = 4;
  const NAVIGATION_POLL_MS = 1000;
  const MAX_QUOTE = 8000;

  let host, root, ui;
  let toolbar = null;
  let panel = null;
  let toastEl = null;
  let toastTimer = null;
  let fabEl = null;
  let keyHandler = null;
  let cardTimer = null;
  const state = { note: null, pinned: null, discussion: '', pageKey: null, theme: 'dusk', colors: [], lastColor: null, active: false, toolbarStyle: 'standard', profile: null, fabPos: null, shortcuts: shortcutsOf(), showHighlights: true, showFab: true, conversationRounds: 0 };
  const ranges = new Map();
  const rangeColors = new Map();
  // Highlights still waiting to be written, which have no note entry to edit yet.
  const unsaved = new Set();
  // Everything needed to find a highlight again after the page re-renders it.
  const known = new Map();

  // A matching config runs now rather than earlier, so it sees the page as it is.
  function rawPage() {
    const page = collectPage();
    if (state.profile) {
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      page.profile = {
        name: state.profile.name,
        values: evaluateProfile(state.profile, document, {
          url: location.href,
          title: document.title,
          date,
          domain: location.hostname,
          published: page.meta['article:published_time']?.[0] || page.meta['citation_publication_date']?.[0] || '',
        }),
      };
    }
    return page;
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };

  function call(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!alive()) return reject(new Error(t('插件已更新，请刷新此页面')));
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else if (!res?.ok) reject(Object.assign(new Error(res?.error || t('后台没有响应')), { code: res?.code }));
        else resolve(res.result);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v != null) node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  }

  function ensureRoot() {
    if (host?.isConnected) return;
    host = document.createElement('selectiophile-ui');
    // Page translators, Read Frog among them, skip anything marked this way.
    host.className = 'notranslate';
    host.setAttribute('translate', 'no');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    ui = el('div', { class: 'lp notranslate', translate: 'no' });
    ui.dataset.theme = state.theme;
    root.append(ui);
    document.documentElement.append(host);
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
  }

  function panelShell({ eyebrow, title, iconName, body, foot, onClose, className = '' }) {
    return el(
      'div',
      { class: `box panel ${className}` },
      el(
        'div',
        { class: 'head' },
        el('div', { class: 'badge' }, icon(iconName)),
        el('div', { class: 'titles' }, el('div', { class: 'eyebrow' }, eyebrow), el('div', { class: 'title' }, title)),
        el('button', { class: 'close', title: t('关闭（Esc）'), 'aria-label': t('关闭'), onclick: onClose }, icon('close')),
      ),
      body,
      foot ? el('div', { class: 'foot' }, foot) : null,
    );
  }

  const isInside = (e) => Boolean(host) && e.composedPath().includes(host);
  const isEditable = (t) => t?.nodeType === 1 && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  function place(node, rect, box) {
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const left = Math.max(8, Math.min(rect.right - w / 2, document.documentElement.clientWidth - w - 8));
    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 4) top = Math.max(8, (box || rect).top - h - 8);
    node.style.left = `${left + window.scrollX}px`;
    node.style.top = `${top + window.scrollY}px`;
  }

  // ---------------------------------------------------------------------------
  // Page metadata
  // ---------------------------------------------------------------------------
  const META_KEY = /^(citation_|dc\.|prism\.|og:title$|og:site_name$|article:published_time$|article:author$|author$|twitter:creator$|doi$)/;

  function collectPage() {
    const meta = {};
    for (const m of document.querySelectorAll('meta[name],meta[property]')) {
      const key = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
      if (META_KEY.test(key)) (meta[key] ||= []).push(m.getAttribute('content') || '');
    }
    const jsonLd = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        jsonLd.push(JSON.parse(s.textContent));
      } catch {
        // Malformed JSON-LD is common and only costs us one metadata source.
      }
    }
    return {
      url: location.href,
      docTitle: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || '',
      meta,
      jsonLd,
      latexTitle: document.querySelector('h1.ltx_title_document')?.textContent?.trim() || '',
      latexAuthors: latexAuthors(),
    };
  }

  // arXiv's HTML papers carry no citation meta, so authors come from the markup.
  function latexAuthors() {
    const out = [];
    for (const node of document.querySelectorAll('.ltx_authors .ltx_personname')) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('.ltx_note,.ltx_role_footnote,sup,.ltx_contact,.ltx_affiliation').forEach((n) => n.remove());
      out.push(...clone.textContent.split(/[\n,]|\band\b/).map((s) => s.trim()).filter((s) => s.length > 1));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Capturing a selection
  // ---------------------------------------------------------------------------
  const stripSpace = (s) => s.replace(/\s+/g, '');
  const BLOCK = 'p,li,blockquote,dd,dt,td,th,pre,figcaption,h1,h2,h3,h4,h5,h6';

  const rangeElement = (range) => {
    const n = range.commonAncestorContainer;
    return n.nodeType === 1 ? n : n.parentElement;
  };

  function paragraphOf(range) {
    const block = rangeElement(range)?.closest(BLOCK) || rangeElement(range);
    return (block?.innerText || block?.textContent || '').trim().slice(0, 1500);
  }

  function sectionOf(range) {
    const headings = document.querySelectorAll('h1,h2,h3,h4');
    for (let i = headings.length - 1; i >= 0; i--) {
      const h = headings[i];
      if (range.comparePoint(h, 0) <= 0) return h.textContent.trim().slice(0, 200);
    }
    return '';
  }

  // Read Frog's bilingual mode puts its translations inside the page's own text.
  const TRANSLATION = '.read-frog-translated-content-wrapper';
  const TEX_SKIP = `.katex-html,[aria-hidden="true"],style,.MathJax_Preview,.MathJax,.MJX_Assistive_MathML,mjx-container,${TRANSLATION}`;

  // A range's text as the page wrote it, leaving out any translation in between.
  function originalText(range) {
    const fragment = range.cloneContents();
    if (!fragment.querySelector(TRANSLATION)) return range.toString();
    fragment.querySelectorAll(TRANSLATION).forEach((n) => n.remove());
    return fragment.textContent;
  }

  function mathTex(node) {
    if (node.matches?.('math')) {
      const tex = node.getAttribute('alttext') || node.querySelector('annotation[encoding*="tex" i]')?.textContent;
      return tex ? tex.trim() : '';
    }
    if (node.matches?.('.katex')) return node.querySelector('annotation')?.textContent?.trim() || '';
    if (node.matches?.('script[type^="math/tex"]')) return node.textContent.trim();
    return '';
  }

  // Formula markup reads as garbage in plain text, so it is swapped for `$tex$`.
  function quoteFrom(range, plain) {
    const fragment = range.cloneContents();
    if (!fragment.querySelector(`math,.katex,script[type^="math/tex"],${TRANSLATION}`)) return plain;
    const parts = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          parts.push(child.data.replace(/\s+/g, ' '));
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tex = mathTex(child);
        if (tex) {
          parts.push(`$${tex}$`);
          continue;
        }
        if (child.matches(TEX_SKIP) || child.matches('script')) continue;
        const isBlock = child.matches(BLOCK);
        if (isBlock) parts.push('\n\n');
        walk(child);
        if (isBlock) parts.push('\n\n');
      }
    };
    walk(fragment);
    const text = parts.join('').replace(/[ \t]*\n[ \t\n]*/g, (m) => (m.includes('\n\n') ? '\n\n' : '\n')).trim();
    return text || plain;
  }

  // Where each assistant marks its messages. Others fall back to the page's opening text.
  const MESSAGE_SELECTORS = {
    'chatgpt.com': '[data-message-author-role]',
    'chat.openai.com': '[data-message-author-role]',
    'claude.ai': '[data-testid="user-message"],.font-claude-response,.font-claude-message',
    'gemini.google.com': 'user-query,model-response',
    'chat.deepseek.com': '.ds-markdown,[class*="message"]',
  };

  // The first rounds of a conversation, which usually say what paper it is about.
  function conversationOpening(rounds) {
    if (!rounds) return '';
    const host = location.hostname.replace(/^www\./, '');
    const selector = MESSAGE_SELECTORS[host];
    const messages = selector ? [...document.querySelectorAll(selector)] : [];
    if (messages.length) {
      return messages.slice(0, rounds * 2)
        .map((m) => m.innerText?.trim().slice(0, MESSAGE_CHARS))
        .filter(Boolean)
        .join('\n\n');
    }
    const main = document.querySelector('main') || document.body;
    return (main.innerText || '').trim().slice(0, rounds * 2 * MESSAGE_CHARS);
  }

  function captureSelection() {
    const sel = window.getSelection();
    const plain = sel?.toString().trim() || '';
    if (!plain || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const container = rangeElement(range)?.closest(BLOCK) || rangeElement(range) || document.body;
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(container);
    after.setStart(range.endContainer, range.endOffset);
    const rects = range.getClientRects();
    const quote = quoteFrom(range, plain);
    const hasTranslation = Boolean(range.cloneContents().querySelector(TRANSLATION));
    return {
      range,
      exact: (hasTranslation ? quote : plain).slice(0, MAX_QUOTE),
      quote: quote.slice(0, MAX_QUOTE),
      anchor: stripSpace(originalText(range) || range.toString()).slice(0, MAX_QUOTE),
      prefix: stripSpace(originalText(before)).slice(-64),
      suffix: stripSpace(originalText(after)).slice(0, 64),
      paragraph: paragraphOf(range),
      pageSection: sectionOf(range),
      context: state.discussion ? conversationOpening(state.conversationRounds) : '',
      rect: rects.length ? rects[rects.length - 1] : range.getBoundingClientRect(),
      box: range.getBoundingClientRect(),
    };
  }

  // ---------------------------------------------------------------------------
  // Page highlights. The Custom Highlight API paints ranges without changing the
  // page's DOM, so it cannot break a site's layout or scripts.
  // ---------------------------------------------------------------------------
  let highlightSheet = null;

  // One named highlight per color, since that is what `::highlight()` can style.
  function installHighlightStyle() {
    if (!window.CSS?.highlights) return;
    highlightSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
  }

  function paintColors() {
    highlightSheet?.replaceSync(state.colors.map((c) => `::highlight(${HIGHLIGHT_NAME}-${c.id}) { background-color: ${c.mark}; }`).join('\n'));
  }

  function setTheme(value) {
    state.theme = themeName(value);
    if (ui) ui.dataset.theme = state.theme;
  }

  function paint() {
    if (!window.CSS?.highlights) return;
    for (const c of state.colors) {
      const members = !state.showHighlights ? [] : [...ranges].filter(([id]) => (rangeColors.get(id) || state.colors[0].id) === c.id).map(([, r]) => r);
      if (members.length) CSS.highlights.set(`${HIGHLIGHT_NAME}-${c.id}`, new Highlight(...members));
      else CSS.highlights.delete(`${HIGHLIGHT_NAME}-${c.id}`);
    }
  }

  function addRange(id, range, color) {
    ranges.set(id, range);
    rangeColors.set(id, color);
    paint();
  }

  function removeRange(id) {
    ranges.delete(id);
    rangeColors.delete(id);
    known.delete(id);
    unsaved.delete(id);
    paint();
  }

  // All page text with whitespace removed, plus where each character came from.
  function textIndex() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(`script,style,noscript,selectiophile-ui,${TRANSLATION}`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let chars = '';
    const owner = [];
    const offsets = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const data = node.data;
      nodes.push(node);
      for (let i = 0; i < data.length; i++) {
        if (/\s/.test(data[i])) continue;
        chars += data[i];
        owner.push(nodes.length - 1);
        offsets.push(i);
      }
    }
    return { chars, owner, offsets, nodes };
  }

  const commonSuffix = (a, b) => {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
  };
  const commonPrefix = (a, b) => {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
  };

  // The same sentence can appear twice, so surrounding text picks the occurrence.
  function locate(index, { anchor, prefix = '', suffix = '' }) {
    if (!anchor) return null;
    let best = -1;
    let bestScore = -1;
    for (let at = index.chars.indexOf(anchor); at >= 0; at = index.chars.indexOf(anchor, at + 1)) {
      const score = commonSuffix(index.chars.slice(Math.max(0, at - prefix.length), at), prefix)
        + commonPrefix(index.chars.slice(at + anchor.length, at + anchor.length + suffix.length), suffix);
      if (score > bestScore) {
        best = at;
        bestScore = score;
      }
    }
    if (best < 0) return null;
    const end = best + anchor.length - 1;
    const range = document.createRange();
    range.setStart(index.nodes[index.owner[best]], index.offsets[best]);
    range.setEnd(index.nodes[index.owner[end]], index.offsets[end] + 1);
    return range;
  }

  const rangeIsLive = (r) => r && !r.collapsed && r.startContainer.isConnected && r.endContainer.isConnected;

  // Finds highlights with no working range: not rendered yet, or replaced by a re-render.
  function repair() {
    const broken = [...known.values()].filter((h) => !rangeIsLive(ranges.get(h.id)));
    if (!broken.length) return;
    const index = textIndex();
    for (const h of broken) {
      const range = locate(index, h);
      if (range) ranges.set(h.id, range);
      else ranges.delete(h.id);
    }
    paint();
  }

  function restore(highlights) {
    if (!state.showHighlights) return;
    for (const h of highlights) {
      known.set(h.id, h);
      if (h.color) rangeColors.set(h.id, h.color);
    }
    repair();
  }

  function watchForRerenders() {
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (alive()) repair();
      }, REPAIR_DEBOUNCE_MS);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // A selection inside an existing highlight means that highlight, not a new one.
  // Text is compared because a triple-click's range runs on to the next paragraph.
  function highlightContaining(captured) {
    for (const [id, range] of ranges) {
      if (id.startsWith('draft-') || unsaved.has(id) || !rangeIsLive(range)) continue;
      const anchor = known.get(id)?.anchor;
      if (!anchor?.includes(captured.anchor)) continue;
      const overlaps = range.compareBoundaryPoints(Range.END_TO_START, captured.range) < 0
        && range.compareBoundaryPoints(Range.START_TO_END, captured.range) > 0;
      if (overlaps) return id;
    }
    return null;
  }

  function highlightAt(x, y) {
    for (const [id, range] of ranges) {
      if (id.startsWith('draft-') || !rangeIsLive(range)) continue;
      for (const r of range.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Toolbar and comment box
  // ---------------------------------------------------------------------------
  function hideToolbar() {
    toolbar?.remove();
    toolbar = null;
  }

  const colorDot = (c, selected, onClick) => {
    const button = el('button', {
      class: `dot-btn${c.id === selected ? ' on' : ''}`,
      title: `${c.name} · ${c.label}`,
      'aria-label': `${c.name} · ${c.label}`,
      onclick: onClick,
    });
    button.style.setProperty('--dot', c.solid);
    return button;
  };

  function showToolbar(captured) {
    ensureRoot();
    hideToolbar();
    const current = () => captureSelection() || captured;
    const existing = highlightContaining(captured);
    const selected = existing ? rangeColors.get(existing) : state.lastColor;
    const clear = () => {
      hideToolbar();
      window.getSelection()?.removeAllRanges();
    };
    const pick = (c) => {
      if (!existing) {
        hideToolbar();
        saveCaptured(current(), '', c.id);
        return;
      }
      clear();
      recolor(existing, c.id).then((ok) => ok && showToast({ message: t('已改成"{name}"', { name: c.name }) }));
    };
    const comment = () => {
      if (!existing) {
        hideToolbar();
        openComment(current());
        return;
      }
      clear();
      editComment(existing);
    };
    toolbar = el(
      'div',
      { class: `box toolbar${state.toolbarStyle === 'lite' ? ' lite' : ''}`, onmousedown: (e) => e.preventDefault() },
      el('div', { class: 'dots' }, state.colors.map((c) => colorDot(c, selected, () => pick(c)))),
      el('span', { class: 'divider' }),
      el(
        'button',
        { class: 'comment-btn', title: `${existing ? t('修改这条划线的评论') : t('写评论后保存')}${state.shortcuts.comment ? ` (${state.shortcuts.comment})` : ''}`, onclick: comment },
        icon('comment'),
        el('span', { class: 'label' }, t('评论')),
        state.shortcuts.comment ? el('kbd', {}, state.shortcuts.comment) : null,
      ),
    );
    ui.append(toolbar);
    placeToolbar(captured);
    // The other extension may draw its toolbar just after this one.
    for (const delay of TOOLBAR_DODGE_DELAYS) setTimeout(dodgeOtherToolbars, delay);
  }

  // Above the selection, where Phrase Collector doesn't go unless it's out of room.
  function placeToolbar({ box }) {
    const h = toolbar.offsetHeight;
    const w = toolbar.offsetWidth;
    const left = Math.max(8, Math.min(box.left, document.documentElement.clientWidth - w - 8));
    const above = box.top - h - 8;
    const top = above >= 4 ? above : box.bottom + 8;
    toolbar.style.left = `${left + window.scrollX}px`;
    toolbar.style.top = `${top + window.scrollY}px`;
  }

  function otherToolbars() {
    const toolbars = [];
    for (const other of document.querySelectorAll('phrase-collector-ui')) {
      const found = other.shadowRoot?.querySelector('.toolbar');
      if (found) toolbars.push(found.getBoundingClientRect());
    }
    return toolbars;
  }

  function dodgeOtherToolbars() {
    if (!toolbar) return;
    const mine = toolbar.getBoundingClientRect();
    for (const other of otherToolbars()) {
      const overlaps = mine.left < other.right && mine.right > other.left && mine.top < other.bottom && mine.bottom > other.top;
      if (!overlaps) continue;
      const above = other.top - mine.height - 6;
      const top = above >= 4 ? above : other.bottom + 6;
      toolbar.style.top = `${top + window.scrollY}px`;
      return;
    }
  }

  function closePanel() {
    panel?.remove();
    panel = null;
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
  }

  function showPanel(node, rect) {
    ensureRoot();
    closePanel();
    hideToast();
    panel = node;
    panel.addEventListener('keydown', (e) => e.stopPropagation());
    ui.append(panel);
    if (rect) {
      place(panel, rect);
    } else {
      panel.classList.add('fixed');
      panel.style.right = '16px';
      panel.style.bottom = '16px';
    }
  }

  // Number keys and Esc, active only while a prompt is open.
  function bindKeys(handler) {
    keyHandler = (e) => {
      if (handler(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', keyHandler, true);
  }

  function openComment(captured) {
    const tempId = `draft-${crypto.randomUUID()}`;
    let color = state.lastColor;
    addRange(tempId, captured.range, color);
    window.getSelection()?.removeAllRanges();
    const cancel = () => {
      removeRange(tempId);
      closePanel();
    };
    const save = () => {
      const comment = input.value.trim();
      removeRange(tempId);
      closePanel();
      saveCaptured(captured, comment, color);
    };
    const input = el('textarea', {
      placeholder: t('写下你的想法。评论越明确，归类越准。'),
      onkeydown: (e) => {
        if (e.key === 'Escape') cancel();
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
      },
    });
    const swatches = el('div', { class: 'swatches' }, state.colors.map((c) => {
      const chip = el('button', {
        class: `swatch${c.id === color ? ' on' : ''}`,
        title: c.label,
        onclick: () => {
          color = c.id;
          swatches.querySelectorAll('.swatch').forEach((n) => n.classList.toggle('on', n === chip));
          addRange(tempId, captured.range, color);
          // Ctrl+Enter and typing keep working after a color is picked.
          input.focus();
        },
      }, c.name);
      chip.style.setProperty('--dot', c.solid);
      return chip;
    }));
    showPanel(panelShell({
      eyebrow: t('COMMENT · 评论'),
      title: state.note?.label || t('添加评论'),
      iconName: 'comment',
      onClose: cancel,
      body: [el('div', { class: 'sel' }, captured.quote), el('div', { class: 'content' }, input, swatches)],
      foot: [
        el('span', { class: 'hint' }, el('kbd', {}, 'Ctrl+Enter'), t('保存')),
        el('button', { class: 'btn', onclick: cancel }, t('取消')),
        el('button', { class: 'btn primary', onclick: save }, t('保存')),
      ],
    }), captured.box);
    input.focus();
  }

  function saveCaptured(captured, comment, color = state.lastColor) {
    const id = crypto.randomUUID().slice(0, 8);
    state.lastColor = color;
    if (state.showHighlights) {
      unsaved.add(id);
      known.set(id, { id, anchor: captured.anchor, prefix: captured.prefix, suffix: captured.suffix, color });
      addRange(id, captured.range, color);
    }
    // Later highlights in this conversation go by their own text.
    state.conversationRounds = 0;
    window.getSelection()?.removeAllRanges();
    call('job:submit', {
      job: {
        id,
        color,
        quote: captured.quote,
        exact: captured.exact,
        anchor: captured.anchor,
        prefix: captured.prefix,
        suffix: captured.suffix,
        comment,
        paragraph: captured.paragraph,
        pageSection: captured.pageSection,
        context: captured.context,
        rawPage: rawPage(),
      },
    }).catch((e) => {
      removeRange(id);
      showToast({ message: t('保存失败：{message}', { message: e.message }), error: true, sticky: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Toast and the page's status pill
  // ---------------------------------------------------------------------------
  function hideToast() {
    clearTimeout(toastTimer);
    toastEl?.remove();
    toastEl = null;
    if (fabEl && !state.fabPos) fabEl.style.bottom = '';
  }

  // `saved` shows status, note and block; other notices are a single message.
  function showToast({ message, saved, actions = [], error = false, warn = false, sticky = false }) {
    ensureRoot();
    hideToast();
    const body = saved
      ? [
        el('div', { class: 't-status' }, saved.status),
        el('div', { class: 't-title' }, `《${saved.title}》`),
        el('div', { class: 'tag' }, saved.tag),
      ]
      : [el('div', { class: 't-msg' }, message)];
    toastEl = el(
      'div',
      { class: `box fixed toast${error ? ' err' : warn ? ' warn' : ''}` },
      el('span', { class: 'status-dot' }),
      el('div', { class: 't-body' }, body, el('div', { class: 'actions' }, actions)),
    );
    ui.append(toastEl);
    liftFab();
    if (sticky) return;
    const arm = () => {
      clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, TOAST_MS);
    };
    toastEl.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    toastEl.addEventListener('mouseleave', arm);
    arm();
  }

  // Only a floating icon in its default corner can collide with the toast.
  function liftFab() {
    if (fabEl && toastEl && !state.fabPos) fabEl.style.bottom = `${toastEl.offsetHeight + 24}px`;
  }

  function clampFab(pos, size) {
    return {
      left: Math.max(4, Math.min(pos.left, document.documentElement.clientWidth - size - 4)),
      top: Math.max(4, Math.min(pos.top, window.innerHeight - size - 4)),
    };
  }

  function positionFab() {
    if (!fabEl || !state.fabPos) return;
    const { left, top } = clampFab(state.fabPos, fabEl.offsetWidth);
    fabEl.style.left = `${left}px`;
    fabEl.style.top = `${top}px`;
    fabEl.style.right = 'auto';
    fabEl.style.bottom = 'auto';
  }

  // Dragging moves it; a press that barely moves is a click.
  function makeDraggable(fab) {
    let suppressClick = false;
    fab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const box = fab.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      let pos = null;
      fab.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        moved = true;
        fab.classList.add('dragging');
        pos = clampFab({ left: box.left + ev.clientX - start.x, top: box.top + ev.clientY - start.y }, box.width);
        fab.style.left = `${pos.left}px`;
        fab.style.top = `${pos.top}px`;
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
      };
      const up = () => {
        fab.removeEventListener('pointermove', move);
        fab.removeEventListener('pointerup', up);
        fab.removeEventListener('pointercancel', up);
        fab.classList.remove('dragging');
        if (!moved) return;
        suppressClick = true;
        state.fabPos = pos;
        if (alive()) chrome.storage.local.set({ fabPos: pos });
      };
      fab.addEventListener('pointermove', move);
      fab.addEventListener('pointerup', up);
      fab.addEventListener('pointercancel', up);
    });
    fab.addEventListener('click', () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      togglePinPanel();
    });
  }

  function renderFab() {
    fabEl?.remove();
    fabEl = null;
    if (!state.active || !state.showFab) return;
    ensureRoot();
    const pinned = Boolean(state.pinned);
    const label = pinned
      ? t('已钉住：{name}', { name: state.note?.label || state.pinned })
      : state.note ? t('当前：{name}', { name: state.note.label }) : t('钉住一篇笔记');
    fabEl = el('button', { class: `box fixed fab${pinned ? ' on' : ''}`, title: label, 'aria-label': label }, icon('pin'));
    makeDraggable(fabEl);
    ui.append(fabEl);
    positionFab();
    liftFab();
  }

  async function togglePinPanel() {
    if (panel?.dataset.pin) {
      closePanel();
      return;
    }
    let notes;
    try {
      notes = await call('notes:list');
    } catch (e) {
      showFailure(t('读取失败'), e);
      return;
    }
    const setPin = async (name, label) => {
      closePanel();
      await call('pin:set', { noteName: name });
      state.pinned = name;
      if (name) state.note = { name, label };
      await refreshStatus();
    };
    noteChooser({
      eyebrow: t('PIN · 钉住笔记'),
      heading: state.pinned ? t('已钉住：{name}', { name: state.note?.label || state.pinned }) : t('钉住一篇笔记'),
      sub: notes.length ? t('钉住后，所有划线都存到这篇。') : t('还没有笔记'),
      notes,
      anchor: fabEl.getBoundingClientRect(),
      dismissible: 'pin',
      onPick: (n) => setPin(n.name, n.label),
      foot: state.pinned ? [el('button', { class: 'btn', onclick: () => setPin(null) }, t('取消钉住'))] : null,
    });
  }

  // Cleaned up from settings or another tab. New ones arrive through saving, not here.
  function dropRemovedHighlights(stored) {
    for (const id of [...ranges.keys()]) {
      if (!id.startsWith('draft-') && !unsaved.has(id) && !(id in stored)) removeRange(id);
    }
  }

  function clearHighlights() {
    for (const id of [...ranges.keys()]) {
      if (id.startsWith('draft-')) continue;
      ranges.delete(id);
      rangeColors.delete(id);
    }
    known.clear();
    unsaved.clear();
    paint();
  }

  async function refreshStatus() {
    const status = await call('page:status', { rawPage: collectPage() });
    setLang(status.lang);
    state.profile = status.profile;
    state.conversationRounds = status.conversationRounds;
    state.note = status.note;
    state.pinned = status.pinned;
    state.discussion = status.page.discussion;
    state.pageKey = status.page.url;
    state.colors = status.colors;
    state.lastColor ||= status.lastColor;
    paintColors();
    const wasActive = state.active;
    state.active = status.active;
    if (!state.active) {
      // A site just turned off stops at once, without waiting for a reload.
      state.note = null;
      hideToolbar();
      // A page comment, opened from the popup, works on any site.
      if (!panel?.dataset.review) closePanel();
      if (wasActive) clearHighlights();
    }
    renderFab();
    return status;
  }

  const noteList = (notes, onPick) => {
    if (!notes.length) return el('div', { class: 'empty' }, t('没有匹配的笔记'));
    const buttons = notes.map((n, i) => el(
      'button',
      { title: n.title || '', onclick: () => onPick(n) },
      el(i < 9 ? 'kbd' : 'span', { class: 'num' }, i < 9 ? String(i + 1) : ''),
      el('span', { class: 'label' }, n.label),
    ));
    return el('div', { class: 'list' }, buttons);
  };

  // Shows a filterable note list; digits pick while the search box is empty.
  function noteChooser({ eyebrow, heading, sub, error, notes, onPick, onCancel, foot, anchor, dismissible }) {
    const close = () => {
      closePanel();
      onCancel?.();
    };
    let shown = notes;
    const listHolder = el('div', {}, notes.length ? noteList(shown, onPick) : null);
    const search = el('input', {
      placeholder: t('搜索笔记'),
      oninput: () => {
        const q = search.value.trim().toLowerCase();
        shown = notes.filter((n) => `${n.label} ${n.title || ''}`.toLowerCase().includes(q));
        listHolder.replaceChildren(noteList(shown, onPick));
      },
      onkeydown: (e) => {
        if (e.key === 'Escape') close();
        else if (e.key === 'Enter' && shown[0]) onPick(shown[0]);
      },
    });
    const hasBody = error || sub || notes.length;
    const chooser = panelShell({
      eyebrow: eyebrow || t('NOTE · 选择笔记'),
      title: heading,
      iconName: 'book',
      onClose: close,
      body: hasBody
        ? el(
          'div',
          { class: 'content' },
          error ? el('div', { class: 'note-line bad' }, error) : null,
          sub ? el('div', { class: 'note-line' }, sub) : null,
          notes.length ? search : null,
          listHolder,
        )
        : null,
      foot,
    });
    if (dismissible) {
      chooser.dataset.card = '1';
      chooser.dataset[dismissible] = '1';
    }
    showPanel(chooser, anchor);
    bindKeys((e) => {
      if (e.key === 'Escape') {
        close();
        return true;
      }
      if (isInside(e) && e.composedPath()[0]?.tagName === 'INPUT') return false;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && shown[n - 1]) {
        onPick(shown[n - 1]);
        return true;
      }
      return false;
    });
    if (notes.length) search.focus();
  }

  function blockChooser({ title, sub, error, options, onPick, onCancel }) {
    const close = () => {
      closePanel();
      onCancel?.();
    };
    const rows = options.map((o, i) => {
      const row = el(
        'button',
        { onclick: () => onPick(o) },
        el(i < 9 ? 'kbd' : 'span', { class: 'num' }, i < 9 ? String(i + 1) : ''),
        el('span', { class: 'label' }, o.block),
        o.p != null ? el('span', { class: 'pct' }, `${Math.round(o.p * 100)}%`) : null,
      );
      if (o.p != null) row.style.setProperty('--p', `${Math.round(o.p * 100)}%`);
      return row;
    });
    showPanel(panelShell({
      eyebrow: t('BLOCK · 选择内容块'),
      title,
      iconName: 'layers',
      onClose: close,
      body: el(
        'div',
        { class: 'content' },
        error ? el('div', { class: 'note-line bad' }, error) : null,
        sub ? el('div', { class: 'note-line' }, sub) : null,
        el('div', { class: 'list' }, rows),
      ),
    }));
    bindKeys((e) => {
      if (e.key === 'Escape') {
        close();
        return true;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && options[n - 1]) {
        onPick(options[n - 1]);
        return true;
      }
      return false;
    });
  }

  // ---------------------------------------------------------------------------
  // Save outcomes from the background
  // ---------------------------------------------------------------------------
  // By name alone, because the folder's path inside the vault is unknown here.
  const obsidianUrl = (noteName, heading) => {
    const file = `${noteName.split('/').pop().replace(/\.md$/, '')}${heading ? `#${heading}` : ''}`;
    return `obsidian://open?file=${encodeURIComponent(file)}`;
  };

  const blockReason = (reason) => ({
    'low-confidence': t('Jev 不太确定，请选择内容块'),
    'no-key': t('还没有配置 Jev Key，请手动选择'),
    'heading-missing': t('这篇笔记里没有该标题，请重新选择'),
  })[reason];

  function onSaved(update) {
    unsaved.delete(update.id);
    closePanel();
    state.note = { name: update.noteName, label: update.noteLabel };
    renderFab();
    savedToast(update);
  }

  const savedPrefix = (via) => ({
    recent: t('讨论已存入最近一篇'),
    pinned: t('已存入钉住的笔记'),
    'discussion-jev': t('讨论已存入 Jev 判断的笔记'),
    discussion: t('讨论已存入关联的笔记'),
  })[via];

  function savedToast({ id, noteName, noteLabel, heading, created, noteVia, clip }) {
    showToast({
      saved: {
        status: created ? t('新建并存入') : savedPrefix(noteVia) || t('已存入'),
        title: noteLabel,
        tag: heading,
      },
      actions: [
        el('button', { onclick: () => undo(id) }, t('撤销')),
        el('button', { onclick: () => editComment(id) }, t('评论')),
        el('button', { onclick: () => changeEntry(id, noteName) }, t('改位置')),
        clip?.state === 'offer' ? el('button', { class: 'clip-btn', onclick: () => clipOriginal(noteName) }, t('剪藏原文')) : null,
        el('a', { href: obsidianUrl(noteName, heading) }, t('打开')),
      ],
    });
    if (clip?.state === 'auto') noteOnToast(t('正在剪藏原文…'));
  }

  // ---------------------------------------------------------------------------
  // Clipping the original
  // ---------------------------------------------------------------------------
  const clipMessage = ({ status, label, linked }) => {
    const done = {
      created: t('原文已剪藏：{name}', { name: label }),
      updated: t('原文已重新剪藏：{name}', { name: label }),
      existing: t('原文已在库中：{name}', { name: label }),
    }[status];
    return linked ? t('{message}，已关联到笔记', { message: done }) : done;
  };

  // A line added to the save's toast keeps its undo button within reach.
  function noteOnToast(message) {
    const body = toastEl?.querySelector('.t-title') && toastEl.querySelector('.t-body');
    if (!body) return false;
    body.querySelector('.t-clip')?.remove();
    body.insertBefore(el('div', { class: 't-msg t-clip' }, message), body.querySelector('.actions'));
    liftFab();
    return true;
  }

  function showClipped(result) {
    const message = result.warning ? `${clipMessage(result)}\n${result.warning}` : clipMessage(result);
    if (noteOnToast(message)) {
      toastEl.querySelector('.clip-btn')?.remove();
      return;
    }
    showToast({ message, actions: [el('a', { href: obsidianUrl(result.file) }, t('打开'))] });
  }

  async function clipOriginal(noteName) {
    toastEl?.querySelector('.clip-btn')?.setAttribute('disabled', '');
    if (!noteOnToast(t('正在剪藏原文…'))) showToast({ message: t('正在剪藏原文…'), sticky: true });
    try {
      showClipped(await call('clip:run', { noteName }));
    } catch (e) {
      showFailure(t('剪藏失败'), e);
    }
  }

  // Offers the way out when the failure is an expired folder permission.
  function showFailure(prefix, e) {
    const grant = e.code === 'needs-permission'
      ? el('button', { class: 'primary', onclick: () => { hideToast(); call('options:open'); } }, t('打开设置'))
      : null;
    showToast({ message: t('{prefix}：{message}', { prefix, message: e.message }), error: true, sticky: true, actions: [grant, el('button', { onclick: hideToast }, t('关闭'))] });
  }

  async function undo(id) {
    hideToast();
    try {
      const { deletedNote } = await call('entry:remove', { id, pageKey: state.pageKey });
      removeRange(id);
      if (deletedNote) state.note = null;
      renderFab();
      showToast({ message: deletedNote ? t('已撤销，并删除了刚新建的笔记') : t('已撤销') });
    } catch (e) {
      showFailure(t('撤销失败'), e);
    }
  }

  async function deleteHighlight(id, message) {
    closePanel();
    try {
      await call('entry:remove', { id, pageKey: state.pageKey, keepNote: true });
      removeRange(id);
      showToast({ message });
    } catch (e) {
      showFailure(t('删除失败'), e);
    }
  }

  // Deleting can lose a comment edited in Obsidian, so it takes a second click.
  function deleteButton(id) {
    const button = el('button', { class: 'danger', onclick: () => {
      if (button.dataset.armed) return deleteHighlight(id, t('已删除划线和笔记里的这条'));
      button.dataset.armed = '1';
      button.classList.add('confirming');
      button.textContent = t('确认删除');
      return undefined;
    } }, t('删除'));
    return button;
  }

  async function recolor(id, color) {
    try {
      await call('entry:recolor', { id, pageKey: state.pageKey, color });
    } catch (e) {
      showFailure(t('改颜色失败'), e);
      return false;
    }
    rangeColors.set(id, color);
    if (known.has(id)) known.get(id).color = color;
    state.lastColor = color;
    paint();
    return true;
  }

  function cardSwatches(id) {
    const row = el('div', { class: 'swatches' }, state.colors.map((c) => {
      const chip = el('button', {
        class: `swatch${c.id === (rangeColors.get(id) || state.colors[0].id) ? ' on' : ''}`,
        title: t('改成{label}', { label: c.label }),
        onclick: async () => {
          if (!(await recolor(id, c.id))) return;
          row.querySelectorAll('.swatch').forEach((n) => n.classList.toggle('on', n === chip));
        },
      }, c.name);
      chip.style.setProperty('--dot', c.solid);
      return chip;
    }));
    return row;
  }

  // Adds, changes or, when emptied, removes the comment on a saved highlight.
  async function editComment(id) {
    hideToast();
    let info;
    try {
      info = await call('entry:inspect', { id, pageKey: state.pageKey });
    } catch (e) {
      return showFailure(t('读取失败'), e);
    }
    if (!info.exists) return showToast({ message: t('笔记里已没有这条划线'), warn: true });
    if (info.comment === null) return showToast({ message: t('这条是旧格式，请在 Obsidian 里修改评论'), warn: true });
    const close = () => closePanel();
    const save = async () => {
      const text = input.value;
      closePanel();
      try {
        const { comment } = await call('entry:setComment', { id, pageKey: state.pageKey, comment: text });
        showToast({ message: comment ? t('评论已保存') : t('评论已删除') });
      } catch (e) {
        showFailure(t('保存评论失败'), e);
      }
    };
    const input = el('textarea', {
      placeholder: t('写下你的想法。'),
      onkeydown: (e) => {
        if (e.key === 'Escape') close();
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
      },
    });
    input.value = info.comment;
    const range = ranges.get(id);
    const rect = rangeIsLive(range) ? range.getBoundingClientRect() : null;
    showPanel(panelShell({
      eyebrow: info.comment ? t('COMMENT · 修改评论') : t('COMMENT · 补充评论'),
      title: info.noteLabel,
      iconName: 'comment',
      onClose: close,
      body: [
        rangeIsLive(range) ? el('div', { class: 'sel' }, range.toString().trim()) : null,
        el('div', { class: 'content' }, input),
      ],
      foot: [
        el('span', { class: 'hint' }, el('kbd', {}, 'Ctrl+Enter'), t('保存')),
        el('button', { class: 'btn', onclick: close }, t('取消')),
        el('button', { class: 'btn primary', onclick: save }, t('保存')),
      ],
    }), rect);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return undefined;
  }

  // A page comment: a short review of the whole page, kept as `comments` in its note.
  async function openReview() {
    let status;
    try {
      status = await call('review:status', { url: location.href, rawPage: collectPage() });
    } catch (e) {
      return showFailure(t('打开简评失败'), e);
    }
    if (!status.available) return showToast({ message: t('这个网页不能写简评'), warn: true });
    const close = () => closePanel();
    const save = async () => {
      const text = input.value;
      closePanel();
      try {
        const r = await call('review:save', { url: location.href, rawPage: collectPage(), text });
        // A clip under way reports when it is done.
        if (!r.text) showToast({ message: t('简评已删除') });
        else if (r.clipping) showToast({ message: r.state === 'updated' ? t('简评已写入笔记：{name}，正在剪藏原文…', { name: r.label }) : t('简评已保存，正在剪藏原文…'), sticky: true });
        else if (r.state === 'updated') showToast({ message: t('简评已写入笔记：{name}', { name: r.label }) });
        else showToast({ message: t('简评已保存，这篇有笔记后会写进笔记') });
      } catch (e) {
        showFailure(t('保存简评失败'), e);
      }
    };
    const input = el('textarea', {
      placeholder: t('这篇文章值不值得读？主要收获、疑问或用途，几句话即可。'),
      maxlength: String(status.maxChars),
      onkeydown: (e) => {
        if (e.key === 'Escape') close();
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
      },
    });
    input.value = status.text;
    const where = [
      status.note ? t('写入笔记：{name}', { name: status.note }) : t('还没有这篇的笔记，有笔记后写进笔记'),
      status.auto && !status.clipped ? t('保存后，这篇原文会自动剪藏入库') : '',
    ].filter(Boolean).join(t('；'));
    const box = panelShell({
      eyebrow: status.text ? t('COMMENTS · 修改简评') : t('COMMENTS · 简评'),
      title: status.title || document.title,
      iconName: 'comment',
      onClose: close,
      className: 'review',
      body: [el('div', { class: 'content' }, input, el('div', { class: 'review-where' }, where))],
      foot: [
        el('span', { class: 'hint' }, el('kbd', {}, 'Ctrl+Enter'), t('保存')),
        el('button', { class: 'btn', onclick: close }, t('取消')),
        el('button', { class: 'btn primary', onclick: save }, t('保存')),
      ],
    });
    box.dataset.review = '1';
    showPanel(box);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    return undefined;
  }

  // Asks where the entry is now, since it may have been moved or removed in Obsidian.
  async function openCard(id, x, y) {
    let info;
    try {
      info = await call('entry:inspect', { id, pageKey: state.pageKey });
    } catch (e) {
      if (e.code !== 'needs-permission') return showFailure(t('读取失败'), e);
      return showFailure(t('需要授权'), e);
    }
    const close = () => closePanel();
    const card = info.exists
      ? panelShell({
        eyebrow: t('HIGHLIGHT · 这条划线'),
        title: info.noteLabel,
        iconName: 'mark',
        className: 'card',
        onClose: close,
        body: el(
          'div',
          { class: 'content' },
          el('div', { class: 'tag' }, info.heading || t('未找到标题')),
          info.comment
            ? el('div', { class: 'comment-text' }, info.comment)
            : info.comment === '' ? el('div', { class: 'comment-text none' }, t('还没有评论')) : null,
          cardSwatches(id),
        ),
        foot: el(
          'div',
          { class: 'actions' },
          el('a', { href: obsidianUrl(info.noteName, info.heading) }, t('打开')),
          info.comment === null ? null : el('button', { onclick: () => editComment(id) }, info.comment ? t('改评论') : t('加评论')),
          el('button', { onclick: () => changeEntry(id, info.noteName) }, t('改位置')),
          deleteButton(id),
        ),
      })
      : panelShell({
        eyebrow: t('HIGHLIGHT · 这条划线'),
        title: t('笔记里已没有这条划线'),
        iconName: 'mark',
        className: 'card',
        onClose: close,
        body: el('div', { class: 'content' }, el('div', { class: 'note-line' }, t('它可能在 Obsidian 里被删除了。'))),
        foot: el('div', { class: 'actions' }, el('button', { onclick: () => deleteHighlight(id, t('已清除高亮')) }, t('清除高亮'))),
      });
    card.dataset.card = '1';
    showPanel(card, { right: x, bottom: y, top: y });
    bindKeys((e) => {
      if (e.key !== 'Escape') return false;
      closePanel();
      return true;
    });
    return undefined;
  }

  // Waits to see whether this is the start of a double or triple click, which means
  // the reader is selecting text, not asking about the highlight.
  function onHighlightClick(e) {
    clearTimeout(cardTimer);
    if (e.button !== 0 || e.detail > 1 || isInside(e) || !window.getSelection()?.isCollapsed) return;
    if (e.target?.closest?.('a,button,input,textarea,select,summary,[contenteditable="true"]')) return;
    const id = highlightAt(e.clientX, e.clientY);
    if (!id) return;
    const { clientX: x, clientY: y } = e;
    cardTimer = setTimeout(() => {
      if (window.getSelection()?.isCollapsed) openCard(id, x, y);
    }, CARD_DELAY_MS);
  }

  async function moveTo(id, noteName, heading) {
    closePanel();
    try {
      const moved = await call('entry:move', { id, pageKey: state.pageKey, noteName, heading });
      state.note = { name: moved.noteName, label: moved.noteLabel };
      renderFab();
      savedToast({ id, noteName: moved.noteName, noteLabel: moved.noteLabel, heading: moved.heading, created: false });
    } catch (e) {
      showFailure(t('移动失败'), e);
    }
  }

  async function chooseHeadingFor(id, noteName, label) {
    const headings = await call('headings:list', { noteName });
    blockChooser({
      title: t('移到哪个内容块？'),
      sub: `《${label}》`,
      options: headings.map((h) => ({ block: h, p: null })),
      onPick: ({ block }) => moveTo(id, noteName, block),
    });
  }

  async function changeEntry(id, currentNote) {
    hideToast();
    try {
      const notes = await call('notes:list');
      noteChooser({
        heading: t('改到哪篇笔记？'),
        sub: t('第一项是当前笔记'),
        notes: [...notes.filter((n) => n.name === currentNote), ...notes.filter((n) => n.name !== currentNote)],
        onPick: (n) => chooseHeadingFor(id, n.name, n.label).catch((e) => showToast({ message: e.message, error: true })),
      });
    } catch (e) {
      showFailure(t('读取失败'), e);
    }
  }

  const templateLabel = ({ templateId, templateName }) =>
    ({ paper: t('学术文献模板'), article: t('网页文章模板') })[templateId] || t('{name}模板', { name: templateName });

  function onConfirmNote(update) {
    const cancel = () => {
      removeRange(update.id);
      call('job:cancel', { id: update.id }).catch(() => {});
    };
    const titleInput = el('input', { value: update.suggestedTitle || '', placeholder: t('新笔记标题') });
    const create = () => {
      closePanel();
      call('job:confirm', { id: update.id, createNote: true, title: titleInput.value.trim() }).catch(showError);
    };
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') create();
    });
    noteChooser({
      heading: t('这条划线存到哪篇笔记？'),
      error: update.jevError ? t('Jev 不可用：{error}', { error: update.jevError }) : null,
      sub: update.templateFolder
        ? t('新建时使用模板：{name}，保存到 {folder}', { name: templateLabel(update), folder: update.templateFolder })
        : t('新建时使用模板：{name}', { name: templateLabel(update) }),
      notes: update.candidates,
      onPick: (n) => {
        closePanel();
        call('job:confirm', { id: update.id, noteName: n.name }).catch(showError);
      },
      onCancel: cancel,
      foot: [titleInput, el('button', { class: 'btn primary', onclick: create }, t('新建'))],
    });
    if (!update.candidates.length) titleInput.focus();
  }

  function onConfirmBlock(update) {
    blockChooser({
      title: blockReason(update.reason) || t('Jev 暂时不可用，请手动选择'),
      sub: update.noteLabel ? `《${update.noteLabel}》` : null,
      error: update.reason === 'jev-error' ? update.error : null,
      options: update.options,
      // Across several notes, each choice names its own note and heading.
      onPick: (o) => {
        closePanel();
        call('job:confirm', { id: update.id, heading: o.heading || o.block, noteName: o.noteName }).catch(showError);
      },
      onCancel: () => {
        removeRange(update.id);
        call('job:cancel', { id: update.id }).catch(() => {});
      },
    });
  }

  const showError = (e) => showToast({ message: e.message, error: true, sticky: true, actions: [el('button', { onclick: hideToast }, t('关闭'))] });

  function onUpdate(update) {
    switch (update.state) {
      case 'saved':
        return onSaved(update);
      case 'confirm-note':
        return onConfirmNote(update);
      case 'confirm-block':
        return onConfirmBlock(update);
      case 'needs-permission':
        return showToast({
          message: t('划线已暂存。请到设置页重新授权笔记文件夹，授权后会自动写入。'),
          warn: true,
          sticky: true,
          actions: [el('button', { class: 'primary', onclick: () => { hideToast(); call('options:open'); } }, t('打开设置'))],
        });
      case 'needs-folder':
        return showToast({
          message: t('划线已暂存。请先在设置里选择 Selectiophile 文件夹。'),
          warn: true,
          sticky: true,
          actions: [el('button', { class: 'primary', onclick: () => { hideToast(); call('options:open'); } }, t('打开设置'))],
        });
      case 'error':
        return showToast({
          message: t('划线已暂存，但写入失败：{message}', { message: update.message }),
          error: true,
          sticky: true,
          actions: [
            el('button', { onclick: () => { hideToast(); call('job:resume', { id: update.id }).catch(showError); } }, t('重试')),
            el('button', { onclick: hideToast }, t('稍后')),
          ],
        });
      default:
        return undefined;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'job:update') onUpdate(msg);
    if (msg.type === 'review:open') openReview();
    if (msg.type === 'clip:update') {
      if (msg.state === 'clipped') showClipped(msg);
      else showFailure(t('剪藏失败'), msg);
    }
  });

  // ---------------------------------------------------------------------------
  // Page events
  // ---------------------------------------------------------------------------
  document.addEventListener('mousedown', (e) => {
    if (isInside(e)) return;
    hideToolbar();
    if (panel?.dataset.card) closePanel();
  }, true);

  document.addEventListener('click', onHighlightClick);

  document.addEventListener('mouseup', (e) => {
    if (isInside(e) || e.button !== 0 || isEditable(e.target)) return;
    setTimeout(() => {
      if (!state.active) return;
      const captured = captureSelection();
      if (captured) showToolbar(captured);
    }, 10);
  }, true);

  document.addEventListener('selectionchange', () => {
    if (toolbar && !window.getSelection()?.toString().trim()) hideToolbar();
  });

  document.addEventListener('keydown', (e) => {
    if (!state.active || isInside(e) || isEditable(e.target)) return;
    const combo = comboFromEvent(e);
    if (combo && combo === state.shortcuts.review) {
      e.preventDefault();
      e.stopPropagation();
      hideToolbar();
      openReview();
      return;
    }
    const saving = combo && combo === state.shortcuts.save;
    const commenting = combo && combo === state.shortcuts.comment;
    if (!saving && !commenting) return;
    const captured = captureSelection();
    if (!captured) return;
    e.preventDefault();
    e.stopPropagation();
    hideToolbar();
    const existing = highlightContaining(captured);
    if (existing) {
      window.getSelection()?.removeAllRanges();
      if (commenting) editComment(existing);
      else openCard(existing, captured.box.left + captured.box.width / 2, captured.box.bottom);
    } else if (saving) {
      saveCaptured(captured, '');
    } else {
      openComment(captured);
    }
  }, true);

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------
  // Single-page apps change the URL without reloading, so this script stays running
  // across chats. A hash change is the same page and keeps its highlights.
  function watchForNavigation() {
    const pageUrl = () => location.href.split('#')[0];
    let last = pageUrl();
    const timer = setInterval(async () => {
      if (!alive()) return clearInterval(timer);
      if (pageUrl() === last) return undefined;
      last = pageUrl();
      hideToolbar();
      if (panel?.dataset.card) closePanel();
      clearHighlights();
      const status = await refreshStatus();
      if (status.active) restore(status.highlights);
      return undefined;
    }, NAVIGATION_POLL_MS);
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.toolbarStyle) state.toolbarStyle = changes.toolbarStyle.newValue || 'standard';
    if (!alive()) return;
    if (changes.shortcuts) state.shortcuts = shortcutsOf(changes.shortcuts.newValue);
    if (changes.showFab) {
      state.showFab = changes.showFab.newValue !== false;
      if (!state.showFab && panel?.dataset.pin) closePanel();
      renderFab();
    }
    if (changes.showHighlights) {
      state.showHighlights = changes.showHighlights.newValue !== false;
      if (state.showHighlights) refreshStatus().then((status) => restore(status.highlights)).catch(() => {});
      else clearHighlights();
    }
    const records = state.pageKey && changes[`hl:${state.pageKey}`];
    if (records) dropRemovedHighlights(records.newValue || {});
    if (changes.fabPos) {
      state.fabPos = changes.fabPos.newValue || null;
      positionFab();
    }
    if (changes.settings || changes.colors || changes.lang || changes.profiles || changes.profileChoices) refreshStatus().then(paint).catch(() => {});
    if (changes.siteMode || changes.sites || changes.blockedSites) {
      const wasActive = state.active;
      refreshStatus().then((status) => {
        if (status.active && !wasActive) restore(status.highlights);
      }).catch(() => {});
    }
    if (changes.theme) setTheme(changes.theme.newValue);
  });

  async function start() {
    const stored = await chrome.storage.local.get(['theme', 'toolbarStyle', 'fabPos', 'shortcuts', 'showHighlights', 'showFab']);
    state.showFab = stored.showFab !== false;
    state.shortcuts = shortcutsOf(stored.shortcuts);
    state.showHighlights = stored.showHighlights !== false;
    state.theme = themeName(stored.theme);
    state.toolbarStyle = stored.toolbarStyle || 'standard';
    state.fabPos = stored.fabPos || null;
    window.addEventListener('resize', positionFab);
    installHighlightStyle();
    watchForRerenders();
    watchForNavigation();
    const status = await refreshStatus();
    if (!status.active) return;
    restore(status.highlights);
    paint();
    for (const id of status.pendingIds) call('job:resume', { id }).catch(() => {});
  }

  start().catch((e) => console.debug('Selectiophile:', e.message));
})();
