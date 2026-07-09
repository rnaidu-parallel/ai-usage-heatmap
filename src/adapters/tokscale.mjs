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
      generatedAt: typeof parsed?.meta?.generatedAt === 'string' ? parsed.meta.generatedAt : undefined
    }
  };
}
