// Reads Obsidian Web Clipper template files and evaluates their `triggers` and
// `properties` against a page, for the metadata of reading notes. A file that also
// has `noteContentFormat` can clip the original: that part is kept as written and
// rendered by the Clipper's own engine in vendor/clipper.js. Written without `export`
// because content scripts load it as a classic script; modules import it for the
// global it sets.
(() => {
  const FILTER_NAMES = new Set([
    'first', 'last', 'split', 'slice', 'join', 'unique', 'wikilink', 'replace', 'date', 'safe_name',
    'remove_html', 'remove_attr', 'markdown', 'strip_tags', 'trim', 'lower', 'upper',
  ]);

  function splitTop(text, separator) {
    const parts = [];
    let buffer = '';
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        buffer += c;
        if (c === '\\') buffer += text[++i] ?? '';
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
        buffer += c;
      } else if (text.startsWith(separator, i)) {
        parts.push(buffer);
        buffer = '';
        i += separator.length - 1;
      } else {
        buffer += c;
      }
    }
    parts.push(buffer);
    return parts;
  }

  // `"a":"b"`, `0,4`, `-8` or `(".a,.b")` become a list of plain strings.
  function parseArgs(raw) {
    let text = raw.trim();
    if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1);
    const args = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === ':' || c === ',' || c === ' ') {
        i++;
      } else if (c === '"' || c === "'") {
        let value = '';
        i++;
        while (i < text.length && text[i] !== c) {
          if (text[i] === '\\' && (text[i + 1] === c || text[i + 1] === '\\')) i++;
          value += text[i++];
        }
        i++;
        args.push(value);
      } else {
        let value = '';
        while (i < text.length && text[i] !== ',' && text[i] !== ':') value += text[i++];
        args.push(value.trim());
      }
    }
    return args;
  }

  function parseFilter(raw) {
    const trimmed = raw.trim();
    const colon = trimmed.indexOf(':');
    return colon < 0
      ? { name: trimmed, args: [] }
      : { name: trimmed.slice(0, colon).trim(), args: parseArgs(trimmed.slice(colon + 1)) };
  }

  const toPattern = (text) => {
    const m = text.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
    if (!m) return text;
    try {
      return new RegExp(m[1], m[2]);
    } catch {
      return text;
    }
  };

  const eachString = (value, fn) => (Array.isArray(value) ? value.map((v) => fn(String(v))) : fn(String(value)));

  const pad = (n) => String(n).padStart(2, '0');

  const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

  // Parsed by hand where possible: `new Date('2024-03-05')` is UTC and can land on
  // the previous day in a local reading.
  function parseDateParts(text) {
    const s = String(text).trim();
    let m = s.match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/);
    if (m) return [Number(m[1]), Number(m[2] || 1), Number(m[3] || 1)];
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
    if (m && MONTHS.includes(m[2].toLowerCase())) return [Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1])];
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})?,?\s*(\d{4})/);
    if (m && MONTHS.includes(m[1].toLowerCase())) return [Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2] || 1)];
    return null;
  }

  function formatDate(text, format = 'YYYY-MM-DD') {
    const parts = parseDateParts(text);
    if (!parts) return String(text);
    const [y, mo, d] = parts;
    return format.replace(/YYYY/g, String(y)).replace(/MM/g, pad(mo)).replace(/DD/g, pad(d));
  }

  function inertBody(html, doc) {
    const inert = doc.implementation.createHTMLDocument('');
    inert.body.innerHTML = html;
    return inert.body;
  }

  // Enough Markdown for metadata fields: text and links, with blocks on new lines.
  function toMarkdown(html, doc) {
    const walk = (node) => {
      let out = '';
      for (const child of node.childNodes) {
        if (child.nodeType === 3) out += child.data.replace(/\s+/g, ' ');
        else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === 'BR') out += '\n';
          else if (tag === 'A' && child.getAttribute('href')) out += `[${walk(child).trim()}](${child.getAttribute('href')})`;
          else if (/^(P|DIV|LI|H[1-6]|UL|OL|SECTION)$/.test(tag)) out += `\n${walk(child).trim()}\n`;
          else out += walk(child);
        }
      }
      return out;
    };
    return walk(inertBody(html, doc)).replace(/\n{3,}/g, '\n\n').trim();
  }

  const FILTERS = {
    first: (v) => (Array.isArray(v) ? v[0] ?? '' : v),
    last: (v) => (Array.isArray(v) ? v[v.length - 1] ?? '' : v),
    split: (v, [separator = ',']) => {
      const pattern = toPattern(separator);
      return String(Array.isArray(v) ? v.join(',') : v).split(pattern);
    },
    slice: (v, [start, end]) => {
      const from = start === undefined || start === '' ? undefined : Number(start);
      const to = end === undefined || end === '' ? undefined : Number(end);
      return Array.isArray(v) ? v.slice(from, to) : String(v).slice(from, to);
    },
    join: (v, [separator = ',']) => (Array.isArray(v) ? v.join(separator) : v),
    unique: (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : v),
    wikilink: (v) => eachString(v, (s) => (s.trim() ? `[[${s.trim()}]]` : '')),
    replace: (v, args) => eachString(v, (s) => {
      let out = s;
      for (let i = 0; i < args.length; i += 2) {
        const pattern = toPattern(args[i]);
        const replacement = args[i + 1] ?? '';
        out = pattern instanceof RegExp ? out.replace(pattern, replacement) : out.split(pattern).join(replacement);
      }
      return out;
    }),
    date: (v, [format]) => eachString(v, (s) => (s.trim() ? formatDate(s, format) : '')),
    safe_name: (v) => eachString(v, (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim()),
    remove_html: (v, [selectors = ''], doc) => eachString(v, (s) => {
      const body = inertBody(s, doc);
      try {
        body.querySelectorAll(selectors).forEach((n) => n.remove());
      } catch {
        return s;
      }
      return body.innerHTML;
    }),
    remove_attr: (v, [names = ''], doc) => eachString(v, (s) => {
      const body = inertBody(s, doc);
      const attrs = names.split(',').map((a) => a.trim()).filter(Boolean);
      body.querySelectorAll('*').forEach((n) => attrs.forEach((a) => n.removeAttribute(a)));
      return body.innerHTML;
    }),
    markdown: (v, _args, doc) => eachString(v, (s) => toMarkdown(s, doc)),
    strip_tags: (v, _args, doc) => eachString(v, (s) => inertBody(s, doc).textContent.trim()),
    trim: (v) => eachString(v, (s) => s.trim()),
    lower: (v) => eachString(v, (s) => s.toLowerCase()),
    upper: (v) => eachString(v, (s) => s.toUpperCase()),
  };

  const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

  function resolveVariable(source, context) {
    const { doc } = context;
    const html = source.startsWith('selectorHtml:');
    if (html || source.startsWith('selector:')) {
      const rest = source.slice(source.indexOf(':') + 1).trim();
      const m = rest.match(/^(.+)\?([\w-]+)$/);
      const selector = m ? m[1] : rest;
      let nodes;
      try {
        nodes = [...doc.querySelectorAll(selector)];
      } catch {
        return '';
      }
      const values = nodes
        .map((n) => (m ? n.getAttribute(m[2]) || '' : html ? n.innerHTML : (n.textContent || '').trim()))
        .filter((v) => v !== '');
      if (!values.length) return '';
      return values.length === 1 ? values[0] : values;
    }
    const meta = source.match(/^meta:(name|property):(.+)$/);
    if (meta) {
      const wanted = meta[2].trim().toLowerCase();
      for (const node of doc.querySelectorAll('meta')) {
        if ((node.getAttribute(meta[1]) || '').toLowerCase() === wanted) return node.getAttribute('content') || '';
      }
      return '';
    }
    return context.variables[source] ?? '';
  }

  function applyFilters(value, filters, context) {
    for (const raw of filters) {
      const { name, args } = parseFilter(raw);
      const filter = FILTERS[name];
      if (filter && !isEmpty(value)) value = filter(value, args, context.doc);
    }
    return value;
  }

  // `a|f ?? b|f`: each fallback has its own filters, as in Web Clipper. When only the last
  // one has filters (`a ?? b | date:"YYYY"`), they apply to whichever value is found, as
  // they always have here; Web Clipper would apply them to `b` alone.
  const operandsOf = (inner) => splitTop(inner, '??').map((part) => {
    const [source, ...filters] = splitTop(part, '|');
    return { source: source.trim(), filters };
  });

  function evaluateExpression(inner, context) {
    const operands = operandsOf(inner);
    const shared = operands.slice(0, -1).every((o) => !o.filters.length) ? operands[operands.length - 1].filters : null;
    let value = '';
    for (const { source, filters } of operands) {
      value = resolveVariable(source, context);
      if (!shared) value = applyFilters(value, filters, context);
      if (!isEmpty(value)) break;
    }
    return shared ? applyFilters(value, shared, context) : value;
  }

  // The same rule for Web Clipper's engine, which clips the original: filters only on
  // the last fallback are given to each one, so a property comes out of a clip as it
  // does in a reading note. ACS's `a ?? b ?? c | date:"YYYY-MM-DD"` gave the clip `a`
  // unformatted (2025/03/12), which Obsidian doesn't read as a date.
  function sharedFilters(text) {
    return String(text).replace(/\{\{((?:(?!\}\})[\s\S])*)\}\}/g, (whole, inner) => {
      const operands = operandsOf(inner);
      const last = operands[operands.length - 1];
      if (operands.length < 2 || !last.filters.length || operands.slice(0, -1).some((o) => o.filters.length)) return whole;
      const filters = last.filters.map((f) => f.trim()).join('|');
      return `{{${operands.map((o) => `${o.source}|${filters}`).join(' ?? ')}}}`;
    });
  }

  // A value that is one expression keeps its type, so a list stays a list.
  function evaluateValue(text, context) {
    const whole = text.trim().match(/^\{\{((?:(?!\}\})[\s\S])*)\}\}$/);
    if (whole) return evaluateExpression(whole[1], context);
    return text.replace(/\{\{((?:(?!\}\})[\s\S])*)\}\}/g, (_, inner) => {
      const value = evaluateExpression(inner, context);
      return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    });
  }

  function matchesTrigger(trigger, url) {
    if (trigger.startsWith('schema:')) return false;
    const regex = trigger.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
    if (regex) {
      try {
        return new RegExp(regex[1], regex[2]).test(url);
      } catch {
        return false;
      }
    }
    return url.startsWith(trigger);
  }

  function filterNames(value) {
    const names = [];
    for (const m of value.matchAll(/\{\{((?:(?!\}\})[\s\S])*)\}\}/g)) {
      for (const { filters } of operandsOf(m[1])) names.push(...filters.map((f) => parseFilter(f).name));
    }
    return names;
  }

  const PROPERTY_NAME = /^[^\n:#]+$/;
  const BUNDLED_CLIP_ONLY = new Set(['source', 'collection']);
  // The bundled config for pages no other config is made for (blogs, news).
  const FALLBACK_PROFILE = 'web-article';

  const api = {
    FALLBACK_PROFILE,
    // Keeps only what is used. Throws a code the caller can translate.
    parseProfile(text) {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw Object.assign(new Error('bad json'), { code: 'bad-json' });
      }
      const triggers = Array.isArray(data?.triggers) ? data.triggers.filter((t) => typeof t === 'string' && t.trim()) : [];
      const properties = Array.isArray(data?.properties)
        ? data.properties.filter((p) => typeof p?.name === 'string' && PROPERTY_NAME.test(p.name) && typeof p.value === 'string')
          .map((p) => ({ name: p.name.trim(), value: p.value, type: p.type || 'text' }))
        : [];
      if (!properties.length) throw Object.assign(new Error('no properties'), { code: 'no-properties' });
      // The general article config matches no address: it clips what no other config does.
      const fallback = String(data.name || '') === FALLBACK_PROFILE;
      if (!triggers.length && !fallback) throw Object.assign(new Error('no triggers'), { code: 'no-triggers' });
      const profile = { name: String(data.name || 'Untitled'), triggers, properties };
      if (fallback) profile.fallback = true;
      if (typeof data.noteContentFormat === 'string' && data.noteContentFormat.trim()) {
        profile.clip = {
          noteContentFormat: data.noteContentFormat,
          noteNameFormat: typeof data.noteNameFormat === 'string' && data.noteNameFormat.trim() ? data.noteNameFormat : '{{title}}',
          path: typeof data.path === 'string' ? data.path : '',
          properties: data.properties
            .filter((p) => typeof p?.name === 'string' && p.name.trim() && typeof p.value === 'string')
            .map((p) => ({ name: p.name.trim(), value: p.value, type: p.type || 'text' })),
        };
      }
      return profile;
    },

    // The bundled configs are the user's Web Clipper files as they are. For reading
    // notes they drop `source` and `collection`, which belong to the clipped original:
    // the address is in `url`, and `collection` files the original among references.
    parseBundledProfile(text) {
      const profile = api.parseProfile(text);
      return { ...profile, properties: profile.properties.filter((p) => !BUNDLED_CLIP_ONLY.has(p.name)) };
    },

    // A config's clipping part as Web Clipper's engine should get it.
    clipTemplate(clip) {
      return { ...clip, properties: (clip?.properties || []).map((p) => ({ ...p, value: sharedFilters(p.value) })) };
    },

    // Back to Web Clipper's file format, for downloading an uploaded config.
    toClipperJson(profile) {
      return {
        schemaVersion: '0.1.0',
        name: profile.name,
        behavior: 'create',
        ...(profile.clip ? { noteContentFormat: profile.clip.noteContentFormat } : {}),
        properties: profile.clip?.properties || profile.properties,
        triggers: profile.triggers,
        ...(profile.clip ? { noteNameFormat: profile.clip.noteNameFormat, path: profile.clip.path } : {}),
      };
    },

    // What in a file won't take effect, so an upload can say so.
    profileWarnings(profile) {
      const unknown = new Set();
      for (const p of profile.properties) {
        for (const name of filterNames(p.value)) if (!FILTER_NAMES.has(name)) unknown.add(name);
      }
      return {
        unknownFilters: [...unknown],
        schemaTriggers: profile.triggers.filter((t) => t.startsWith('schema:')),
      };
    },

    matchProfile(profiles, url) {
      return profiles.find((p) => p.triggers.some((t) => matchesTrigger(t, url))) || null;
    },

    // Selectors must run in the page, so this is called from the content script.
    evaluateProfile(profile, doc, variables) {
      const context = { doc, variables };
      const values = {};
      for (const p of profile.properties) {
        let value;
        try {
          value = evaluateValue(p.value, context);
        } catch {
          value = '';
        }
        if (Array.isArray(value)) value = value.map(String).filter(Boolean);
        if (!isEmpty(value)) values[p.name] = { value, type: p.type };
      }
      return values;
    },

    formatDate,
  };

  globalThis.SelectiophileProfiles = api;
})();
