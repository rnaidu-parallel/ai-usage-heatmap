import { isDateString } from '../date.mjs';

function parseDocument(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('tokscale input must be valid JSON');
  }
}

function finiteNonNegative(value, name, index) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid tokscale contribution at index ${index}: ${name} must be a finite non-negative number`);
  }
  return value;
}

function metricTotal(entry, metric, index) {
  if (metric === 'total') {
    return finiteNonNegative(entry?.totals?.tokens, 'totals.tokens', index);
  }
  if (metric === 'io') {
    return finiteNonNegative(entry?.tokenBreakdown?.input, 'tokenBreakdown.input', index) +
      finiteNonNegative(entry?.tokenBreakdown?.output, 'tokenBreakdown.output', index);
  }
  throw new Error('Invalid metric: expected total or io');
}

function clientTotal(row, metric) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
  if (typeof row.client !== 'string' || row.client.trim() === '') return null;
  const tokens = row.tokens;
  if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) return null;

  const fields = [
    tokens.input,
    tokens.output,
    tokens.cacheRead,
    tokens.cacheWrite,
    tokens.reasoning
  ];
  if (fields.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null;

  return {
    name: row.client.trim(),
    total: metric === 'io' ? tokens.input + tokens.output : fields.reduce((sum, value) => sum + value, 0)
  };
}

function clientsFor(contributions, metric) {
  const clients = new Map();
  contributions.forEach((entry) => {
    if (!Array.isArray(entry?.clients)) return;
    entry.clients.forEach((row) => {
      const parsed = clientTotal(row, metric);
      if (!parsed) return;
      clients.set(parsed.name, (clients.get(parsed.name) ?? 0) + parsed.total);
    });
  });
  return [...clients.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, total]) => ({ name, total }));
}

function dateRangeFor(series) {
  if (series.length === 0) return null;
  return { start: series[0].date, end: series.at(-1).date };
}

export function parseTokscaleUsage(raw, options = {}) {
  const parsed = parseDocument(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.contributions)) {
    throw new Error('tokscale input must be an object with a contributions array');
  }

  const metric = options.metric ?? 'total';
  const seenDates = new Set();
  const series = parsed.contributions
    .map((entry, index) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Invalid tokscale contribution at index ${index}: expected an object`);
      }
      if (!isDateString(entry.date)) {
        throw new Error(`Invalid tokscale contribution at index ${index}: date must be YYYY-MM-DD`);
      }
      if (seenDates.has(entry.date)) {
        throw new Error(`Invalid tokscale contribution at index ${index}: duplicate date`);
      }
      seenDates.add(entry.date);
      return { date: entry.date, total: metricTotal(entry, metric, index) };
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    series,
    stats: {
      days: series.length,
      dateRange: dateRangeFor(series),
      generatedAt: typeof parsed?.meta?.generatedAt === 'string' ? parsed.meta.generatedAt : undefined,
      clients: clientsFor(parsed.contributions, metric)
    }
  };
}
