import {
  addDays,
  daysBetween,
  parseDateString,
  sundayOnOrBefore,
  todayDateString,
  toDateStringUTC
} from './date.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FONT = '-apple-system, "Segoe UI", sans-serif';

const THEMES = {
  dark: {
    colors: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    text: '#8d96a0'
  },
  light: {
    colors: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    text: '#57606a'
  }
};

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function thresholdsForSeries(series, startDate, today) {
  const totals = new Map(series.map((entry) => [entry.date, entry.total]));
  const activeValues = [];
  for (let date = startDate; date <= today; date = addDays(date, 1)) {
    const value = totals.get(toDateStringUTC(date)) ?? 0;
    if (value > 0) activeValues.push(value);
  }

  activeValues.sort((a, b) => a - b);
  if (activeValues.length === 0) return [];
  return [0.2, 0.4, 0.6, 0.8].map((p) => activeValues[Math.floor(p * (activeValues.length - 1))]);
}

export function levelForValue(value, thresholds) {
  if (value <= 0 || thresholds.length === 0) return 0;
  let level = 1;
  for (const threshold of thresholds) {
    if (value > threshold) level += 1;
  }
  return Math.min(level, 4);
}

function normalizeSeries(series) {
  const totals = new Map();
  for (const entry of series) {
    if (typeof entry?.date === 'string' && typeof entry?.total === 'number' && Number.isFinite(entry.total)) {
      totals.set(entry.date, entry.total);
    }
  }
  return totals;
}

function monthLabels(startDate, today, cellSize, gap) {
  const labels = [];
  let lastColumn = -Infinity;
  for (let date = startDate; date <= today; date = addDays(date, 1)) {
    if (date.getUTCDate() !== 1) continue;
    const column = Math.floor(daysBetween(startDate, date) / 7);
    if (column - lastColumn < 2) continue;
    labels.push({
      month: MONTHS[date.getUTCMonth()],
      x: column * (cellSize + gap)
    });
    lastColumn = column;
  }
  return labels;
}

export function renderHeatmap(series, options = {}) {
  const themeName = options.theme ?? 'dark';
  const theme = THEMES[themeName];
  if (!theme) throw new Error('Invalid theme: expected dark or light');

  const weeks = Number.isInteger(options.weeks) ? options.weeks : 52;
  if (weeks <= 0 || weeks > 520) throw new Error('Invalid weeks: expected 1-520');

  const cellSize = options.cellSize ?? 11;
  const gap = options.gap ?? 3;
  const today = parseDateString(options.today ?? todayDateString());
  const rawStart = addDays(today, -(weeks * 7) + 1);
  const startDate = sundayOnOrBefore(rawStart);
  const dayCount = daysBetween(startDate, today) + 1;
  const columns = Math.ceil(dayCount / 7);
  const totals = normalizeSeries(series);
  const thresholds = thresholdsForSeries(series, startDate, today);

  const leftPad = 30;
  const topPad = 18;
  const bottomPad = 24;
  const rightPad = 4;
  const gridWidth = columns * cellSize + (columns - 1) * gap;
  const gridHeight = 7 * cellSize + 6 * gap;
  const width = leftPad + gridWidth + rightPad;
  const height = topPad + gridHeight + bottomPad;
  const caption = options.caption === false
    ? null
    : (options.caption ?? `AI tokens · updated ${toDateStringUTC(today)}`);

  const cells = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = addDays(startDate, offset);
    const dateString = toDateStringUTC(date);
    const value = totals.get(dateString) ?? 0;
    const level = levelForValue(value, thresholds);
    const column = Math.floor(offset / 7);
    const weekday = date.getUTCDay();
    cells.push(
      `<rect x="${leftPad + column * (cellSize + gap)}" y="${topPad + weekday * (cellSize + gap)}" width="${cellSize}" height="${cellSize}" rx="2" fill="${theme.colors[level]}" data-date="${dateString}" data-level="${level}"/>`
    );
  }

  const labels = monthLabels(startDate, today, cellSize, gap)
    .map((label) => `<text x="${leftPad + label.x}" y="10">${label.month}</text>`);

  const weekdays = [
    { label: 'Mon', row: 1 },
    { label: 'Wed', row: 3 },
    { label: 'Fri', row: 5 }
  ].map((item) => {
    const y = topPad + item.row * (cellSize + gap) + cellSize - 2;
    return `<text x="0" y="${y}">${item.label}</text>`;
  });

  const legendSwatchY = height - 13;
  const legendTextY = height - 4;
  const legendRight = width - rightPad;
  const moreWidth = 26;
  const swatchBlockWidth = 5 * cellSize + 4 * 3;
  const lessWidth = 22;
  const legendX = legendRight - moreWidth - 4 - swatchBlockWidth - 4 - lessWidth;
  const legend = [
    `<text x="${legendX}" y="${legendTextY}">Less</text>`,
    ...theme.colors.map((color, index) => {
      const x = legendX + lessWidth + 4 + index * (cellSize + 3);
      return `<rect x="${x}" y="${legendSwatchY}" width="${cellSize}" height="${cellSize}" rx="2" fill="${color}"/>`;
    }),
    `<text x="${legendRight - moreWidth}" y="${legendTextY}">More</text>`
  ];

  const captionText = caption
    ? `<text x="${leftPad}" y="${height - 4}">${escapeText(caption)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">AI token usage heatmap</title>
  <style>text{font-family:${FONT};font-size:10px;fill:${theme.text}}</style>
  ${labels.join('\n  ')}
  ${weekdays.join('\n  ')}
  ${cells.join('\n  ')}
  ${captionText}
  ${legend.join('\n  ')}
</svg>
`;
}
