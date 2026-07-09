import { isDateString } from '../date.mjs';

function parseDocument(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('ccusage input must be valid JSON');
  }
}

function finiteNonNegative(value, name, index) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ccusage row at index ${index}: ${name} must be a finite non-negative number`);
  }
  return value;
}

function metricTotal(row, metric, index) {
  const input = finiteNonNegative(row.inputTokens, 'inputTokens', index);
  const output = finiteNonNegative(row.outputTokens, 'outputTokens', index);
  if (metric === 'io') return input + output;
  if (metric === 'total') {
    return input +
      output +
      finiteNonNegative(row.cacheCreationTokens, 'cacheCreationTokens', index) +
      finiteNonNegative(row.cacheReadTokens, 'cacheReadTokens', index);
  }
  throw new Error('Invalid metric: expected total or io');
}

function dateRangeFor(series) {
  if (series.length === 0) return null;
  return { start: series[0].date, end: series.at(-1).date };
}

export function parseCcusageUsage(raw, options = {}) {
  const parsed = parseDocument(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.daily)) {
    throw new Error('ccusage input must be an object with a daily array');
  }

  const metric = options.metric ?? 'total';
  const daily = new Map();
  parsed.daily.forEach((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Invalid ccusage row at index ${index}: expected an object`);
    }
    const date = typeof row.period === 'string' ? row.period.slice(0, 10) : null;
    if (!isDateString(date)) {
      throw new Error(`Invalid ccusage row at index ${index}: period must start with YYYY-MM-DD`);
    }
    daily.set(date, (daily.get(date) ?? 0) + metricTotal(row, metric, index));
  });

  const series = [...daily.entries()]
    .filter(([, total]) => total > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));

  return {
    series,
    stats: {
      days: series.length,
      dateRange: dateRangeFor(series)
    }
  };
}
