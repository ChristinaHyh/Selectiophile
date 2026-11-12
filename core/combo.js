// Keyboard shortcuts, in the same form Phrase Collector uses. A classic script, as
// content scripts load it.
(() => {
  function keyFromEvent(e) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
    if (/^F\d{1,2}$/.test(e.code)) return e.code;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return '';
    return e.key.length === 1 ? e.key.toUpperCase() : e.key;
  }

  globalThis.SelectiophileCombo = {
    DEFAULT_SHORTCUTS: { save: 'Alt+S', comment: 'Alt+C', review: 'Alt+R' },

    comboFromEvent(e) {
      const key = keyFromEvent(e);
      if (!key) return '';
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      parts.push(key);
      return parts.join('+');
    },

    // A cleared shortcut stays cleared, rather than returning to the default.
    shortcutsOf(stored) {
      return { ...globalThis.SelectiophileCombo.DEFAULT_SHORTCUTS, ...stored };
    },
  };
})();
