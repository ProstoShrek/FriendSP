// Звания по количеству загруженных звуков. Чем выше звание, тем ярче ник.
export const RANKS = [
  { min: 0, title: 'Тихоня', cls: 'rank-0', icon: '' },
  { min: 1, title: 'Слушатель', cls: 'rank-1', icon: '' },
  { min: 5, title: 'Звукач', cls: 'rank-2', icon: '🎧' },
  { min: 15, title: 'Диджей', cls: 'rank-3', icon: '💿' },
  { min: 30, title: 'Звукорежиссёр', cls: 'rank-4', icon: '🎛️' },
  { min: 60, title: 'Легенда', cls: 'rank-5', icon: '👑' },
  { min: 100, title: 'Бог саундпада', cls: 'rank-6', icon: '⚡' },
];

export function rankFor(count) {
  let r = RANKS[0];
  for (const x of RANKS) if (count >= x.min) r = x;
  return r;
}

export function nextRank(count) {
  return RANKS.find((x) => x.min > count) ?? null;
}
