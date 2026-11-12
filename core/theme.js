// The two themes shared with Phrase Collector. Pages call applyTheme().

export const THEMES = {
  dusk: { name: '暮光 Dusk', desc: '纸白 · 墨蓝 · 粉蓝紫点缀', badge: '#68769b', iconPrefix: '', palette: ['#f5f3f2', '#5d6a8f', '#e6b8b5', '#b8cbda', '#d7cee7'] },
  lagoon: { name: '湖光 Lagoon', desc: '浅苔 · 湖绿 · 金色点缀', badge: '#608b77', iconPrefix: 'lagoon-', palette: ['#f4f6f0', '#537f6c', '#82afa0', '#b7c9a0', '#ebc86c'] },
};

export const themeOf = (value) => (THEMES[value] ? value : 'dusk');

export async function applyTheme() {
  const set = (value) => { document.documentElement.dataset.theme = themeOf(value); };
  set((await chrome.storage.local.get('theme')).theme);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.theme) set(changes.theme.newValue);
  });
}
