import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseCcusageUsage } from './adapters/ccusage.mjs';
import { parseJsonUsage } from './adapters/json.mjs';
import { parseTokscaleUsage } from './adapters/tokscale.mjs';

const SOURCE_NAMES = new Set(['auto', 'tokscale', 'ccusage', 'json']);

function dateRangeFor(series) {
  if (series.length === 0) return null;
  return { start: series[0].date, end: series.at(-1).date };
}

function jsonResult(raw) {
  const series = parseJsonUsage(raw);
  return {
    series,
    stats: {
      days: series.length,
      dateRange: dateRangeFor(series)
    }
  };
}

function parserForSource(source) {
  if (source === 'tokscale') return parseTokscaleUsage;
  if (source === 'ccusage') return parseCcusageUsage;
  if (source === 'json') return jsonResult;
  throw new Error('Invalid --source: expected auto, tokscale, ccusage, or json');
}

export function sniffSource(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Unable to detect input source: expected valid JSON matching tokscale graph, ccusage daily, or BYO JSON');
  }

  if (Array.isArray(parsed)) return 'json';
  if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.contributions)) return 'tokscale';
  if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.daily)) return 'ccusage';
  throw new Error('Unable to detect input source: expected tokscale graph, ccusage daily, or BYO JSON');
}

function sourceLabel(source, local) {
  if (source === 'tokscale') return `tokscale graph${local ? ' (local)' : ''}`;
  if (source === 'ccusage') return `ccusage daily --json${local ? ' (local)' : ''}`;
  return 'BYO JSON';
}

async function defaultRun(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: options.timeout ?? 120000, maxBuffer: 1024 * 1024 * 200 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isRunnableMiss(error) {
  return error?.code === 'ENOENT' || error?.code === 127;
}

function firstStderrLine(error) {
  const line = String(error?.stderr ?? '').split(/\r?\n/).find((item) => item.trim());
  return line?.trim() || 'no stderr output';
}

async function resolveInputSource(options) {
  const raw = await readFile(options.input, 'utf8');
  const source = options.source === 'auto' ? sniffSource(raw) : options.source;
  const result = parserForSource(source)(raw, { metric: options.metric });
  return {
    ...result,
    source,
    sourceLabel: sourceLabel(source, false)
  };
}

async function tryLocalSource(source, metric, run) {
  const command = source === 'tokscale' ? 'tokscale' : 'ccusage';
  const args = source === 'tokscale' ? ['graph'] : ['daily', '--json'];
  let stdout;
  try {
    ({ stdout } = await run(command, args, { timeout: 120000 }));
  } catch (error) {
    if (isRunnableMiss(error)) return null;
    console.error(`Warning: ${command} failed: ${firstStderrLine(error)}`);
    return null;
  }
  const result = parserForSource(source)(stdout, { metric });
  return {
    ...result,
    source,
    sourceLabel: sourceLabel(source, true)
  };
}

export async function resolveUsageSource(options, run = defaultRun) {
  if (!SOURCE_NAMES.has(options.source)) {
    throw new Error('Invalid --source: expected auto, tokscale, ccusage, or json');
  }
  if (options.input) return resolveInputSource(options);
  if (options.source === 'json') {
    throw new Error('--input is required when --source json');
  }

  const order = options.source === 'auto' ? ['tokscale', 'ccusage'] : [options.source];
  for (const source of order) {
    const result = await tryLocalSource(source, options.metric, run);
    if (result) return result;
  }

  throw new Error([
    'No local usage source found.',
    'Install tokscale or ccusage, or pass --input with --source json.',
    'Examples:',
    '  ai-usage-heatmap render --input tokscale-graph.json --source tokscale',
    '  ai-usage-heatmap render --input ccusage-daily.json --source ccusage',
    '  ai-usage-heatmap render --input usage.json --source json'
  ].join('\n'));
}

export { defaultRun as runLocalCommand };
