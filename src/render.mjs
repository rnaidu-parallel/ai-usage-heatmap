import {
  addDays,
  daysBetween,
  parseDateString,
  sundayOnOrBefore,
  todayDateString,
  toDateStringUTC
} from './date.mjs';
import { AGENT_ICONS } from './icons.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FONT = '-apple-system, "Segoe UI", sans-serif';

const THEMES = {
  dark: {
    colors: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
    text: '#8d96a0',
    textStrong: '#e6edf3'
  },
  light: {
    colors: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    text: '#57606a',
    textStrong: '#1f2328'
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

export function formatCompact(value) {
  const total = Math.max(0, Math.round(value));
  if (total >= 1_000_000_000) return `${(total / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(total);
}

export function windowStatsForSeries(series, todayString) {
  const today = todayString ?? todayDateString();
  const last30Start = toDateStringUTC(addDays(parseDateString(today), -30));
  const last7Start = toDateStringUTC(addDays(parseDateString(today), -7));
  let allTime = 0;
  let last30 = 0;
  let last7 = 0;
  let todayTotal = 0;

  for (const entry of series) {
    if (typeof entry?.date !== 'string' || typeof entry?.total !== 'number' || !Number.isFinite(entry.total)) continue;
    allTime += entry.total;
    if (entry.date > last30Start && entry.date <= today) last30 += entry.total;
    if (entry.date > last7Start && entry.date <= today) last7 += entry.total;
    if (entry.date === today) todayTotal += entry.total;
  }

  return {
    allTime,
    last30,
    last7,
    today: todayTotal,
    activeDays: series.length
  };
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

function estimatedTextWidth(value, fontSize) {
  return String(value).length * fontSize * 0.56;
}

function renderAgentIcon(client, x, y, theme) {
  const name = String(client.name);
  const key = name.toLowerCase();
  const label = name.trim().charAt(0).toUpperCase() || '?';
  if (AGENT_ICONS[key]) {
    return `<path d="${AGENT_ICONS[key]}" fill="${theme.text}" transform="translate(${x} ${y}) scale(0.583)"/>`;
  }
  return [
    `<circle cx="${x + 7}" cy="${y + 7}" r="7" fill="${theme.text}" fill-opacity="0.25"/>`,
    `<text x="${x + 7}" y="${y + 10}" font-size="8" font-weight="700" fill="${theme.textStrong}" text-anchor="middle">${escapeText(label)}</text>`
  ].join('');
}

function renderAgents(clients, width, rightPad, baseline, theme) {
  const visible = Array.isArray(clients)
    ? clients.filter((client) => typeof client?.name === 'string' && typeof client?.total === 'number' && client.total > 0).slice(0, 5)
    : [];
  if (visible.length === 0) return [];

  const iconY = baseline - 13;
  const items = visible.map((client) => {
    const total = formatCompact(client.total);
    const textWidth = estimatedTextWidth(total, 10);
    return { client, total, width: 14 + 4 + textWidth };
  });
  const totalWidth = items.reduce((sum, item) => sum + item.width, 0) + (items.length - 1) * 16;
  let x = width - rightPad - totalWidth;
  return items.map((item) => {
    const itemX = x;
    x += item.width + 16;
    return `<g>
    <title>${escapeText(item.client.name)}</title>
    ${renderAgentIcon(item.client, Number(itemX.toFixed(1)), iconY, theme)}
    <text x="${Number((itemX + 18).toFixed(1))}" y="${baseline}" font-size="10" fill="${theme.text}">${escapeText(item.total)}</text>
  </g>`;
  });
}

function renderHeader(stats, clients, width, leftPad, rightPad, theme) {
  const statItems = [
    ['ALL TIME', formatCompact(stats.allTime)],
    ['LAST 30 DAYS', formatCompact(stats.last30)],
    ['LAST 7 DAYS', formatCompact(stats.last7)],
    ['TODAY', formatCompact(stats.today)],
    ['ACTIVE DAYS', String(stats.activeDays)]
  ];
  const tileWidth = (width - leftPad - rightPad) / statItems.length;
  const tiles = statItems.map(([label, value], index) => {
    const x = leftPad + index * tileWidth;
    return `<g>
    <text x="${Number(x.toFixed(1))}" y="38" font-size="8.5" letter-spacing="0.08em" fill="${theme.text}">${label}</text>
    <text x="${Number(x.toFixed(1))}" y="57" font-size="17" font-weight="700" fill="${theme.textStrong}">${escapeText(value)}</text>
  </g>`;
  });

  return [
    `<text x="${leftPad}" y="16" font-size="11" font-weight="600" fill="${theme.textStrong}">AI token usage</text>`,
    ...renderAgents(clients, width, rightPad, 16, theme),
    ...tiles
  ];
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

  const headerShown = Boolean(options.stats) && (options.header ?? true);
  const headerHeight = headerShown ? 76 : 0;
  const leftPad = 30;
  const topPad = 18 + headerHeight;
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
    .map((label) => `<text x="${leftPad + label.x}" y="${10 + headerHeight}">${label.month}</text>`);

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
  const header = headerShown && options.stats
    ? renderHeader(options.stats, options.clients, width, leftPad, rightPad, theme)
    : [];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">AI token usage heatmap</title>
  <style>text{font-family:${FONT};font-size:10px;fill:${theme.text}}</style>
  ${header.join('\n  ')}
  ${labels.join('\n  ')}
  ${weekdays.join('\n  ')}
  ${cells.join('\n  ')}
  ${captionText}
  ${legend.join('\n  ')}
</svg>
`;
}
