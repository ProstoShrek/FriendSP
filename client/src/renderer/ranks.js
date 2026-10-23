// Звания по количеству загруженных звуков. Список хранится на сервере и меняется в админке;
// здесь — запасной вариант на случай старого сервера или отсутствия связи.
export const DEFAULT_RANKS = [
  { id: 'r0', min: 0, title: 'Тихоня', icon: '', style: 'muted' },
  { id: 'r1', min: 1, title: 'Слушатель', icon: '', style: 'plain' },
  { id: 'r2', min: 5, title: 'Звукач', icon: '🎧', style: 'mint' },
  { id: 'r3', min: 15, title: 'Диджей', icon: '💿', style: 'violet' },
  { id: 'r4', min: 30, title: 'Звукорежиссёр', icon: '🎛️', style: 'aurora' },
  { id: 'r5', min: 60, title: 'Легенда', icon: '👑', style: 'gold' },
  { id: 'r6', min: 100, title: 'Бог саундпада', icon: '⚡', style: 'prism' },
];

// Названия стилей ника для выбора в админке (сами стили — в styles.css, .nick.s-<id>)
export const STYLE_NAMES = {
  muted: 'Серый',
  plain: 'Белый',
  mint: 'Мята',
  toxic: 'Токсик',
  ice: 'Лёд',
  violet: 'Неон',
  fire: 'Огонь',
  aurora: 'Северное сияние',
  gold: 'Золото',
  prism: 'Голограмма',
};

let ranks = DEFAULT_RANKS;

export function setRanks(list) {
  if (Array.isArray(list) && list.length) ranks = [...list].sort((a, b) => a.min - b.min);
}

export function getRanks() {
  return ranks;
}

export function rankById(id) {
  return ranks.find((r) => r.id === id) ?? null;
}

export function rankFor(count) {
  let r = ranks[0];
  for (const x of ranks) if (count >= x.min) r = x;
  return r;
}

export function nextRank(count) {
  return ranks.find((x) => x.min > count) ?? null;
}
