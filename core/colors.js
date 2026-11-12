// Highlight colors. Position and color data live in the plugin; a note shows a
// colored block and the color's purpose.

export const COLORS = [
  { id: 'yellow', solid: '#e6bd52', mark: 'rgba(235, 200, 108, .5)', zh: { label: '黄色', name: '重点' }, en: { label: 'Yellow', name: 'Key point' } },
  { id: 'green', solid: '#7fae8c', mark: 'rgba(143, 196, 150, .45)', zh: { label: '绿色', name: '结论' }, en: { label: 'Green', name: 'Finding' } },
  { id: 'blue', solid: '#7ea6d4', mark: 'rgba(140, 180, 225, .45)', zh: { label: '蓝色', name: '方法' }, en: { label: 'Blue', name: 'Method' } },
  { id: 'purple', solid: '#a993d6', mark: 'rgba(185, 165, 225, .45)', zh: { label: '紫色', name: '灵感' }, en: { label: 'Purple', name: 'Idea' } },
  { id: 'red', solid: '#df8f8f', mark: 'rgba(235, 150, 150, .45)', zh: { label: '红色', name: '质疑' }, en: { label: 'Red', name: 'Question' } },
  { id: 'orange', solid: '#e8a566', mark: 'rgba(240, 175, 115, .45)', zh: { label: '橙色', name: '待查' }, en: { label: 'Orange', name: 'To check' } },
];

export const DEFAULT_COLOR = COLORS[0].id;

export const colorById = (id) => COLORS.find((c) => c.id === id) || COLORS[0];

const localized = (color, lang) => color[lang] || color.zh;

// A purpose the user cleared stays blank, rather than returning to the default name.
export function purposeOf(id, names = {}, lang = 'zh') {
  const color = colorById(id);
  return (names[color.id] ?? localized(color, lang).name).trim();
}

export const colorList = (names = {}, lang = 'zh') => COLORS.map((c) => ({
  id: c.id,
  solid: c.solid,
  mark: c.mark,
  label: localized(c, lang).label,
  purpose: purposeOf(c.id, names, lang),
  name: purposeOf(c.id, names, lang) || localized(c, lang).label,
}));
