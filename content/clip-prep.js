// Prepares a copy of the page for clipping into an archive: the article as
// published, which a person or an AI can go back to without loss. It works on a copy,
// so nothing here touches the page being read.
//
// - Read Frog's translations are left out: the archive holds the original only.
// - Each formula becomes <math data-latex>, from the formula userscript's marks, the
//   MathML MathJax keeps, or MathJax 2's TeX, so clipping needs no userscript.
// - In the parts a config clips, figures, tables, equations and references get block
//   ids, and the text's links to them become links within the file. Publishers mark
//   these in their own ways; the ways of the platforms behind most journals (Springer
//   Nature, Atypon, Silverchair, MDPI, Elsevier) are known here, so a config only says
//   where the article is and what to leave out.
//
// Marks left for core/archive.js, which turns them into Obsidian links and block ids:
//   ⟬A:id⟭            the block it ends up in gets the block id ^id
//   ⟬L:id⟭text⟬/L⟭     a link to block ^id, or to heading n when id is hn
//   ⟬H:n⟭             heading n, which links point to
(() => {
  if (globalThis.SelectiophileClipPrep) return;

  const ATOM = '.read-frog-inline-atom';
  const WRAP = '.read-frog-translated-content-wrapper';
  const BLOCK = '.read-frog-translated-block-content';

  const latexOf = (mml) => {
    try {
      return globalThis.SelectiophileClipper.mathmlToLatex(mml).trim();
    } catch {
      return '';
    }
  };
  const latexOfElement = (el) => latexOf(el.innerHTML.includes('<math') ? el.innerHTML : el.outerHTML);

  // The userscript's mark is the first attribute, as its configs find it by how the tag starts.
  const setFirstAttr = (el, name, value) => {
    const attrs = [...el.attributes].map((a) => [a.name, a.value]);
    attrs.forEach(([n]) => el.removeAttribute(n));
    el.setAttribute(name, value);
    attrs.forEach(([n, v]) => { if (n !== name) el.setAttribute(n, v); });
  };
  const tagged = (m) => m.getAttribute('data-latex') || m.getAttribute('data-blatex') || '';
  const isDisplay = (c) => c.getAttribute('display') === 'true';
  const inTranslation = (el) => el.closest(ATOM) || el.closest(WRAP);

  // Formulas MathJax rendered get their LaTeX from what the page's MathJax holds of
  // them (`mathml`, by position among mjx-container, translations included, so this
  // runs before they are dropped): the TeX the authors wrote, else LaTeX made from
  // MathML. A formula drawn as SVG (MathJax's SVG output) or not drawn yet (lazy) has
  // no mjx-math: one is made to carry the LaTeX.
  function tagOriginalMath(doc, mathml = []) {
    const all = doc.querySelectorAll('mjx-container');
    for (const { index, tex, mml, display } of mathml) {
      const c = all[index];
      if (!c || inTranslation(c)) continue;
      const existing = c.querySelector('mjx-math');
      if (existing && tagged(existing)) continue;
      const latex = tex || (mml ? latexOf(mml) : '');
      const m = latex && mathOf(doc, c);
      if (m) setFirstAttr(m, display ?? isDisplay(c) ? 'data-blatex' : 'data-latex', latex);
    }
  }

  // A formula's glyphs: its text, or with MathJax 3's CHTML output (science.org),
  // which has no text, the code points in its glyph classes (mjx-c1D43E is U+1D43E).
  // Drawn as SVG, the code points are in the drawing's data-c attributes. A drawing
  // already replaced left its key behind.
  const glyphKey = (c) => {
    if (!c) return '';
    const m = c.querySelector('mjx-math');
    if (m && m.dataset.cfixKey) return m.dataset.cfixKey;
    let text = '';
    if (m) {
      text = m.textContent.replace(/\s+/g, '');
      if (!text) text = [...m.querySelectorAll('mjx-c')].map((g) => (String(g.className).match(/\bmjx-c([0-9A-F]+)\b/) || ['', '?'])[1]).join('.');
    } else {
      const svg = c.querySelector(':scope > svg');
      if (svg) text = [...svg.querySelectorAll('[data-c]')].map((g) => g.getAttribute('data-c').toUpperCase()).join('.');
    }
    return text ? (isDisplay(c) ? 'D:' : 'I:') + text : '';
  };

  // A formula drawn as SVG, or not drawn yet, gets an mjx-math in place of the drawing
  // or its placeholder, for the LaTeX.
  const mathOf = (doc, c) => {
    let m = c.querySelector('mjx-math');
    if (m) return m;
    if (!c.querySelector(':scope > svg, :scope > mjx-lazy')) return null;
    m = doc.createElement('mjx-math');
    const key = glyphKey(c);
    if (key) m.dataset.cfixKey = key;
    c.replaceChildren(m);
    return m;
  };

  // MDPI: a table shown in a popup is copied back to where the text refers to it, and
  // takes over the id the text's links point to.
  function inlineMdpiTables(doc, url) {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* no address, no MDPI */ }
    if (!/mdpi\.com$/.test(host)) return;
    doc.querySelectorAll('#article-contents .html-table-wrap[id]:not(.cfix-stub)').forEach((wrap) => {
      const popup = doc.getElementById(`table_body_display_${wrap.id}`);
      if (!popup) return;
      const copy = doc.createElement('div');
      copy.className = 'cfix-table-inline';
      [...popup.children].forEach((child) => {
        const c = child.cloneNode(true);
        c.removeAttribute('id');
        c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
        copy.appendChild(c);
      });
      wrap.after(copy);
      copy.id = wrap.id;
      wrap.removeAttribute('id');
      wrap.classList.add('cfix-stub');
      popup.classList.add('cfix-inlined');
    });
  }

  // A property is one line, and a file name made from a title too: ACS breaks its
  // citation_title over lines, which the name filter would close up ("BuildMachine").
  function oneLineMeta(doc) {
    doc.querySelectorAll('meta[content]').forEach((m) => {
      const value = m.getAttribute('content');
      if (/[\r\n]/.test(value)) m.setAttribute('content', value.replace(/\s*[\r\n]+\s*/g, ' ').trim());
    });
  }

  // What the page holds, for checking the clip afterwards.
  function pageStats(doc) {
    const original = (el) => !inTranslation(el);
    const mathjax3 = [...doc.querySelectorAll('mjx-container')].filter(original).length;
    const mathjax2 = [...doc.querySelectorAll('script[type^="math/tex"]')].filter(original).length;
    const mathml = [...doc.querySelectorAll('math')].filter((m) => original(m) && !m.closest('mjx-container, .MathJax_SVG, .MathJax, .MJX_Assistive_MathML')).length;
    return { formulas: mathjax3 + mathjax2 + mathml, translations: doc.querySelectorAll(BLOCK).length };
  }

  const A = (id) => `⟬A:${id}⟭`;
  const L = (id, text) => `⟬L:${id}⟭${text}⟬/L⟭`;
  const H = (n) => `⟬H:${n}⟭`;

  // The parts of the page a config clips; everything below works inside them only,
  // so the properties, read from the same copy, see the page as it is.
  function rootsOf(doc, selectors) {
    const roots = [];
    for (const selector of selectors) {
      try {
        doc.querySelectorAll(selector).forEach((el) => {
          if (roots.some((r) => r.contains(el))) return;
          for (let i = roots.length - 1; i >= 0; i--) if (el.contains(roots[i])) roots.splice(i, 1);
          roots.push(el);
        });
      } catch { /* a selector this browser can't read */ }
    }
    return roots;
  }
  const within = (roots, selector) => roots.flatMap((r) => [...r.querySelectorAll(selector)]);
  const inRoots = (roots, el) => roots.some((r) => r.contains(el));

  // Read Frog puts each translation inside the page's own text, in its wrapper.
  function dropTranslations(doc) {
    doc.querySelectorAll(WRAP).forEach((w) => w.remove());
  }

  // Every formula as <math data-latex>, which the Markdown converter writes as $…$ or
  // $$…$$. The `x` keeps it from being dropped as empty.
  const MATHJAX2_RENDERING = '.MathJax_Preview, .MathJax_SVG_Display, .MathJax_SVG, .MathJax_Display, .MathJax_CHTML, .MJX_Assistive_MathML, span.MathJax';
  function mathElement(doc, latex, block) {
    const m = doc.createElement('math');
    m.setAttribute('data-latex', latex.trim());
    if (block) m.setAttribute('display', 'block');
    m.textContent = 'x';
    return m;
  }
  function normalizeMath(doc) {
    doc.querySelectorAll('mjx-container').forEach((c) => {
      const m = c.querySelector('mjx-math');
      let latex = m ? tagged(m) : '';
      const mml = c.querySelector('mjx-assistive-mml');
      if (!latex && mml) latex = latexOfElement(mml);
      // Without its LaTeX or MathML a formula is left to the converter, which reads
      // what it can from MathJax's output.
      if (latex) c.replaceWith(mathElement(doc, latex, isDisplay(c) || m?.hasAttribute('data-blatex')));
    });
    // MathJax 2 (nature.com) keeps each formula's TeX in a script beside its rendering.
    doc.querySelectorAll('script[type^="math/tex"]').forEach((s) => {
      s.replaceWith(mathElement(doc, s.textContent, /mode\s*=\s*display/.test(s.type)));
    });
    doc.querySelectorAll(MATHJAX2_RENDERING).forEach((r) => {
      if (!r.querySelector('math[data-latex]')) r.remove();
    });
    // nature.com before MathJax ran: the TeX itself.
    doc.querySelectorAll('span.mathjax-tex').forEach((s) => {
      if (s.children.length) return;
      const text = s.textContent.trim();
      const block = text.match(/^\$\$([\s\S]+)\$\$$/) || text.match(/^\\\[([\s\S]+)\\\]$/);
      const inline = text.match(/^\\\(([\s\S]+)\\\)$/) || text.match(/^\$([^$]+)\$$/);
      if (block || inline) s.replaceWith(mathElement(doc, (block || inline)[1], Boolean(block)));
    });
    // The converter reads a formula inside an element classed `math` or `katex` as that
    // element's text, which is now the placeholder.
    doc.querySelectorAll('math[data-latex]').forEach((m) => {
      for (let el = m.parentElement, i = 0; el && i < 4; el = el.parentElement, i++) {
        [...el.classList].filter((c) => /^(math|katex.*|mathjax.*|mjx.*|tex|latex)$/i.test(c)).forEach((c) => el.classList.remove(c));
      }
    });
  }

  // A <p> holding blocks, which only scripts can make, falls apart when its HTML is
  // read again (ACS): it becomes a <div>. A <div> inside a line of text (ACS's
  // reference entries put each name in one) becomes a <span>, so the line stays one.
  const BLOCK_TAGS = 'div, p, figure, table, ul, ol, section, blockquote, h1, h2, h3, h4, h5, h6';
  const INLINE_TAGS = new Set(['SPAN', 'A', 'I', 'B', 'EM', 'STRONG', 'SUB', 'SUP', 'CITE', 'LABEL', 'SMALL', 'U']);
  const rename = (doc, el, tag) => {
    const copy = doc.createElement(tag);
    for (const a of el.attributes) copy.setAttribute(a.name, a.value);
    copy.append(...el.childNodes);
    el.replaceWith(copy);
  };
  function fixParagraphs(doc, roots) {
    for (const p of within(roots, 'p').reverse()) if (p.querySelector(BLOCK_TAGS)) rename(doc, p, 'div');
    for (const div of within(roots, 'div').reverse()) {
      if (INLINE_TAGS.has(div.parentElement?.tagName) && !div.querySelector(BLOCK_TAGS)) rename(doc, div, 'span');
    }
  }

  // A list item drawing its own bullet or number ("•" in a span of its own, as
  // Elsevier does) would show it twice: the list has its own.
  function fixLists(roots) {
    for (const li of within(roots, 'li')) {
      const first = [...li.childNodes].find((n) => n.nodeType === 1 || n.textContent.trim());
      if (first?.nodeType === 1 && /^[•●◦▪▫■□–—-]$/.test(first.textContent.trim())) first.remove();
    }
  }

  // Images at their full address, and the image itself rather than a link around it
  // to a bigger view.
  function fixImages(doc, roots, url) {
    const absolute = (value) => {
      if (!value || /^(data|blob):/.test(value) || /^\.\.?\//.test(value)) return value;
      try { return new URL(value, url || undefined).href; } catch { return value; }
    };
    for (const img of within(roots, 'img')) {
      const large = img.getAttribute('data-large');
      const lazy = img.getAttribute('data-src');
      if (large) img.setAttribute('src', large);
      else if (lazy && (!img.getAttribute('src') || /^data:/.test(img.getAttribute('src')))) img.setAttribute('src', lazy);
      if (/^\/\/|^\/(?!\/)/.test(img.getAttribute('src') || '')) img.setAttribute('src', absolute(img.getAttribute('src')));
      img.removeAttribute('srcset');
      const a = img.closest('a');
      if (a && inRoots(roots, a) && !a.textContent.trim() && a.querySelectorAll('img').length === 1) a.replaceWith(...a.childNodes);
    }
    for (const a of within(roots, 'a[href^="//"]')) a.setAttribute('href', absolute(a.getAttribute('href')));
  }

  // Equations: the number shown beside a display formula becomes its \tag, from which
  // core/archive.js gives the formula the block id ^eqN.
  const EQ_LABEL = /^[(（]\s*([A-Za-z]{0,2}\d+(?:\.\d+)?[A-Za-z]?)\s*[)）]$/;
  const STOP = 'p, li, section, article, main, body, [role="paragraph"], figure, table';
  const tagOf = (latex) => (String(latex).match(/\\tag\*?\{\s*([^}]+?)\s*\}/) || [])[1] || '';
  const blockId = (text) => String(text).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  function numberEquations(roots, equations) {
    for (const m of within(roots, 'math[display="block"][data-latex]')) {
      const latex = m.getAttribute('data-latex');
      let num = tagOf(latex);
      let box = m.parentElement;
      for (let depth = 0; box && depth < 4 && !box.matches(STOP); depth++, box = box.parentElement) {
        if (box.querySelectorAll('math[display="block"]').length > 1) break;
        const label = [...box.querySelectorAll('*')].find((el) => !el.closest('math') && EQ_LABEL.test(el.textContent.trim())
          && ![...el.children].some((c) => EQ_LABEL.test(c.textContent.trim())));
        if (label) {
          num ||= label.textContent.trim().match(EQ_LABEL)[1];
          label.remove();
          break;
        }
      }
      if (!num) continue;
      if (!tagOf(latex)) m.setAttribute('data-latex', `${latex} \\tag{${num}}`);
      equations.set(m, `eq${blockId(num)}`);
    }
  }

  // Figures, tables and schemes: the caption's label (Fig. 1, Table 2, Extended Data
  // Fig. 3) is set in bold and gives the caption its block id, ^fig1, ^tbl2, ^edfig3.
  const FLOATS = 'figure, .html-fig-wrap, .html-table-wrap, .cfix-table-inline, .table-wrap, .fig-wrap, .tables, .table-container';
  const CAPTIONS = 'figcaption, caption, .caption, .captions, .html-caption, .html-fig_description, .html-table_wrap_discription, [class*="caption"]';
  const FLOAT_LABEL = /^((Extended\s+Data\s+|Supplementary\s+)?(Fig(?:ure)?s?|Table|Scheme|Chart|Box)\.?\s*(S?\d+[A-Za-z]?))(?![\w])/i;
  const KINDS = { fig: 'fig', figs: 'fig', figure: 'fig', figures: 'fig', table: 'tbl', scheme: 'sch', chart: 'cht', box: 'box' };
  const firstText = (el) => {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.data.trim() && !n.parentElement.closest('math, script, style') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    return walker.nextNode();
  };
  function floatLabel(el) {
    for (const scope of [...el.querySelectorAll(CAPTIONS), el]) {
      const node = firstText(scope);
      const m = node && node.data.trimStart().match(FLOAT_LABEL);
      if (m) {
        const prefix = /^ext/i.test(m[2] || '') ? 'ed' : /^supp/i.test(m[2] || '') ? 's' : '';
        return { node, label: m[1], id: `${prefix}${KINDS[m[3].toLowerCase()]}${blockId(m[4])}` };
      }
    }
    return null;
  }
  const isBlock = (el) => el.matches(BLOCK_TAGS);
  function boldLabel(doc, { node, label }) {
    const parent = node.parentElement;
    if (parent.closest('b, strong')) return parent.closest('b, strong');
    const own = parent.textContent.trim();
    const strong = doc.createElement('strong');
    if (own === label || own.replace(/[.:]$/, '') === label) {
      // The label alone in its element: "Fig. 1" in a span, "Figure 1." in a div
      // above the caption's text, which it then joins.
      strong.textContent = own;
      const after = parent.nextSibling;
      if (own === label && after?.nodeType === 3 && /^[.:]/.test(after.data)) {
        strong.textContent += after.data[0];
        after.data = after.data.slice(1);
      }
      const next = parent.nextElementSibling;
      const text = next && isBlock(parent) && firstText(next);
      if (text && !next.matches(FLOATS)) {
        text.parentNode.insertBefore(strong, text);
        strong.after(' ');
        text.data = text.data.trimStart();
        parent.remove();
      } else {
        parent.replaceWith(strong);
      }
      return strong;
    }
    // The label at the start of a longer text: split it off.
    const start = node.data.indexOf(label);
    const rest = node.splitText(start);
    rest.splitText(label.length);
    strong.textContent = label;
    rest.replaceWith(strong);
    return strong;
  }
  function markFloats(doc, roots, floats) {
    const used = new Set();
    for (const el of within(roots, FLOATS)) {
      if (el.matches('.cfix-stub') || el.parentElement.closest(FLOATS)) continue;
      const found = floatLabel(el);
      if (!found) continue;
      floats.set(el, found.id);
      if (used.has(found.id)) continue;
      used.add(found.id);
      boldLabel(doc, found).after(A(found.id));
    }
  }

  // Where a link points: publishers give the target's id in an attribute of their own,
  // or as the address's #fragment. ACS links one number range to several references.
  const TARGET_ATTRS = ['data-xml-rid', 'ref-data-modal-source-id', 'reveal-id', 'data-xocs-content-id', 'data-target', 'reference-link', 'href'];
  function targetIds(el, url) {
    const ids = [];
    for (const name of TARGET_ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      if (name === 'href' || name === 'reference-link') {
        const hash = value.indexOf('#');
        if (hash < 0 || (hash > 0 && !samePage(value.slice(0, hash), url))) continue;
        try { ids.push(decodeURIComponent(value.slice(hash + 1))); } catch { ids.push(value.slice(hash + 1)); }
      } else {
        ids.push(...value.split(/\s+/));
      }
    }
    return [...new Set(ids.filter(Boolean))];
  }
  function samePage(address, url) {
    try {
      const a = new URL(address, url);
      const b = new URL(url);
      return a.host === b.host && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
    } catch {
      return false;
    }
  }
  function findTarget(doc, roots, id) {
    const esc = CSS.escape(id);
    // Science's figure links name the figure viewer's copy, core-fv-F1, of figure F1.
    const tail = CSS.escape(id.split('-').pop());
    const found = [`[id="${esc}"]`, `[name="${esc}"]`, `[data-content-id="${esc}"]`, `[id$="-${esc}"]`, ...(id.includes('-') ? [`[id="${tail}"]`] : [])]
      .flatMap((s) => [...doc.querySelectorAll(s)])
      .find((el) => inRoots(roots, el) && (!el.matches('a[href], [reference-link]') || el.closest(REF_LIST)));
    return found || null;
  }

  const REF_LIST = '[role="doc-bibliography"], [id*="bibliograph" i], [class*="bibliograph" i], [id*="references" i], [class*="references" i], .ref-list, [class*="ref-list"]';
  const HEADING = 'h1, h2, h3, h4, h5, h6';
  const firstNumber = (text) => (String(text || '').match(/\d+/) || [])[0];

  // Reference lists: in each part of the clip that holds references, the entries are
  // the largest set of like elements side by side (Nature's <li>s, Science's
  // .biblioentry divs). Each is numbered as the publisher numbers it: from its id
  // (ref-CR12, R12, bib0012, ref12) or its shown number (MDPI's data-content="12."),
  // else by its place.
  const ENTRY_NUMBER_ATTRS = ['data-counter', 'data-content', 'data-content-id'];
  // The number an entry shows in an element of its own (Science, ACS): ACS's ids skip
  // numbers its list doesn't.
  const shownNumber = (entry) => {
    const label = [...entry.querySelectorAll('*')].find((el) => !el.children.length && el.textContent.trim());
    return label && !label.closest('a') ? (label.textContent.trim().match(/^\[?(\d+)[.\]]?$/) || [])[1] : undefined;
  };
  function refNumber(entry, index) {
    const sources = [shownNumber(entry), ...ENTRY_NUMBER_ATTRS.map((a) => entry.getAttribute(a)), entry.id, ...[...entry.querySelectorAll('[id]')].map((e) => e.id)];
    for (const source of sources) {
      const n = firstNumber(source);
      if (n) return String(Number(n));
    }
    return String(index + 1);
  }
  function referenceEntries(roots) {
    const lists = within(roots, REF_LIST).concat(roots.filter((r) => r.matches(REF_LIST)))
      .filter((el, _, all) => !all.some((other) => other !== el && other.contains(el)));
    const entries = new Map();
    const byNumber = new Map();
    for (const list of lists) {
      let best = [];
      for (const parent of [list, ...list.querySelectorAll('*')]) {
        const groups = new Map();
        for (const child of parent.children) {
          const key = child.tagName;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(child);
        }
        // Every entry has text of its own; a number beside it doesn't make a pair.
        for (const group of groups.values()) if (group.length > best.length && group.every((e) => e.textContent.trim().length > 15)) best = group;
      }
      if (!best.length) continue;
      best.forEach((entry, i) => {
        let id = `ref${refNumber(entry, i)}`;
        if ([...entries.values()].includes(id)) id = `ref${entries.size + 1}`;
        entries.set(entry, id);
        if (!byNumber.has(id.slice(3))) byNumber.set(id.slice(3), id);
      });
    }
    return { entries, byNumber, entryOf: (el) => [...entries.keys()].find((e) => e.contains(el)) };
  }
  // An id a publisher gives a reference: R12, ref-CR12, B12-journal-…, bib0012, cit12.
  const REF_ID = /^(?:[a-z]+-)*(?:ref|bib|b|r|cr|cit|c)[-_]?[a-z]*0*\d+/i;

  function headingOf(target) {
    if (target.matches(HEADING)) return target;
    if (!target.matches('section, div, article')) return null;
    const first = target.firstElementChild;
    if (first?.matches(HEADING)) return first;
    return target.querySelector(`:scope > header ${HEADING}, :scope > div:first-child > ${HEADING}`);
  }

  const SUPERSCRIPT = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const superscript = (text) => text.replace(/\d/g, (d) => SUPERSCRIPT[d]);

  function markLinks(doc, roots, url, floats, equations) {
    const headings = new Map();
    const refs = referenceEntries(roots);
    const others = new Map();
    const anchorOf = (target) => {
      const stub = target.closest('.cfix-stub');
      if (stub?.nextElementSibling?.matches('.cfix-table-inline')) target = stub.nextElementSibling;
      for (const [el, id] of floats) if (el.contains(target) || target.contains(el)) return id;
      for (const [m, id] of equations) if (target.contains(m)) return id;
      const entry = refs.entryOf(target);
      if (entry) return refs.entries.get(entry);
      const heading = headingOf(target);
      if (heading && inRoots(roots, heading)) {
        if (!headings.has(heading)) headings.set(heading, headings.size + 1);
        return `h${headings.get(heading)}`;
      }
      // Anything else the article links to, such as a supplementary file's entry,
      // keeps its id as its block id.
      const id = blockId(target.id || target.getAttribute('name') || '');
      if (!id || /^(?:p-|ref\d|eq|h\d)/.test(id)) return null;
      if (!others.has(target)) others.set(target, id);
      return others.get(target);
    };
    const resolve = (id) => {
      const target = findTarget(doc, roots, id);
      if (target) return anchorOf(target);
      // Pages that don't give their entries the ids their links name (MDPI) are
      // matched by number.
      return REF_ID.test(id) ? refs.byNumber.get(String(Number(firstNumber(id)))) || null : null;
    };
    const links = within(roots, 'a, [reference-link]').filter((el) => !el.closest('[reference-link]') || el.matches('[reference-link]'));
    for (const link of links) {
      if (!link.isConnected) continue;
      const ids = targetIds(link, url);
      if (!ids.length) continue;
      // In a reference, a link within the page leads back to where it is cited: only
      // its text is kept.
      if (refs.entryOf(link)) {
        link.replaceWith(...link.childNodes);
        continue;
      }
      const anchors = [...new Set(ids.map(resolve).filter(Boolean))];
      if (!anchors.length) {
        // A part of the page the clip leaves out (supplementary files, say) stays a
        // link to the page; a link that only runs a script keeps its text.
        const href = link.getAttribute('href') || '';
        let address = null;
        try { address = /^(https?:|#|\/)/.test(href) ? new URL(href, url).href : null; } catch { /* not an address */ }
        if (address && /^https?:/.test(address) && !/#$/.test(address)) link.setAttribute('href', address);
        else link.replaceWith(...link.childNodes);
        continue;
      }
      const text = link.textContent.replace(/\s+/g, ' ').trim();
      const sup = link.closest('sup');
      const raised = sup && inRoots(roots, sup) && !sup.textContent.replace(/⟬[^⟭]*⟭/g, '').replace(/[\d⁰¹²³⁴⁵⁶⁷⁸⁹\s,–−-]/g, '');
      const shown = (t) => (raised ? superscript(t) : t);
      let replacement;
      if (anchors.length > 1 && anchors.every((a) => /^ref\d+$/.test(a))) {
        // "1−4" over references 1 to 4: each number its own link.
        const numbers = new Set(anchors.map((a) => a.slice(3)));
        replacement = text.replace(/\d+/g, (n) => (numbers.has(String(Number(n))) ? L(`ref${Number(n)}`, shown(n)) : shown(n)));
      } else {
        replacement = L(anchors[0], shown(text) || anchors[0]);
      }
      link.replaceWith(replacement);
    }
    // Superscript citations become superscript digits, so the links stay plain text.
    for (const sup of within(roots, 'sup')) {
      if (sup.textContent.includes('⟬L:') && !sup.textContent.replace(/⟬L:[^⟭]*⟭[^⟬]*⟬\/L⟭/g, '').replace(/[\s,–−-]/g, '')) sup.replaceWith(...sup.childNodes);
    }
    for (const [heading, n] of headings) heading.append(H(n));
    for (const [target, id] of others) target.append(A(id));
    // Every entry of a reference list gets its block id, cited or not.
    for (const [entry, id] of refs.entries) {
      flattenEntry(doc, entry);
      entry.append(A(id));
    }
  }
  // A reference is one line, however the page lays out its parts (ACS and Elsevier
  // give the authors, the title and the journal blocks of their own).
  function flattenEntry(doc, entry) {
    // A number shown in an element of its own, as Science and ACS do: **12.**
    const number = shownNumber(entry);
    if (number) {
      const label = [...entry.querySelectorAll('*')].find((el) => !el.children.length && el.textContent.trim());
      const strong = doc.createElement('strong');
      strong.textContent = `${number}.`;
      label.replaceWith(strong, ' ');
    }
    const texts = () => {
      const walker = doc.createTreeWalker(entry, NodeFilter.SHOW_TEXT);
      const all = [];
      while (walker.nextNode()) if (walker.currentNode.data) all.push(walker.currentNode);
      return all;
    };
    for (const block of [...entry.querySelectorAll('div, p')].reverse()) {
      const span = doc.createElement('span');
      for (const a of block.attributes) span.setAttribute(a.name, a.value);
      span.append(...block.childNodes);
      block.replaceWith(span);
      // The line breaks a block made become spaces, unless punctuation follows.
      const all = texts();
      const first = all.findIndex((t) => span.contains(t));
      const last = all.findLastIndex((t) => span.contains(t));
      if (first < 0) continue;
      const before = all[first - 1]?.data || '';
      const after = all[last + 1]?.data || '';
      const opens = /[\s([–—/-]$/;
      const closes = /^[\s.,;:)\]–—/-]/;
      if (before && !opens.test(before) && !closes.test(all[first].data)) span.prepend(' ');
      if (after && !closes.test(after) && !opens.test(all[last].data)) span.append(' ');
    }
  }

  function prepare(doc, { url = '', mathml = [], selectors = [] } = {}) {
    const steps = [];
    const run = (name, fn) => {
      try {
        fn();
      } catch (e) {
        steps.push(name);
        console.warn('Selectiophile: preparing the clip failed at', name, e);
      }
    };
    const stats = pageStats(doc);
    const floats = new Map();
    const equations = new Map();
    run('meta', () => oneLineMeta(doc));
    run('tables', () => inlineMdpiTables(doc, url));
    const roots = rootsOf(doc, selectors);
    run('math', () => tagOriginalMath(doc, mathml));
    run('translations', () => dropTranslations(doc));
    run('formulas', () => normalizeMath(doc));
    run('paragraphs', () => fixParagraphs(doc, roots));
    run('lists', () => fixLists(roots));
    run('images', () => fixImages(doc, roots, url));
    run('equations', () => numberEquations(roots, equations));
    run('figures', () => markFloats(doc, roots, floats));
    run('links', () => markLinks(doc, roots, url, floats, equations));
    return { ...stats, failedSteps: steps };
  }

  // The article's text as a reader sees it, one entry per block (paragraph, heading,
  // list item, table cell, caption), for checking that a clip lost nothing. Taken from
  // the live page, where hidden parts can be told apart; translations, formulas and
  // controls are left out, since the clip renders those its own way.
  const SKIP = `${ATOM}, ${WRAP}, ${BLOCK}, mjx-container, math, script, style, noscript, svg, button, nav, select, textarea, .MathJax, .MathJax_SVG, .MathJax_Preview, .MJX_Assistive_MathML, .mathjax-tex, [aria-hidden="true"]`;
  // The links publishers put after each reference are the site's, not the text.
  const SITE_LINK = /^\s*(google scholar|cross ?ref|pubmed( central)?|scopus|scilit|cas|ads|article|web of science|mathscinet|green version|full text|view in scopus|open in a new tab)\s*$/i;
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, caption, figcaption, dd, dt, blockquote, div, section, span[role="paragraph"]';
  function articleBlocks(doc, selectors = []) {
    const roots = rootsOf(doc, selectors);
    if (!roots.length) return null;
    const texts = new Map();
    for (const root of roots) collectBlocks(doc, root, texts);
    return [...texts.values()].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function collectBlocks(doc, root, texts) {
    const visible = new Map();
    const shown = (el) => {
      if (!visible.has(el)) visible.set(el, typeof el.checkVisibility === 'function' && el.isConnected ? el.checkVisibility({ checkVisibilityCSS: true }) : true);
      return visible.get(el);
    };
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const el = n.parentElement;
        if (!n.textContent.trim() || el.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        const a = el.closest('a');
        return a && SITE_LINK.test(a.textContent) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    // A block made only of links ("Full size image", "Download") is the site's controls.
    const linked = new Map();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const block = node.parentElement.closest(BLOCKS) || root;
      if (!shown(node.parentElement)) continue;
      texts.set(block, (texts.get(block) || '') + node.textContent);
      if (!node.parentElement.closest('a, [role="button"]')) linked.set(block, false);
      else if (!linked.has(block)) linked.set(block, true);
    }
    for (const [block, onlyLinks] of linked) if (onlyLinks) texts.delete(block);
  }

  // The formulas a reader sees in the parts a config clips, counted on the live page:
  // copies kept hidden (MDPI's figure gallery and table popups) and the rest of the
  // site don't count. Null when the config names no parts.
  function articleFormulas(doc, selectors = []) {
    const roots = rootsOf(doc, selectors);
    if (!roots.length) return null;
    const shown = (el) => (typeof el.checkVisibility === 'function' && el.isConnected ? el.checkVisibility({ checkVisibilityCSS: true }) : true);
    const counted = (el) => !inTranslation(el) && shown(el);
    const mathjax3 = within(roots, 'mjx-container').filter((c) => !c.parentElement.closest('mjx-container') && counted(c)).length;
    const mathjax2 = within(roots, 'script[type^="math/tex"]').filter((s) => counted(s.parentElement)).length;
    const mathml = within(roots, 'math').filter((m) => !m.closest('mjx-container, .MathJax_SVG, .MathJax, .MJX_Assistive_MathML, script') && counted(m)).length;
    return mathjax3 + mathjax2 + mathml;
  }

  globalThis.SelectiophileClipPrep = { prepare, articleBlocks, articleFormulas };
})();
