// Language setup for extension pages: translates marked elements, and reloads the
// page when the language changes so everything rendered by script follows too.
import './i18n.js';

const { t, setLang, resolveLang } = globalThis.SelectiophileI18n;

export { t };

function translatePage(lang) {
  setLang(lang);
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh';
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-html]')) node.innerHTML = t(node.dataset.i18nHtml);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
    node.setAttribute('aria-label', node.title);
  }
}

// `onChange`: the page redraws itself in the new language instead of reloading. The
// settings page does, since a reload is a new page for Chrome, which may want folder
// permission asked again.
export async function applyLanguage({ onChange } = {}) {
  const { lang: stored } = await chrome.storage.local.get('lang');
  const lang = resolveLang(stored, chrome.i18n.getUILanguage());
  translatePage(lang);
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.lang) return;
    if (!onChange) {
      location.reload();
      return;
    }
    const next = resolveLang(changes.lang.newValue, chrome.i18n.getUILanguage());
    translatePage(next);
    onChange(next);
  });
  return lang;
}
