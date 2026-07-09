#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isDateString, todayDateString } from '../src/date.mjs';
import { doctorReport } from '../src/doctor.mjs';
import { renderHeatmap } from '../src/render.mjs';
import { initText, pictureSnippet } from '../src/snippet.mjs';
import { resolveUsageSource } from '../src/sources.mjs';

const COMMANDS = new Set(['render', 'init', 'doctor']);

function usage() {
  return `Usage:
  ai-usage-heatmap render [--source auto|tokscale|ccusage|json] [--input file] [--out-dir assets] [--weeks 52] [--metric total|io] [--no-caption] [--today YYYY-MM-DD]
  ai-usage-heatmap init [--out-dir assets]
  ai-usage-heatmap doctor`;
}

function parseCommand(argv) {
  const command = argv[2] ?? 'render';
  if (!COMMANDS.has(command)) {
    throw new Error(usage());
  }
  return { command, args: argv.slice(3) };
}

function parseWeeks(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 520) {
    throw new Error('Invalid --weeks: expected 1-520');
  }
  return parsed;
}

function defaultCaption(metric, today) {
  const label = metric === 'io' ? 'AI tokens in+out' : 'AI tokens incl. cache';
  return `${label} · updated ${today}`;
}

function renderOptions(args) {
  const parsed = parseArgs({
    args,
    options: {
      source: { type: 'string', default: 'auto' },
      input: { type: 'string' },
      'out-dir': { type: 'string', default: 'assets' },
      weeks: { type: 'string', default: '52' },
      metric: { type: 'string', default: 'total' },
      'no-caption': { type: 'boolean', default: false },
      today: { type: 'string' }
    },
    allowPositionals: false
  }).values;

  if (!['auto', 'tokscale', 'ccusage', 'json'].includes(parsed.source)) {
    throw new Error('Invalid --source: expected auto, tokscale, ccusage, or json');
  }
  if (parsed.metric !== 'total' && parsed.metric !== 'io') {
    throw new Error('Invalid --metric: expected total or io');
  }
  if (parsed.today !== undefined && !isDateString(parsed.today)) {
    throw new Error(`Invalid date: expected YYYY-MM-DD, got ${String(parsed.today)}`);
  }

  return {
    source: parsed.source,
    input: parsed.input,
    outDir: parsed['out-dir'],
    weeks: parseWeeks(parsed.weeks),
    metric: parsed.metric,
    caption: parsed['no-caption'] ? false : undefined,
    today: parsed.today
  };
}

function formatDateRange(dateRange) {
  if (!dateRange?.start || !dateRange?.end) return 'none';
  return `${dateRange.start} to ${dateRange.end}`;
}

async function renderCommand(args) {
  const options = renderOptions(args);
  const { series, stats, sourceLabel } = await resolveUsageSource(options);

  const renderBase = {
    weeks: options.weeks,
    caption: options.caption === false ? false : defaultCaption(options.metric, options.today ?? todayDateString()),
    today: options.today
  };
  const darkSvg = renderHeatmap(series, { ...renderBase, theme: 'dark' });
  const lightSvg = renderHeatmap(series, { ...renderBase, theme: 'light' });

  try {
    await mkdir(options.outDir, { recursive: true });
    await writeFile(join(options.outDir, 'ai-usage-dark.svg'), darkSvg);
    await writeFile(join(options.outDir, 'ai-usage-light.svg'), lightSvg);
  } catch (error) {
    throw new Error(`Unable to write SVG output: ${error.message}`, { cause: error });
  }

  console.log(pictureSnippet(options.outDir));
  console.error(`Source: ${sourceLabel}`);
  console.error(`Stats: ${stats.days} days, date range ${formatDateRange(stats.dateRange)}`);
}

async function initCommand(args) {
  const parsed = parseArgs({
    args,
    options: {
      'out-dir': { type: 'string', default: 'assets' }
    },
    allowPositionals: false
  }).values;
  console.log(initText(parsed['out-dir']));
}

async function doctorCommand(args) {
  void args;
  console.log(await doctorReport());
}

async function main(argv = process.argv) {
  const { command, args } = parseCommand(argv);
  if (command === 'render') return renderCommand(args);
  if (command === 'init') return initCommand(args);
  return doctorCommand(args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { main };
